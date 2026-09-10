import { randomUUID } from 'node:crypto';
import {
  ApplicationStatus,
  MilestoneDocumentSubmissionHistoryEvent,
  ProgramCategory,
  ProgramTrackType,
  SubmissionFileLifecycle,
  SubmissionStatus,
  TeamInvitationStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import { TEAM_MEMBERSHIP_AUDIT_ACTIONS } from '../../audit-log/audit-log-metadata';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { loadRuntimeConfig } from '../../runtime-config/runtime-config';
import { TeamInvitationsRepository } from '../../team-invitations/team-invitations.repository';
import { canonicalUserCreateFromLabel } from '../../users/canonical-user-fixture';
import { ProgramTeamsRepository } from '../repository/program-teams.repository';
import { TeamsErrorCode } from '../teams-error-code.enum';
import { ProgramTeamsService } from './program-teams.service';

/**
 * 팀 구성 변경(탈퇴·제외)이 실제 DB에 남기는 사실을 확인한다(#1269).
 *
 * 왜 통합 테스트여야 하는가. 이 규칙들은 전부 **한 트랜잭션 안에서 팀 행을 잠근 뒤의
 * 재판정**이다 — 승계 대상 선정(`createdAt ASC, id ASC`), 신청 이력이 있는 팀의 마지막
 * 1인 차단, 감사 기록 실패 시 승계까지 되감기, 그리고 동시 탈퇴/수락의 직렬화. prisma를
 * mock 하면 `orderBy`가 무엇이든 픽스처가 그대로 돌아오고 롤백은 아예 일어나지 않아
 * 계약이 검증되지 않는다.
 *
 * 실제 writer 를 그대로 쓴다 — `ProgramTeamsRepository` + `ProgramTeamsService` +
 * 진짜 `AuditLogService`/`AuditLogRepository`. 감사 기록은 멤버십 변경과 같은
 * 트랜잭션에서 쓰이므로, 정상 경로에서는 실제 감사 행이 증거로 남고 실패 주입은
 * repository 콜백에서만 한다.
 *
 * 외부 GitHub 호출(collaborator 회수)은 이 계층의 책임이 아니라 여기서 관측하지 않는다.
 */
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = 'synthetic-team-membership:';
const PROGRAM_ID = `${TEST_PREFIX}program`;

/**
 * 팀 픽스처만 실행마다 새 이름을 받는다.
 *
 * 감사 행은 지울 수 없으므로(`AuditLog`는 DB가 추가 전용을 강제한다) 같은 DB에서 이
 * 파일이 두 번 돌면 지난 실행의 감사 행이 그대로 남아 있다. 감사 단언은 전부
 * `targetId = teamId` 로 좁히므로, 팀 id 에 실행 nonce 를 붙이면 남은 행이 이번 실행의
 * 개수 단언에 섞이지 않는다. 사용자·프로그램은 감사 행이 FK 로 붙잡고 있어 지울 수
 * 없으니 반대로 **고정 id 로 재사용**한다.
 */
const RUN_PREFIX = `${TEST_PREFIX}run-${randomUUID()}:`;

const MILESTONE_ID = `${TEST_PREFIX}milestone`;
const MILESTONE_DOCUMENT_ID = `${TEST_PREFIX}milestone-document`;

const LEADER_ID = `${TEST_PREFIX}leader`;
const MEMBER_A_ID = `${TEST_PREFIX}member-a`;
const MEMBER_B_ID = `${TEST_PREFIX}member-b`;
const INVITEE_ID = `${TEST_PREFIX}invitee`;

const GITHUB_ID_BY_USER: ReadonlyMap<string, bigint> = new Map([
  [LEADER_ID, 9_450_000_001n],
  [MEMBER_A_ID, 9_450_000_002n],
  [MEMBER_B_ID, 9_450_000_003n],
  [INVITEE_ID, 9_450_000_004n],
]);

function githubIdOf(userId: string): bigint {
  const githubId = GITHUB_ID_BY_USER.get(userId);
  if (githubId === undefined) {
    throw new Error(`unknown fixture user ${userId}`);
  }
  return githubId;
}

const JOINED_FIRST = new Date('2026-08-02T00:00:00.000Z');
const JOINED_SECOND = new Date('2026-08-03T00:00:00.000Z');

const prisma = new PrismaService();
const repository = new ProgramTeamsRepository(prisma);
const auditLog = new AuditLogService(new AuditLogRepository(prisma));
const service = new ProgramTeamsService(
  repository,
  loadRuntimeConfig({
    TEAM_JOIN_CODE_SECRET: `${TEST_PREFIX}join-code-secret`,
  }),
  auditLog,
);
const invitations = new TeamInvitationsRepository(prisma);

interface MemberSeed {
  readonly userId: string;
  /** 승계 tie-break(`id ASC`)를 관측 가능하게 만들려면 행 id 를 직접 정해야 한다. */
  readonly memberRowId: string;
  readonly createdAt: Date;
}

/**
 * 정리 순서가 곧 참조 순서다 — 제출 파일 → 초대 → 신청 → 구성원 → 팀.
 * `SubmissionFile.applicationId` 와 `Application.teamId` 는 `onDelete: Restrict` 라
 * 이 순서를 어기면 정리 자체가 FK 에 막힌다. 이 프로그램(`PROGRAM_ID`)의 픽스처만
 * 건드린다.
 *
 * ⚠ `AuditLog` 는 **절대 지우지 않는다** — 운영과 같은 추가 전용 불변식이 이 DB 에도
 * 걸려 있어 조건에 맞는 행이 하나도 없는 DELETE 조차 55000 으로 거부된다
 * (`audit-log-append-only.integration.spec.ts`). 그래서 감사 행과, 감사 행이 actorId 로
 * 붙잡고 있는 합성 사용자·그 프로필도 지우지 않고 격리 DB 폐기까지 남겨 둔다.
 * 프로그램도 매 테스트 다시 만들지 않고 재사용한다.
 */
async function cleanupTeamScope(): Promise<void> {
  await prisma.submissionFile.deleteMany({
    where: { uploaderId: { startsWith: TEST_PREFIX } },
  });
  // 제출 헤더를 지우려면 불변 이력이 먼저다 — History → Submission 은
  // `onDelete: Restrict` 로 묶여 있다.
  await prisma.milestoneDocumentSubmissionHistory.deleteMany({
    where: { submission: { application: { programId: PROGRAM_ID } } },
  });
  await prisma.milestoneDocumentSubmission.deleteMany({
    where: { application: { programId: PROGRAM_ID } },
  });
  await prisma.teamInvitation.deleteMany({ where: { programId: PROGRAM_ID } });
  await prisma.application.deleteMany({ where: { programId: PROGRAM_ID } });
  await prisma.teamMember.deleteMany({ where: { programId: PROGRAM_ID } });
  await prisma.team.deleteMany({ where: { programId: PROGRAM_ID } });
}

/**
 * 사용자·프로그램·마일스톤·서류 항목은 파일당 한 번만 만든다. 지울 수 없거나(감사 FK)
 * 테스트마다 바뀔 이유가 없는 픽스처이므로 멱등하게 둔다 — 이미 있으면 그대로
 * 재사용하고, 팀·신청·제출 단위 상태만 테스트마다 갈아 끼운다.
 */
async function seedDurableFixturesOnce(): Promise<void> {
  for (const [userId, githubId] of GITHUB_ID_BY_USER) {
    const existing = await prisma.user.count({ where: { id: userId } });
    if (existing > 0) continue;
    await prisma.user.create({
      data: canonicalUserCreateFromLabel('STUDENT', {
        id: userId,
        githubId,
        nickname: `synthetic-${userId.slice(TEST_PREFIX.length)}`,
        name: 'Synthetic user',
      }),
    });
  }
  await prisma.program.upsert({
    where: { id: PROGRAM_ID },
    update: {},
    create: {
      id: PROGRAM_ID,
      name: 'Team membership program',
      organizer: 'Synthetic organizer',
      trackType: ProgramTrackType.CURRICULAR,
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'capstone-v1',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-08-31T00:00:00.000Z'),
      description: 'Synthetic team membership fixture',
      teamMinSize: 1,
      teamMaxSize: 4,
    },
  });
  // ATTACHED 제출 파일은 마일스톤과 서류 항목까지 있어야 성립한다.
  await prisma.milestone.upsert({
    where: { id: MILESTONE_ID },
    update: {},
    create: {
      id: MILESTONE_ID,
      programId: PROGRAM_ID,
      name: 'Synthetic milestone',
      dueAt: new Date('2026-09-30T00:00:00.000Z'),
    },
  });
  await prisma.milestoneDocument.upsert({
    where: { id: MILESTONE_DOCUMENT_ID },
    update: {},
    create: {
      id: MILESTONE_DOCUMENT_ID,
      milestoneId: MILESTONE_ID,
      name: 'Synthetic document',
      required: true,
      sortOrder: 1,
    },
  });
}

async function seedTeam(
  teamId: string,
  leaderId: string,
  members: readonly MemberSeed[],
): Promise<void> {
  await prisma.team.create({
    data: {
      id: teamId,
      programId: PROGRAM_ID,
      name: `Team ${teamId}`,
      joinCodeDigest: `${teamId}:digest`,
      leaderId,
    },
  });
  for (const member of members) {
    await prisma.teamMember.create({
      data: {
        id: member.memberRowId,
        teamId,
        programId: PROGRAM_ID,
        userId: member.userId,
        createdAt: member.createdAt,
      },
    });
  }
}

async function seedApplication(
  teamId: string,
  applicantId: string,
): Promise<string> {
  const application = await prisma.application.create({
    data: {
      id: `${teamId}:application`,
      programId: PROGRAM_ID,
      applicantId,
      teamId,
      answers: { synthetic: true },
      applicationTemplateVersion: 1,
      status: ApplicationStatus.SUBMITTED,
    },
    select: { id: true },
  });
  return application.id;
}

interface SubmittedDocument {
  readonly submissionId: string;
  readonly historyId: string;
  readonly fileId: string;
}

/**
 * 신청에 매달린 **진짜 제출 이력** 한 묶음 — 팀 구성이 바뀜도 남아 있어야 하는 사실이다.
 *
 * 파일 하나만 띄워 놓을 수는 없다. `SubmissionFile_lifecycle_attachment_check`
 * (20260830180000_contract_legacy_submissions)가 ATTACHED 행에 applicationId·milestoneId·
 * milestoneDocumentSubmissionId·milestoneDocumentSubmissionHistoryId 를 전부 요구하고
 * pendingExpiresAt 은 NULL 이길 요구한다. PENDING 으로 내리면 제약은 통과하지만
 * 그건 "아직 제출되지 않은 임시 업로드"라 보존해야 할 이력이 아니다 — 그래서
 * 제출 헤더 + 불변 이력 + 첨부 파일까지 온전한 한 벌을 심는다
 * (`milestone-document-archive.integration-fixture.ts` 와 같은 모양).
 */
async function seedSubmittedDocument(
  applicationId: string,
  submitterId: string,
): Promise<SubmittedDocument> {
  const submissionId = `${applicationId}:submission`;
  const historyId = `${applicationId}:history`;
  await prisma.milestoneDocumentSubmission.create({
    data: {
      id: submissionId,
      milestoneDocumentId: MILESTONE_DOCUMENT_ID,
      applicationId,
      submittedById: submitterId,
      revision: 1,
      status: SubmissionStatus.SUBMITTED,
      histories: {
        create: {
          id: historyId,
          event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
          revision: 1,
          actorId: submitterId,
        },
      },
    },
  });
  const file = await prisma.submissionFile.create({
    data: {
      id: `${applicationId}:file`,
      uploaderId: submitterId,
      applicationId,
      milestoneId: MILESTONE_ID,
      milestoneDocumentSubmissionId: submissionId,
      milestoneDocumentSubmissionHistoryId: historyId,
      lifecycle: SubmissionFileLifecycle.ATTACHED,
      pendingExpiresAt: null,
      expiresAt: new Date('2099-12-31T00:00:00.000Z'),
      storageKey: `${applicationId}/synthetic.pdf`,
      originalFileName: 'synthetic.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1_024,
    },
    select: { id: true },
  });
  return { submissionId, historyId, fileId: file.id };
}

async function seedPendingInvitation(
  teamId: string,
  invitedById: string,
): Promise<string> {
  const invitation = await prisma.teamInvitation.create({
    data: {
      id: `${teamId}:invitation`,
      teamId,
      programId: PROGRAM_ID,
      inviteeId: INVITEE_ID,
      invitedById,
    },
    select: { id: true },
  });
  return invitation.id;
}

async function rosterOf(teamId: string): Promise<readonly string[]> {
  const members = await prisma.teamMember.findMany({
    where: { teamId },
    select: { userId: true },
  });
  return members.map((member) => member.userId).sort();
}

async function membershipAuditRows(teamId: string) {
  return prisma.auditLog.findMany({
    where: {
      targetType: 'TEAM',
      targetId: teamId,
      action: TEAM_MEMBERSHIP_AUDIT_ACTIONS.TEAM_MEMBERSHIP_CHANGED,
    },
    orderBy: { occurredAt: 'asc' },
    select: { actorId: true, metadata: true },
  });
}

/**
 * 팀장은 언제나 그 팀의 현재 구성원이어야 한다. 이 불변식이 깨지면 팀 화면이
 * 존재하지 않는 사람에게 권한 플래그를 계산한다.
 */
async function expectLeaderInsideMembership(teamId: string): Promise<void> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { leaderId: true },
  });
  if (team === null) return;
  const roster = await rosterOf(teamId);
  expect(roster.length).toBeGreaterThan(0);
  expect(roster).toContain(team.leaderId);
}

