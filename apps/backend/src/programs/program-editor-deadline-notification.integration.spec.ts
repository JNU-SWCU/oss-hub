import {
  ApplicationStatus,
  MemberKind,
  MilestoneSubmissionType,
  ProgramCategory,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { DomainException } from '../common/error-code';
import { DeadlineDigestRepository } from '../notifications/deadline-digest.repository';
import { DeadlineDigestService } from '../notifications/deadline-digest.service';
import type { DeadlineDigestMail } from '../notifications/mail-sender.port';
import { NotificationsErrorCode } from '../notifications/notifications-error-code.enum';
import { PrismaService } from '../prisma/prisma.service';
import { ProgramEditorRepository } from './repository/program-editor.repository';
import { ProgramEditorService } from './service/program-editor.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;

const TEST_PREFIX = 'test:program-editor:deadline-notification:';
const STAFF_GITHUB_ID = 9_127_000_001n;
const PROGRAM_ID = `${TEST_PREFIX}program`;
const MILESTONE_ID = `${TEST_PREFIX}milestone`;
const DOCUMENT_REQUIRED_ID = `${TEST_PREFIX}document:required`;
const DOCUMENT_OPTIONAL_ID = `${TEST_PREFIX}document:optional`;
const TEAM_ID = `${TEST_PREFIX}team`;
const APPLICATION_ID = `${TEST_PREFIX}application`;
const LEADER_ID = `${TEST_PREFIX}leader`;
const MEMBER_ID = `${TEST_PREFIX}member`;

/** 마일스톤 마감이 이 시각으로부터 12시간 뒤 — 24시간 창(`DEADLINE_LEAD_TIME_MS`) 안이다. */
const NOW = new Date('2026-08-18T00:00:00.000Z');
const MILESTONE_DUE_AT = new Date('2026-08-18T12:00:00.000Z');

const prisma = new PrismaService();
const editor = new ProgramEditorService(new ProgramEditorRepository(prisma));

/** preview 는 메일을 보내지 않는다 — 실제로 안 부르는지 이 배열로 확인한다. */
const sentMails: DeadlineDigestMail[] = [];
const digest = new DeadlineDigestService(
  new DeadlineDigestRepository(prisma),
  {
    send: (mail: DeadlineDigestMail) => {
      sentMails.push(mail);
      return Promise.resolve();
    },
  },
  { FRONTEND_URL: 'https://oss-hub.invalid' },
);

function updateRequest(notifyOnDeadline: boolean) {
  return {
    name: '마감 알림 검증 프로그램',
    organizer: 'OSS Center',
    category: ProgramCategory.BASIC,
    applicationStartAt: '2026-08-01T00:00:00.000Z',
    applicationEndAt: '2026-08-15T00:00:00.000Z',
    endAt: '2026-08-31T00:00:00.000Z',
    repositoryProvisioningEnabled: false,
    notifyOnDeadline,
    description: '마감 알림 스위치 왕복 검증',
  };
}

function errorCode(error: unknown): string | null {
  return error instanceof DomainException ? error.errorCode.code : null;
}

async function cleanup(): Promise<void> {
  await prisma.milestoneDocumentSubmission.deleteMany({
    where: { applicationId: APPLICATION_ID },
  });
  await prisma.application.deleteMany({ where: { id: APPLICATION_ID } });
  await prisma.milestoneDocument.deleteMany({
    where: { milestoneId: MILESTONE_ID },
  });
  await prisma.milestone.deleteMany({ where: { id: MILESTONE_ID } });
  await prisma.teamMember.deleteMany({ where: { teamId: TEAM_ID } });
  await prisma.team.deleteMany({ where: { id: TEAM_ID } });
  await prisma.program.deleteMany({ where: { id: PROGRAM_ID } });
  await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
}

/**
 * 시나리오 7 의 최소 재현 — 필수 서류가 달린 마감 임박 마일스톤 하나,
 * 승인된 신청 하나, 알림을 받을 수 있는 팀장·팀원 두 명.
 * 프로그램은 DB 기본값 그대로 `notifyOnDeadline` 이 꺼진 채로 만든다.
 */
async function seed(): Promise<void> {
  await prisma.user.createMany({
    data: [
      {
        id: `${TEST_PREFIX}staff`,
        githubId: STAFF_GITHUB_ID,
        nickname: 'deadline-staff',
        selectedMemberKind: MemberKind.STAFF,
        hasStaffAccess: true,
        accountStatus: 'ACTIVE',
      },
      {
        id: LEADER_ID,
        githubId: 9_127_000_002n,
        nickname: 'deadline-leader',
        selectedMemberKind: MemberKind.STUDENT,
        accountStatus: 'ACTIVE',
        notifyEnabled: true,
        notificationEmail: 'deadline-leader@example.invalid',
      },
      {
        id: MEMBER_ID,
        githubId: 9_127_000_003n,
        nickname: 'deadline-member',
        selectedMemberKind: MemberKind.STUDENT,
        accountStatus: 'ACTIVE',
        notifyEnabled: true,
        notificationEmail: 'deadline-member@example.invalid',
      },
    ],
  });
  await prisma.program.create({
    data: {
      id: PROGRAM_ID,
      name: '마감 알림 검증 프로그램',
      organizer: 'OSS Center',
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'basic',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-08-15T00:00:00.000Z'),
      startAt: new Date('2026-08-16T00:00:00.000Z'),
      endAt: new Date('2026-08-31T00:00:00.000Z'),
      description: '마감 알림 스위치 왕복 검증',
    },
  });
  await prisma.milestone.create({
    data: {
      id: MILESTONE_ID,
      programId: PROGRAM_ID,
      name: '중간 보고',
      startAt: new Date('2026-08-16T00:00:00.000Z'),
      dueAt: MILESTONE_DUE_AT,
      submissionType: MilestoneSubmissionType.FILE,
    },
  });
  await prisma.milestoneDocument.createMany({
    data: [
      {
        id: DOCUMENT_REQUIRED_ID,
        milestoneId: MILESTONE_ID,
        name: '중간 보고서',
        required: true,
        sortOrder: 1,
        submissionType: MilestoneSubmissionType.FILE,
      },
      {
        id: DOCUMENT_OPTIONAL_ID,
        milestoneId: MILESTONE_ID,
        name: '참고 자료',
        required: false,
        sortOrder: 2,
        submissionType: MilestoneSubmissionType.FILE,
      },
    ],
  });
  await prisma.team.create({
    data: {
      id: TEAM_ID,
      programId: PROGRAM_ID,
      name: '검증 팀',
      joinCodeDigest: `${TEST_PREFIX}join-code-digest`,
      leaderId: LEADER_ID,
    },
  });
  await prisma.teamMember.createMany({
    data: [
      { teamId: TEAM_ID, programId: PROGRAM_ID, userId: LEADER_ID },
      { teamId: TEAM_ID, programId: PROGRAM_ID, userId: MEMBER_ID },
    ],
  });
  await prisma.application.create({
    data: {
      id: APPLICATION_ID,
      programId: PROGRAM_ID,
      applicantId: LEADER_ID,
      teamId: TEAM_ID,
      answers: {},
      applicationTemplateVersion: 1,
      status: ApplicationStatus.APPROVED,
    },
  });
}

describe('편집 화면의 마감 알림 스위치 — 발송 대상 조회까지', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(async () => {
    await cleanup();
    sentMails.length = 0;
    await seed();
  });

  afterEach(cleanup);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('꺼진 프로그램은 미제출 팀이 있어도 발송 대상 조회 자체가 막힌다', async () => {
    // Given: 필수 서류를 아무도 안 냈지만 프로그램은 꺼져 있다.
    const stored = await prisma.program.findUnique({
      where: { id: PROGRAM_ID },
      select: { notifyOnDeadline: true },
    });
    expect(stored?.notifyOnDeadline).toBe(false);

    // When / Then: 시나리오 7 이 여기서 멈춘다.
    const failure = await digest
      .previewProgram(STAFF_GITHUB_ID, PROGRAM_ID, NOW)
      .catch((caught: unknown) => caught);
    expect(errorCode(failure)).toBe(NotificationsErrorCode.DEADLINE_DISABLED);
  });

  it('편집에서 켜면 미제출 팀원이 실제로 발송 대상으로 돌아온다', async () => {
    // When: 교직원이 편집 화면에서 스위치를 켜 저장한다.
    await editor.updateProgram(
      STAFF_GITHUB_ID,
      PROGRAM_ID,
      updateRequest(true),
    );

    // Then: 켜진 값이 저장되고, 미리보기가 팀장·팀원 두 명을 대상으로 센다.
    const stored = await prisma.program.findUnique({
      where: { id: PROGRAM_ID },
      select: { notifyOnDeadline: true },
    });
    expect(stored?.notifyOnDeadline).toBe(true);

    const preview = await digest.previewProgram(
      STAFF_GITHUB_ID,
      PROGRAM_ID,
      NOW,
    );
    expect(preview).toMatchObject({
      applicationCount: 1,
      milestoneCount: 1,
      recipientCount: 2,
      inactiveCount: 0,
      optedOutCount: 0,
      noEmailCount: 0,
    });
    // 미리보기는 조회일 뿐이다 — 메일은 send 에서만 나간다.
    expect(sentMails).toEqual([]);
  });

  it('필수 서류를 낸 팀은 켠 뒤에도 발송 대상에서 빠진다', async () => {
    // Given: 스위치는 켜져 있다.
    await editor.updateProgram(
      STAFF_GITHUB_ID,
      PROGRAM_ID,
      updateRequest(true),
    );

    // When: 팀이 필수 서류를 제출한다(선택 서류는 그대로 미제출).
    await prisma.milestoneDocumentSubmission.create({
      data: {
        milestoneDocumentId: DOCUMENT_REQUIRED_ID,
        applicationId: APPLICATION_ID,
        submittedById: LEADER_ID,
      },
    });

    // Then: 남은 대상이 없다 — 선택 서류는 알림을 만들지 않는다.
    const preview = await digest.previewProgram(
      STAFF_GITHUB_ID,
      PROGRAM_ID,
      NOW,
    );
    expect(preview).toMatchObject({
      applicationCount: 0,
      recipientCount: 0,
    });
  });

  it('편집에서 다시 끄면 발송 대상 조회가 다시 막힌다', async () => {
    // Given: 켜서 대상이 잡히는 상태를 먼저 확인한다.
    await editor.updateProgram(
      STAFF_GITHUB_ID,
      PROGRAM_ID,
      updateRequest(true),
    );
    expect(
      (await digest.previewProgram(STAFF_GITHUB_ID, PROGRAM_ID, NOW))
        .recipientCount,
    ).toBe(2);

    // When: 교직원이 체크를 풀고 저장한다.
    await editor.updateProgram(
      STAFF_GITHUB_ID,
      PROGRAM_ID,
      updateRequest(false),
    );

    // Then
    const failure = await digest
      .previewProgram(STAFF_GITHUB_ID, PROGRAM_ID, NOW)
      .catch((caught: unknown) => caught);
    expect(errorCode(failure)).toBe(NotificationsErrorCode.DEADLINE_DISABLED);
  });
});