describe('program team membership transactions integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await cleanupTeamScope();
    await seedDurableFixturesOnce();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(cleanupTeamScope);

  afterEach(cleanupTeamScope);

  afterAll(async () => {
    await cleanupTeamScope();
    await prisma.$disconnect();
  });

  it('promotes the lowest member row id when two members joined at the same instant', async () => {
    // Given — 두 팀원의 합류 시각이 완전히 같다. 남는 기준은 행 id 오름차순뿐이다.
    const teamId = `${RUN_PREFIX}team-tie`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        memberRowId: `${teamId}:row-0000`,
        createdAt: JOINED_FIRST,
      },
      {
        userId: MEMBER_A_ID,
        memberRowId: `${teamId}:row-0001`,
        createdAt: JOINED_SECOND,
      },
      {
        userId: MEMBER_B_ID,
        memberRowId: `${teamId}:row-0002`,
        createdAt: JOINED_SECOND,
      },
    ]);

    // When
    await service.leave(githubIdOf(LEADER_ID), PROGRAM_ID);

    // Then
    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { leaderId: true },
      }),
    ).resolves.toEqual({ leaderId: MEMBER_A_ID });
    expect(await rosterOf(teamId)).toEqual([MEMBER_A_ID, MEMBER_B_ID].sort());
    await expectLeaderInsideMembership(teamId);
  });

  it('promotes the earliest joiner even when its member row id sorts last', async () => {
    // Given — 먼저 합류한 사람의 행 id 가 오히려 뒤에 온다. createdAt 이 먼저다.
    const teamId = `${RUN_PREFIX}team-order`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        memberRowId: `${teamId}:row-0000`,
        createdAt: JOINED_FIRST,
      },
      {
        userId: MEMBER_B_ID,
        memberRowId: `${teamId}:row-0009`,
        createdAt: JOINED_FIRST,
      },
      {
        userId: MEMBER_A_ID,
        memberRowId: `${teamId}:row-0002`,
        createdAt: JOINED_SECOND,
      },
    ]);

    // When
    await service.leave(githubIdOf(LEADER_ID), PROGRAM_ID);

    // Then
    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { leaderId: true },
      }),
    ).resolves.toEqual({ leaderId: MEMBER_B_ID });
    await expectLeaderInsideMembership(teamId);
  });

  it('lets a non-last member leave after the team already submitted an application', async () => {
    // Given
    const teamId = `${RUN_PREFIX}team-applied-leave`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        memberRowId: `${teamId}:row-0000`,
        createdAt: JOINED_FIRST,
      },
      {
        userId: MEMBER_A_ID,
        memberRowId: `${teamId}:row-0001`,
        createdAt: JOINED_SECOND,
      },
    ]);
    const applicationId = await seedApplication(teamId, LEADER_ID);

    // When — 신청 제출도, 신청 기간 종료도 탈퇴를 막지 않는다.
    await service.leave(githubIdOf(MEMBER_A_ID), PROGRAM_ID);

    // Then
    expect(await rosterOf(teamId)).toEqual([LEADER_ID]);
    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { leaderId: true },
      }),
    ).resolves.toEqual({ leaderId: LEADER_ID });
    await expect(
      prisma.application.findUniqueOrThrow({
        where: { id: applicationId },
        select: { teamId: true, applicantId: true, status: true },
      }),
    ).resolves.toEqual({
      teamId,
      applicantId: LEADER_ID,
      status: ApplicationStatus.SUBMITTED,
    });
  });

  it('hands leadership to the successor and never rewrites the recorded applicant', async () => {
    // Given — 신청자는 팀장 본인이다.
    const teamId = `${RUN_PREFIX}team-successor`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        memberRowId: `${teamId}:row-0000`,
        createdAt: JOINED_FIRST,
      },
      {
        userId: MEMBER_A_ID,
        memberRowId: `${teamId}:row-0001`,
        createdAt: JOINED_SECOND,
      },
    ]);
    const applicationId = await seedApplication(teamId, LEADER_ID);

    // When
    await service.leave(githubIdOf(LEADER_ID), PROGRAM_ID);

    // Then — 팀장은 승계되지만 신청 이력의 신청자는 그대로다(과거 사실이다).
    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { leaderId: true },
      }),
    ).resolves.toEqual({ leaderId: MEMBER_A_ID });
    expect(await rosterOf(teamId)).toEqual([MEMBER_A_ID]);
    await expect(
      prisma.application.findUniqueOrThrow({
        where: { id: applicationId },
        select: { applicantId: true, teamId: true },
      }),
    ).resolves.toEqual({ applicantId: LEADER_ID, teamId });

    // And — 실제 감사 writer 가 같은 트랜잭션에서 승계 사실을 봉인했다.
    const audits = await membershipAuditRows(teamId);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorId).toBe(LEADER_ID);
    expect(audits[0]!.metadata).toMatchObject({
      operation: 'LEAVE',
      removedUserId: LEADER_ID,
      previousLeaderId: LEADER_ID,
      nextLeaderId: MEMBER_A_ID,
    });
  });

  it('preserves the application and its submission history when the leader removes a member', async () => {
    // Given — 제출을 낸 사람이 곰 제외될 팀원이다.
    const teamId = `${RUN_PREFIX}team-remove`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        memberRowId: `${teamId}:row-0000`,
        createdAt: JOINED_FIRST,
      },
      {
        userId: MEMBER_A_ID,
        memberRowId: `${teamId}:row-0001`,
        createdAt: JOINED_SECOND,
      },
    ]);
    const applicationId = await seedApplication(teamId, LEADER_ID);
    const submitted = await seedSubmittedDocument(applicationId, MEMBER_A_ID);

    // When
    await service.removeMember(githubIdOf(LEADER_ID), PROGRAM_ID, MEMBER_A_ID);

    // Then — 멤버십만 사라지고 이력은 한 줄도 지워지지 않는다.
    expect(await rosterOf(teamId)).toEqual([LEADER_ID]);
    await expect(
      prisma.application.findUniqueOrThrow({
        where: { id: applicationId },
        select: { teamId: true, applicantId: true },
      }),
    ).resolves.toEqual({ teamId, applicantId: LEADER_ID });
    // 제출 헤더·불변 이력·첨부 파일 세 줄이 모두 제출자를 가리키는 채로 남는다 —
    // 제출을 낸 사람이 팀에서 빠졌다고 그가 낸 제출이 사라지지는 않는다.
    await expect(
      prisma.milestoneDocumentSubmission.findUniqueOrThrow({
        where: { id: submitted.submissionId },
        select: { applicationId: true, submittedById: true, status: true },
      }),
    ).resolves.toEqual({
      applicationId,
      submittedById: MEMBER_A_ID,
      status: SubmissionStatus.SUBMITTED,
    });
    await expect(
      prisma.milestoneDocumentSubmissionHistory.findUniqueOrThrow({
        where: { id: submitted.historyId },
        select: {
          milestoneDocumentSubmissionId: true,
          actorId: true,
          event: true,
        },
      }),
    ).resolves.toEqual({
      milestoneDocumentSubmissionId: submitted.submissionId,
      actorId: MEMBER_A_ID,
      event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
    });
    await expect(
      prisma.submissionFile.findUniqueOrThrow({
        where: { id: submitted.fileId },
        select: {
          applicationId: true,
          uploaderId: true,
          lifecycle: true,
          milestoneDocumentSubmissionId: true,
          milestoneDocumentSubmissionHistoryId: true,
          deletedAt: true,
        },
      }),
    ).resolves.toEqual({
      applicationId,
      uploaderId: MEMBER_A_ID,
      lifecycle: SubmissionFileLifecycle.ATTACHED,
      milestoneDocumentSubmissionId: submitted.submissionId,
      milestoneDocumentSubmissionHistoryId: submitted.historyId,
      deletedAt: null,
    });

    const audits = await membershipAuditRows(teamId);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({
      operation: 'REMOVE',
      removedUserId: MEMBER_A_ID,
      previousLeaderId: LEADER_ID,
      nextLeaderId: LEADER_ID,
    });
    await expectLeaderInsideMembership(teamId);
  });

  it('blocks the last member of an applied team with 409 and keeps every row', async () => {
    // Given
    const teamId = `${RUN_PREFIX}team-last`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        memberRowId: `${teamId}:row-0000`,
        createdAt: JOINED_FIRST,
      },
    ]);
    const applicationId = await seedApplication(teamId, LEADER_ID);
    const submitted = await seedSubmittedDocument(applicationId, LEADER_ID);

    // When / Then
    await expect(
      service.leave(githubIdOf(LEADER_ID), PROGRAM_ID),
    ).rejects.toMatchObject({
      errorCode: {
        code: TeamsErrorCode.LAST_MEMBER_WITH_APPLICATION,
        status: 409,
      },
    });

    // 실패는 아무것도 쓰지 않는다 — 감사 행도 남지 않는다.
    expect(await rosterOf(teamId)).toEqual([LEADER_ID]);
    await expect(prisma.team.count({ where: { id: teamId } })).resolves.toBe(1);
    await expect(
      prisma.application.count({ where: { id: applicationId } }),
    ).resolves.toBe(1);
    await expect(
      prisma.milestoneDocumentSubmission.count({
        where: { id: submitted.submissionId },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.milestoneDocumentSubmissionHistory.count({
        where: { id: submitted.historyId },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.submissionFile.count({ where: { id: submitted.fileId } }),
    ).resolves.toBe(1);
    expect(await membershipAuditRows(teamId)).toHaveLength(0);
  });

  it('deletes the sole unapplied team together with its pending invitations', async () => {
    // Given — 신청이 없는 1인 팀에 대기 초대가 걸려 있다.
    const teamId = `${RUN_PREFIX}team-sole`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        memberRowId: `${teamId}:row-0000`,
        createdAt: JOINED_FIRST,
      },
    ]);
    const invitationId = await seedPendingInvitation(teamId, LEADER_ID);

    // When
    await service.leave(githubIdOf(LEADER_ID), PROGRAM_ID);

    // Then — 팀·구성원·초대가 함께 사라진다(초대를 먼저 지워야 composite FK 에 막히지 않는다).
    await expect(prisma.team.count({ where: { id: teamId } })).resolves.toBe(0);
    await expect(prisma.teamMember.count({ where: { teamId } })).resolves.toBe(
      0,
    );
    await expect(
      prisma.teamInvitation.count({ where: { id: invitationId } }),
    ).resolves.toBe(0);
    // 초대받았던 사람의 계정은 손대지 않는다.
    await expect(
      prisma.user.count({ where: { id: INVITEE_ID } }),
    ).resolves.toBe(1);

    const audits = await membershipAuditRows(teamId);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({
      operation: 'LEAVE',
      removedUserId: LEADER_ID,
      previousLeaderId: LEADER_ID,
      // 승계 대상이 없었다는 사실 자체가 감사 사실이다.
      nextLeaderId: null,
    });
  });

  it('rolls back the leadership handover when the same-transaction audit write fails', async () => {
    // Given
    const teamId = `${RUN_PREFIX}team-audit-rollback`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        memberRowId: `${teamId}:row-0000`,
        createdAt: JOINED_FIRST,
      },
      {
        userId: MEMBER_A_ID,
        memberRowId: `${teamId}:row-0001`,
        createdAt: JOINED_SECOND,
      },
    ]);

    // When — 감사 콜백이 던지면 승계와 멤버 삭제까지 같은 트랜잭션에서 되감긴다.
    await expect(
      repository.leave(PROGRAM_ID, LEADER_ID, async () => {
        await Promise.resolve();
        throw new Error('synthetic audit failure');
      }),
    ).rejects.toThrow('synthetic audit failure');

    // Then
    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { leaderId: true },
      }),
    ).resolves.toEqual({ leaderId: LEADER_ID });
    expect(await rosterOf(teamId)).toEqual([LEADER_ID, MEMBER_A_ID].sort());
    expect(await membershipAuditRows(teamId)).toHaveLength(0);
  });

  it('rolls back the member removal when the same-transaction audit write fails', async () => {
    // Given
    const teamId = `${RUN_PREFIX}team-audit-rollback-remove`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        memberRowId: `${teamId}:row-0000`,
        createdAt: JOINED_FIRST,
      },
      {
        userId: MEMBER_A_ID,
        memberRowId: `${teamId}:row-0001`,
        createdAt: JOINED_SECOND,
      },
    ]);

    // When
    await expect(
      repository.removeMember(PROGRAM_ID, LEADER_ID, MEMBER_A_ID, async () => {
        await Promise.resolve();
        throw new Error('synthetic audit failure');
      }),
    ).rejects.toThrow('synthetic audit failure');

    // Then — 제외 대상의 멤버십이 그대로 살아 있다.
    expect(await rosterOf(teamId)).toEqual([LEADER_ID, MEMBER_A_ID].sort());
    expect(await membershipAuditRows(teamId)).toHaveLength(0);
  });

  it('serializes a concurrent leader leave and member leave without stranding leadership', async () => {
    // Given — 신청이 없는 3인 팀에서 팀장과 팀원이 동시에 나간다.
    const teamId = `${RUN_PREFIX}team-concurrent-leave`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        memberRowId: `${teamId}:row-0000`,
        createdAt: JOINED_FIRST,
      },
      {
        userId: MEMBER_A_ID,
        memberRowId: `${teamId}:row-0001`,
        createdAt: JOINED_SECOND,
      },
      {
        userId: MEMBER_B_ID,
        memberRowId: `${teamId}:row-0002`,
        createdAt: JOINED_SECOND,
      },
    ]);

    // When
    const settled = await Promise.allSettled([
      service.leave(githubIdOf(LEADER_ID), PROGRAM_ID),
      service.leave(githubIdOf(MEMBER_A_ID), PROGRAM_ID),
    ]);

    // Then — 두 탈퇴 모두 성립한다(둘 다 마지막 1인이 아니었다).
    expect(settled.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
    ]);
    // 관측 가능한 최종 사실: 남는 사람은 하나이고 그 사람이 팀장이다.
    expect(await rosterOf(teamId)).toEqual([MEMBER_B_ID]);
    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { leaderId: true },
      }),
    ).resolves.toEqual({ leaderId: MEMBER_B_ID });
    await expectLeaderInsideMembership(teamId);
    expect(await membershipAuditRows(teamId)).toHaveLength(2);
  });

  it('serializes an invitation acceptance against a concurrent removal on an applied team', async () => {
    // Given — 신청 이력이 있는 팀에 대기 초대가 하나 걸려 있다.
    const teamId = `${RUN_PREFIX}team-concurrent-accept`;
    await seedTeam(teamId, LEADER_ID, [
      {
        userId: LEADER_ID,
        memberRowId: `${teamId}:row-0000`,
        createdAt: JOINED_FIRST,
      },
      {
        userId: MEMBER_A_ID,
        memberRowId: `${teamId}:row-0001`,
        createdAt: JOINED_SECOND,
      },
    ]);
    const applicationId = await seedApplication(teamId, LEADER_ID);
    const submitted = await seedSubmittedDocument(applicationId, LEADER_ID);
    const invitationId = await seedPendingInvitation(teamId, LEADER_ID);

    // When — 합류와 제외가 같은 팀 행을 두고 동시에 들어온다.
    const settled = await Promise.allSettled([
      invitations.withAcceptTransaction(invitationId, INVITEE_ID),
      service.removeMember(githubIdOf(LEADER_ID), PROGRAM_ID, MEMBER_A_ID),
    ]);

    // Then — 둘 다 성립하고, 순서와 무관하게 최종 명부가 같다.
    expect(settled.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
    ]);
    const acceptance = settled[0];
    if (acceptance.status !== 'fulfilled') {
      throw new Error('초대 수락이 거부되었다 — 직렬화가 아니라 실패다.');
    }
    expect(acceptance.value).toEqual({
      kind: 'ok',
      teamId,
      programId: PROGRAM_ID,
    });
    expect(await rosterOf(teamId)).toEqual([INVITEE_ID, LEADER_ID].sort());
    // 이력이 있는 팀이 빈 팀으로 남지 않고, 팀장은 여전히 구성원이다.
    await expectLeaderInsideMembership(teamId);
    await expect(
      prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { leaderId: true },
      }),
    ).resolves.toEqual({ leaderId: LEADER_ID });
    await expect(
      prisma.teamInvitation.findUniqueOrThrow({
        where: { id: invitationId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: TeamInvitationStatus.ACCEPTED });
    // 신청과 제출 이력은 팀 구성이 두 번 바뀌는 동안에도 그대로다.
    await expect(
      prisma.application.count({ where: { id: applicationId } }),
    ).resolves.toBe(1);
    await expect(
      prisma.milestoneDocumentSubmission.count({
        where: { id: submitted.submissionId },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.submissionFile.count({ where: { id: submitted.fileId } }),
    ).resolves.toBe(1);
  });
});
