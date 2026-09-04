import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import {
  AccountStatus,
  ApplicationStatus,
  MemberKind,
  MilestoneDocumentKind,
  MilestoneDocumentSubmissionHistoryEvent,
  SubmissionFileLifecycle,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import type { SubmissionFileStoragePort } from '../submissions/submission-file-storage.port';
import { SubmissionFilesRepository } from '../submissions/submission-files.repository';
import { MilestoneDocumentCurrentFileRepository } from './milestone-document-current-file.repository';
import { MilestoneDocumentCurrentFileService } from './milestone-document-current-file.service';
import { MilestoneDocumentFilesService } from './milestone-document-files.service';
import { MilestoneDocumentsErrorCode } from './milestone-documents-error-code.enum';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';
import { MilestoneDocumentsService } from './milestone-documents.service';

/**
 * #1204 — 같은 서류 줄의 「보기」와 「받기」가 **같은 자격**을 쓰는지 확인한다.
 *
 * 목록은 승인을 묻지 않고 `hasCurrentFile: true`를 말하는데(#1096이 이력에도 같은 판단을
 * 적용했다) 내려받기만 `status: APPROVED`를 요구해, 승인이 되돌려진 학생은 목록이 「있다」고
 * 한 파일을 눌러 MSD_020 404를 받았다. 두 경로는 조회 모양이 아주 달라
 * (목록은 신청을 먼저 찾고 나서 요약을 읽고, 내려받기는 where 하나로 끝낸다) 목 기반
 * 단위 테스트로는 어긋남을 잡을 수 없다 — 같은 DB 상태를 두 경로로 읽는 이 통합 테스트가
 * 그 자리다.
 *
 * 함께 고정하는 것: 느슨해진 조건이 **옆 사람 것까지 열지 않는다**. 남의 팀·무관한
 * 프로그램·다른 마일스톤·팀 밖의 신청자·비활성 계정·목록에 없는 옛 제출 슬롯은 전부 그대로
 * 404다. 교직원은 그 팀의 팀원이더라도 이 학생용 경로에 들어오지 못하고, 교직원 전용 경로는
 * 그대로 같은 파일을 준다. 승인을 묻지 않게 됐어도 파일 수명주기(만료·삭제 대기·현재 리비전)
 * 규칙은 목록과 똑같이 남아 있다.
 */
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prefix = 'milestone-current-file-auth';

const programId = `${prefix}-program`;
const milestoneId = `${prefix}-milestone`;
const otherMilestoneId = `${prefix}-other-milestone`;
const ownDocumentId = `${prefix}-document-own`;
const neighbourDocumentId = `${prefix}-document-neighbour`;
const legacyDocumentId = `${prefix}-document-legacy`;

/** 첨부의 수명주기만 다르고 나머지는 같은 서류 세 줄 — 「받기」가 목록보다 관대해지지 않는지 본다. */
const expiredDocumentId = `${prefix}-document-expired`;
const deletePendingDocumentId = `${prefix}-document-delete-pending`;
const staleRevisionDocumentId = `${prefix}-document-stale-revision`;

/** 이 프로그램과 아무 관계가 없는 두 번째 프로그램 — 「무관한 프로그램」 쪽 증거. */
const outsideProgramId = `${prefix}-outside-program`;
const outsideMilestoneId = `${prefix}-outside-milestone`;
const outsideDocumentId = `${prefix}-outside-document`;

const users = {
  revertedLeader: {
    id: `${prefix}-reverted-leader`,
    githubId: 9_600_000_000_997_001n,
  },
  revertedMember: {
    id: `${prefix}-reverted-member`,
    githubId: 9_600_000_000_997_002n,
  },
  approvedLeader: {
    id: `${prefix}-approved-leader`,
    githubId: 9_600_000_000_997_003n,
  },
  neighbourLeader: {
    id: `${prefix}-neighbour-leader`,
    githubId: 9_600_000_000_997_004n,
  },
  /** `Application.applicantId`이지만 그 팀의 팀장도 팀원도 아닌 사람. */
  departedApplicant: {
    id: `${prefix}-departed-applicant`,
    githubId: 9_600_000_000_997_005n,
  },
  /** 그 신청의 실제 팀장. */
  successorLeader: {
    id: `${prefix}-successor-leader`,
    githubId: 9_600_000_000_997_006n,
  },
  /** 다른 프로그램에만 참여하는 학생. */
  outsider: { id: `${prefix}-outsider`, githubId: 9_600_000_000_997_007n },
  /** 되돌려진 팀의 팀원이지만 계정이 비활성화된 사람. */
  deactivatedMember: {
    id: `${prefix}-deactivated-member`,
    githubId: 9_600_000_000_997_008n,
    accountStatus: AccountStatus.DEACTIVATED,
  },
  /** 교직원 — 이 티켓이 접근 범위를 바꾸지 않아야 하는 쪽. */
  staff: {
    id: `${prefix}-staff`,
    githubId: 9_600_000_000_997_009n,
    hasStaffAccess: true,
  },
  /**
   * 교직원인데 되돌려진 팀의 **팀원**이기도 한 사람. 학생용 where가 교직원을 빼는 조각
   * (`hasStaffAccess`·`hasAdminAccess` false)은 팀 소속과 교직원 권한이 한 사람에게 겹칠
   * 때만 판정을 가른다 — 팀 밖 교직원은 팀 조건에서 이미 걸리므로 그 조각을 지워도 답이
   * 같다. 이 사람이 없으면 그 조각은 시험에 걸리지 않는다.
   */
  staffTeammate: {
    id: `${prefix}-staff-teammate`,
    githubId: 9_600_000_000_997_010n,
    hasStaffAccess: true,
  },
  /** 거절된 신청의 팀장 — 승인 조건을 뺀 뒤 목록과 받기가 여기서도 같은 답을 하는지 본다. */
  rejectedLeader: {
    id: `${prefix}-rejected-leader`,
    githubId: 9_600_000_000_997_011n,
  },
} as const;

const prisma = new PrismaService();
const documentsRepository = new MilestoneDocumentsRepository(prisma);
const documentsService = new MilestoneDocumentsService(documentsRepository);

/** 저장소는 이 테스트의 관심 밖이다 — 키를 그대로 bytes로 되돌려 준다. */
const storage: SubmissionFileStoragePort = {
  put: () => Promise.reject(new Error('unused')),
  get: (objectKey: string) =>
    Promise.resolve(Readable.from(Buffer.from(`bytes:${objectKey}`))),
  delete: () => Promise.reject(new Error('unused')),
};
/**
 * 이 저장소는 Prisma 클라이언트를 **자기가 쓰는 모양만** 받는 좁은 포트로 선언한다(`select`를
 * 고정한 반환 타입). 런타임에는 Nest가 `PrismaService`를 그대로 주입하지만 그 좁은 모양과
 * 구조가 겹치지 않으므로, 여기서만 생성자 인자 타입으로 다시 붙인다.
 */
const currentFileService = new MilestoneDocumentCurrentFileService(
  new MilestoneDocumentCurrentFileRepository(
    prisma as unknown as ConstructorParameters<
      typeof MilestoneDocumentCurrentFileRepository
    >[0],
  ),
  storage,
);

/** 교직원 전용 내려받기 경로 — 이 티켓이 건드리지 않는 쪽의 기준선. */
const staffFilesService = new MilestoneDocumentFilesService(
  documentsRepository,
  storage,
  new SubmissionFilesRepository(prisma),
);

interface TeamFixture {
  readonly key: string;
  readonly leaderId: string;
  /** 팀에 실제로 속한 사람들. 떠난 신청자는 여기 없다. */
  readonly memberIds: readonly string[];
  /** `Application.applicantId` — 기본값은 팀장이다. */
  readonly applicantId?: string;
  readonly status: ApplicationStatus;
}

/** 자식 행 → 부모 행 순서. 통합 러너는 DB를 공유하므로 이 prefix 밖은 건드리지 않는다. */
async function cleanup(): Promise<void> {
  await prisma.submissionFile.deleteMany({
    where: { storageKey: { startsWith: `${prefix}/` } },
  });
  await prisma.milestoneDocumentSubmissionHistory.deleteMany({
    where: { submission: { is: { applicationId: { startsWith: prefix } } } },
  });
  await prisma.milestoneDocumentSubmission.deleteMany({
    where: { applicationId: { startsWith: prefix } },
  });
  await prisma.application.deleteMany({
    where: { programId: { in: [programId, outsideProgramId] } },
  });
  await prisma.teamMember.deleteMany({
    where: { programId: { in: [programId, outsideProgramId] } },
  });
  await prisma.team.deleteMany({
    where: { programId: { in: [programId, outsideProgramId] } },
  });
  await prisma.milestoneDocument.deleteMany({
    where: {
      milestoneId: { in: [milestoneId, otherMilestoneId, outsideMilestoneId] },
    },
  });
  await prisma.milestone.deleteMany({
    where: { id: { in: [milestoneId, otherMilestoneId, outsideMilestoneId] } },
  });
  await prisma.program.deleteMany({
    where: { id: { in: [programId, outsideProgramId] } },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
}

async function createProgram(
  id: string,
  milestoneIds: readonly string[],
): Promise<void> {
  await prisma.program.create({
    data: {
      id,
      name: `synthetic ${id}`,
      organizer: 'OSS Hub',
      category: 'CAPSTONE',
      applicationTemplateKey: 'capstone-v1',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2025-12-01'),
      applicationEndAt: new Date('2026-01-01'),
      startAt: new Date('2026-01-02'),
      endAt: new Date('2026-12-31'),
      description: 'synthetic integration fixture',
      milestones: {
        create: milestoneIds.map((each) => ({
          id: each,
          name: `synthetic ${each}`,
          dueAt: new Date('2026-11-01'),
          submissionType: 'FILE',
        })),
      },
    },
  });
}

async function createTeamWithApplication(
  programIdOfTeam: string,
  team: TeamFixture,
): Promise<string> {
  const teamId = `${prefix}-${team.key}-team`;
  await prisma.team.create({
    data: {
      id: teamId,
      programId: programIdOfTeam,
      name: `synthetic ${team.key} 팀`,
      joinCodeDigest: `digest:${prefix}:${team.key}`,
      leaderId: team.leaderId,
    },
  });
  for (const userId of team.memberIds) {
    await prisma.teamMember.create({
      data: {
        id: `${prefix}-${team.key}-${userId}`,
        teamId,
        programId: programIdOfTeam,
        userId,
      },
    });
  }
  const applicationId = `${prefix}-${team.key}-application`;
  await prisma.application.create({
    data: {
      id: applicationId,
      programId: programIdOfTeam,
      applicantId: team.applicantId ?? team.leaderId,
      teamId,
      answers: { syntheticFixture: true },
      applicationTemplateVersion: 1,
      status: team.status,
      processedAt: new Date('2026-02-01'),
    },
  });
  return applicationId;
}

/**
 * 제출 행 + 제출 이력 한 건 + 현재 리비전에 붙은 살아 있는 첨부 하나.
 *
 * 기본값이 「목록이 hasCurrentFile: true라고 말하는 상태」다. 선택 인자는 그 상태에서
 * **첨부만** 어긋나게 만든다 — 이 티켓이 건드리지 않기로 한 파일 수명주기 규칙(만료·삭제
 * 대기·현재 리비전 일치)이 받기 쪽에서도 그대로인지 보기 위해서다.
 */
async function seedSubmissionWithFile(input: {
  readonly key: string;
  readonly documentId: string;
  readonly applicationId: string;
  readonly actorId: string;
  readonly milestoneIdOfFile: string;
  /** 제출 행의 현재 리비전. 이력 리비전과 다르게 두면 첨부가 「옛 제출본」이 된다. */
  readonly revision?: number;
  readonly historyRevision?: number;
  readonly lifecycle?: SubmissionFileLifecycle;
  readonly expiresAt?: Date;
}): Promise<string> {
  const submissionId = `${prefix}-${input.key}-submission`;
  const revision = input.revision ?? 1;
  await prisma.milestoneDocumentSubmission.create({
    data: {
      id: submissionId,
      milestoneDocumentId: input.documentId,
      applicationId: input.applicationId,
      submittedById: input.actorId,
      submittedAt: new Date('2026-03-01'),
      revision,
    },
  });
  const historyId = `${prefix}-${input.key}-history`;
  await prisma.milestoneDocumentSubmissionHistory.create({
    data: {
      id: historyId,
      milestoneDocumentSubmissionId: submissionId,
      event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
      revision: input.historyRevision ?? revision,
      actorId: input.actorId,
      createdAt: new Date('2026-03-01'),
    },
  });
  const storageKey = `${prefix}/${input.key}.pdf`;
  await prisma.submissionFile.create({
    data: {
      id: `${prefix}-${input.key}-file`,
      uploaderId: input.actorId,
      applicationId: input.applicationId,
      milestoneId: input.milestoneIdOfFile,
      storageKey,
      originalFileName: `${input.key}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: `bytes:${storageKey}`.length,
      milestoneDocumentSubmissionId: submissionId,
      milestoneDocumentSubmissionHistoryId: historyId,
      // PENDING은 DB 제약이 milestoneDocumentSubmissionId를 금지하므로(#164·#619 check
      // 제약) 「첨부됐다가 지워지는 중」은 DELETE_PENDING으로 세운다.
      lifecycle: input.lifecycle ?? SubmissionFileLifecycle.ATTACHED,
      expiresAt: input.expiresAt ?? new Date('2099-01-01'),
    },
  });
  return storageKey;
}

async function downloadFails(
  githubId: bigint,
  requestedMilestoneId: string,
  documentId: string,
): Promise<{ readonly code: string; readonly status: number }> {
  try {
    await currentFileService.download(
      githubId,
      requestedMilestoneId,
      documentId,
    );
  } catch (error: unknown) {
    const { errorCode } = error as {
      errorCode: { code: string; status: number };
    };
    return { code: errorCode.code, status: errorCode.status };
  }
  throw new Error('내려받기가 거절되지 않았습니다.');
}

const hiddenAsMissing = {
  code: MilestoneDocumentsErrorCode.SUBMISSION_FILE_NOT_FOUND,
  status: 404,
};

let ownStorageKey = '';
let neighbourStorageKey = '';
let outsideStorageKey = '';
let revertedApplicationId = '';

describe('마일스톤 서류 현재 제출 파일 — 「보기」와 「받기」의 자격', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await cleanup();

    await prisma.user.createMany({
      data: Object.entries(users).map(([key, user]) => ({
        id: user.id,
        githubId: user.githubId,
        nickname: `${prefix}-${key}`,
        selectedMemberKind: MemberKind.STUDENT,
        accountStatus:
          'accountStatus' in user ? user.accountStatus : AccountStatus.ACTIVE,
        hasStaffAccess: 'hasStaffAccess' in user ? user.hasStaffAccess : false,
      })),
    });

    await createProgram(programId, [milestoneId, otherMilestoneId]);
    await createProgram(outsideProgramId, [outsideMilestoneId]);

    await prisma.milestoneDocument.createMany({
      data: [
        {
          id: ownDocumentId,
          milestoneId,
          name: '내 팀이 낸 서류',
          required: true,
          sortOrder: 1,
        },
        {
          id: neighbourDocumentId,
          milestoneId,
          name: '옆 팀만 낸 서류',
          required: false,
          sortOrder: 2,
        },
        {
          id: legacyDocumentId,
          milestoneId,
          name: '옛 마일스톤 제출 슬롯',
          required: false,
          sortOrder: 3,
          kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
        },
        {
          id: expiredDocumentId,
          milestoneId,
          name: '첨부가 만료된 서류',
          required: false,
          sortOrder: 4,
        },
        {
          id: deletePendingDocumentId,
          milestoneId,
          name: '첨부가 삭제 대기로 넘어간 서류',
          required: false,
          sortOrder: 5,
        },
        {
          id: staleRevisionDocumentId,
          milestoneId,
          name: '첨부가 옛 제출본에 남은 서류',
          required: false,
          sortOrder: 6,
        },
        {
          id: outsideDocumentId,
          milestoneId: outsideMilestoneId,
          name: '무관한 프로그램의 서류',
          required: true,
          sortOrder: 1,
        },
      ],
    });

    // 승인됐다가 교직원이 「검토 대기로 되돌리기」한 신청 — 제출 행도 첨부도 그대로다.
    // 비활성 계정도 이 팀의 팀원이다: 「팀원인가」만으로는 문이 열리지 않는 것을 보이기 위해서다.
    revertedApplicationId = await createTeamWithApplication(programId, {
      key: 'reverted',
      leaderId: users.revertedLeader.id,
      memberIds: [
        users.revertedLeader.id,
        users.revertedMember.id,
        users.deactivatedMember.id,
        users.staffTeammate.id,
      ],
      status: ApplicationStatus.SUBMITTED,
    });
    ownStorageKey = await seedSubmissionWithFile({
      key: 'reverted-own',
      documentId: ownDocumentId,
      applicationId: revertedApplicationId,
      actorId: users.revertedLeader.id,
      milestoneIdOfFile: milestoneId,
    });
    await seedSubmissionWithFile({
      key: 'reverted-legacy',
      documentId: legacyDocumentId,
      applicationId: revertedApplicationId,
      actorId: users.revertedLeader.id,
      milestoneIdOfFile: milestoneId,
    });
    // 아래 셋은 「제출은 있는데 현재 첨부가 없다」의 세 가지 이유다. 목록은 이 셋을
    // hasCurrentFile: false로 말하므로 받기도 404여야 한다.
    await seedSubmissionWithFile({
      key: 'reverted-expired',
      documentId: expiredDocumentId,
      applicationId: revertedApplicationId,
      actorId: users.revertedLeader.id,
      milestoneIdOfFile: milestoneId,
      expiresAt: new Date('2026-01-01'),
    });
    await seedSubmissionWithFile({
      key: 'reverted-delete-pending',
      documentId: deletePendingDocumentId,
      applicationId: revertedApplicationId,
      actorId: users.revertedLeader.id,
      milestoneIdOfFile: milestoneId,
      lifecycle: SubmissionFileLifecycle.DELETE_PENDING,
    });
    await seedSubmissionWithFile({
      key: 'reverted-stale-revision',
      documentId: staleRevisionDocumentId,
      applicationId: revertedApplicationId,
      actorId: users.revertedLeader.id,
      milestoneIdOfFile: milestoneId,
      revision: 2,
      historyRevision: 1,
    });

    // 거절된 신청 — 승인 조건을 뺀 뒤에도 목록과 받기가 같은 답을 하는지의 세 번째 상태다
    // (SUBMITTED·APPROVED·REJECTED가 ApplicationStatus의 전부다).
    const rejectedApplicationId = await createTeamWithApplication(programId, {
      key: 'rejected',
      leaderId: users.rejectedLeader.id,
      memberIds: [users.rejectedLeader.id],
      status: ApplicationStatus.REJECTED,
    });
    await seedSubmissionWithFile({
      key: 'rejected-own',
      documentId: ownDocumentId,
      applicationId: rejectedApplicationId,
      actorId: users.rejectedLeader.id,
      milestoneIdOfFile: milestoneId,
    });

    // 승인이 유지된 신청 — 이 티켓의 회귀 기준선.
    const approvedApplicationId = await createTeamWithApplication(programId, {
      key: 'approved',
      leaderId: users.approvedLeader.id,
      memberIds: [users.approvedLeader.id],
      status: ApplicationStatus.APPROVED,
    });
    await seedSubmissionWithFile({
      key: 'approved-own',
      documentId: ownDocumentId,
      applicationId: approvedApplicationId,
      actorId: users.approvedLeader.id,
      milestoneIdOfFile: milestoneId,
    });

    // 같은 프로그램의 옆 팀 — 이 팀만 낸 서류가 있다.
    const neighbourApplicationId = await createTeamWithApplication(programId, {
      key: 'neighbour',
      leaderId: users.neighbourLeader.id,
      memberIds: [users.neighbourLeader.id],
      status: ApplicationStatus.APPROVED,
    });
    neighbourStorageKey = await seedSubmissionWithFile({
      key: 'neighbour-only',
      documentId: neighbourDocumentId,
      applicationId: neighbourApplicationId,
      actorId: users.neighbourLeader.id,
      milestoneIdOfFile: milestoneId,
    });

    // `applicantId`가 팀 밖을 가리키는 신청 — 방어용 fixture다. 지금 제품에는 이 상태를
    // 만드는 경로가 없고(`ProgramTeamsRepository.leave`는 신청이 붙은 팀의 탈퇴를 'locked'로
    // 거절한다) 그래서 DB에 직접 심는다. 요점은 「어쩌다 이런 행이 생기든 목록과 받기가 같은
    // 답을 한다」이지 「이 일이 실제로 일어난다」가 아니다.
    const departedApplicationId = await createTeamWithApplication(programId, {
      key: 'departed',
      leaderId: users.successorLeader.id,
      memberIds: [users.successorLeader.id],
      applicantId: users.departedApplicant.id,
      status: ApplicationStatus.APPROVED,
    });
    await seedSubmissionWithFile({
      key: 'departed-team',
      documentId: neighbourDocumentId,
      applicationId: departedApplicationId,
      actorId: users.successorLeader.id,
      milestoneIdOfFile: milestoneId,
    });

    // 무관한 프로그램의 학생과 그 학생의 파일.
    const outsideApplicationId = await createTeamWithApplication(
      outsideProgramId,
      {
        key: 'outsider',
        leaderId: users.outsider.id,
        memberIds: [users.outsider.id],
        status: ApplicationStatus.APPROVED,
      },
    );
    outsideStorageKey = await seedSubmissionWithFile({
      key: 'outsider-own',
      documentId: outsideDocumentId,
      applicationId: outsideApplicationId,
      actorId: users.outsider.id,
      milestoneIdOfFile: outsideMilestoneId,
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('되돌려진 학생이 목록에서 본 파일을 그대로 받는다', async () => {
    // Given: 목록이 「현재 파일이 있다」고 말한다 — 되돌리기는 이 사실을 바꾸지 않는다.
    const documents = await documentsService.listForViewer(
      users.revertedLeader.githubId,
      milestoneId,
    );
    const own = documents.find((document) => document.id === ownDocumentId);
    expect(own?.viewerSubmission?.hasCurrentFile).toBe(true);

    // When
    const file = await currentFileService.download(
      users.revertedLeader.githubId,
      milestoneId,
      ownDocumentId,
    );

    // Then: 목록이 있다고 한 그 파일이 그대로 온다.
    expect(file.fileName).toBe('reverted-own.pdf');
    expect(file.contentType).toBe('application/pdf');
    await expect(buffer(file.body)).resolves.toEqual(
      Buffer.from(`bytes:${ownStorageKey}`),
    );
  });

  it('되돌려진 신청의 팀원도 같은 파일을 받는다', async () => {
    // Given / When
    const file = await currentFileService.download(
      users.revertedMember.githubId,
      milestoneId,
      ownDocumentId,
    );

    // Then
    expect(file.fileName).toBe('reverted-own.pdf');
    await expect(buffer(file.body)).resolves.toEqual(
      Buffer.from(`bytes:${ownStorageKey}`),
    );
  });

  /**
   * `ApplicationStatus`는 SUBMITTED·APPROVED·REJECTED 셋이다. 승인 조건을 뺐다는 것은
   * 되돌려진(SUBMITTED) 신청만이 아니라 **거절된 신청도** 열린다는 뜻이므로, 그 상태에서도
   * 목록과 받기가 갈라지지 않는 것을 따로 못박는다. 위 `it.each`만으로는 목록이 이 사람에게
   * hasCurrentFile: false를 말할 때 「둘 다 404」로 조용히 통과할 수 있다.
   */
  it('거절된 신청의 학생에게도 목록과 받기가 같은 답을 한다', async () => {
    // Given: 목록이 「현재 파일이 있다」고 말한다.
    const documents = await documentsService.listForViewer(
      users.rejectedLeader.githubId,
      milestoneId,
    );
    const own = documents.find((document) => document.id === ownDocumentId);
    expect(own?.viewerSubmission?.hasCurrentFile).toBe(true);

    // When / Then: 그 파일이 그대로 온다 — 자기 팀 것이다.
    const file = await currentFileService.download(
      users.rejectedLeader.githubId,
      milestoneId,
      ownDocumentId,
    );
    expect(file.fileName).toBe('rejected-own.pdf');
  });

  /**
   * 이 티켓은 파일 수명주기(만료·삭제·현재 리비전) 규칙을 바꾸지 않는다. 승인 조건을 빼면서
   * 「제출 행이 있으면 받아진다」로 넓어지지 않았는지, 목록이 hasCurrentFile: false라고 말하는
   * 세 가지 이유를 각각 세워 확인한다.
   */
  it.each([
    ['만료된 첨부', expiredDocumentId],
    ['삭제 대기로 넘어간 첨부', deletePendingDocumentId],
    ['옛 제출본에 남은 첨부', staleRevisionDocumentId],
  ])('%s: 목록에도 없고 받기에서도 404다', async (_label, documentId) => {
    // Given
    const documents = await documentsService.listForViewer(
      users.revertedLeader.githubId,
      milestoneId,
    );
    const target = documents.find((document) => document.id === documentId);
    expect(target?.viewerSubmission?.submitted).toBe(true);
    expect(target?.viewerSubmission?.hasCurrentFile).toBe(false);

    // When / Then
    await expect(
      downloadFails(users.revertedLeader.githubId, milestoneId, documentId),
    ).resolves.toEqual(hiddenAsMissing);
  });

  it('승인이 유지된 학생의 내려받기는 그대로다', async () => {
    // Given / When: 이 티켓이 바꾸지 않아야 하는 기존 흐름.
    const file = await currentFileService.download(
      users.approvedLeader.githubId,
      milestoneId,
      ownDocumentId,
    );

    // Then: 같은 서류 항목이라도 각자 자기 팀 파일을 받는다.
    expect(file.fileName).toBe('approved-own.pdf');
  });

  /**
   * 이 티켓의 계약을 한 줄로 고정한다 — 「목록이 보여 준 것만, 그러나 전부 받을 수 있다」.
   * 두 경로가 갈라지면(한쪽만 승인을 묻거나, 한쪽만 kind를 거르면) 이 테스트가 깨진다.
   */
  it.each([
    ['되돌려진 팀장', users.revertedLeader.githubId],
    ['되돌려진 팀원', users.revertedMember.githubId],
    ['승인이 유지된 팀장', users.approvedLeader.githubId],
    ['거절된 신청의 팀장', users.rejectedLeader.githubId],
    ['옆 팀 팀장', users.neighbourLeader.githubId],
  ])(
    '%s의 목록에서 hasCurrentFile인 서류는 전부 받아지고, 아닌 서류는 전부 404다',
    async (_label, githubId) => {
      // Given
      const documents = await documentsService.listForViewer(
        githubId,
        milestoneId,
      );
      expect(documents.length).toBeGreaterThan(0);

      // When / Then
      for (const document of documents) {
        if (document.viewerSubmission?.hasCurrentFile === true) {
          await expect(
            currentFileService.download(githubId, milestoneId, document.id),
          ).resolves.toMatchObject({ contentType: 'application/pdf' });
        } else {
          await expect(
            downloadFails(githubId, milestoneId, document.id),
          ).resolves.toEqual(hiddenAsMissing);
        }
      }
    },
  );

  it('남의 팀만 낸 서류는 파일이 있어도 존재하지 않는 파일과 같은 404다', async () => {
    // Given: 옆 팀은 이 서류에 살아 있는 첨부를 갖고 있다.
    await expect(
      currentFileService.download(
        users.neighbourLeader.githubId,
        milestoneId,
        neighbourDocumentId,
      ),
    ).resolves.toMatchObject({ fileName: 'neighbour-only.pdf' });

    // When / Then: 되돌려진 학생에게는 그 줄이 열리지 않는다.
    await expect(
      downloadFails(
        users.revertedLeader.githubId,
        milestoneId,
        neighbourDocumentId,
      ),
    ).resolves.toEqual(hiddenAsMissing);
    expect(neighbourStorageKey).toBe(`${prefix}/neighbour-only.pdf`);
  });

  it('무관한 프로그램의 서류는 양쪽 방향 모두 404다', async () => {
    // Given: 무관한 프로그램의 학생은 자기 파일을 받는다.
    await expect(
      currentFileService.download(
        users.outsider.githubId,
        outsideMilestoneId,
        outsideDocumentId,
      ),
    ).resolves.toMatchObject({ fileName: 'outsider-own.pdf' });
    expect(outsideStorageKey).toBe(`${prefix}/outsider-own.pdf`);

    // When / Then
    await expect(
      downloadFails(
        users.revertedLeader.githubId,
        outsideMilestoneId,
        outsideDocumentId,
      ),
    ).resolves.toEqual(hiddenAsMissing);
    await expect(
      downloadFails(users.outsider.githubId, milestoneId, ownDocumentId),
    ).resolves.toEqual(hiddenAsMissing);
  });

  it('같은 프로그램의 다른 마일스톤 id로는 같은 서류도 열리지 않는다', async () => {
    // Given / When / Then
    await expect(
      downloadFails(
        users.revertedLeader.githubId,
        otherMilestoneId,
        ownDocumentId,
      ),
    ).resolves.toEqual(hiddenAsMissing);
  });

  /**
   * `applicantId`는 「받기」의 문이 아니다. 목록·이력은 팀 소속 하나로 판정하므로
   * (`submissionParticipantWhere`) 팀 밖의 신청자에게는 이미 닫혀 있고, 받기만 그 갈래를
   * 들고 있으면 **목록에 없는 파일이 열린다**. 지금 제품에 이 행을 만드는 경로가 없다는 것은
   * 이 갈래가 아무도 지키지 못한다는 뜻이기도 하다 — 지워도 잃는 접근이 없다.
   */
  it('팀을 떠난 신청자에게는 목록도 받기도 닫혀 있다', async () => {
    // Given
    const documents = await documentsService.listForViewer(
      users.departedApplicant.githubId,
      milestoneId,
    );
    expect(
      documents.every((document) => document.viewerSubmission === undefined),
    ).toBe(true);

    // When / Then
    await expect(
      downloadFails(
        users.departedApplicant.githubId,
        milestoneId,
        neighbourDocumentId,
      ),
    ).resolves.toEqual(hiddenAsMissing);
  });

  it('목록에 뜨지 않는 옛 제출 슬롯은 받기에서도 없다', async () => {
    // Given: 되돌려진 팀은 이 슬롯에도 살아 있는 첨부를 갖고 있지만 목록에는 없다.
    const documents = await documentsService.listForViewer(
      users.revertedLeader.githubId,
      milestoneId,
    );
    expect(documents.map((document) => document.id)).not.toContain(
      legacyDocumentId,
    );

    // When / Then
    await expect(
      downloadFails(
        users.revertedLeader.githubId,
        milestoneId,
        legacyDocumentId,
      ),
    ).resolves.toEqual(hiddenAsMissing);
  });

  /**
   * 계정이 비활성화되면 목록은 학생 칸을 아예 내려주지 않는다(`findActiveUser`). 팀원 자격만
   * 남고 계정이 죽은 사람에게 받기만 열려 있으면 두 답이 갈린다 — 「팀원인가」는 세 조건 중
   * 하나일 뿐이다.
   */
  it('비활성 계정은 팀원이어도 목록도 받기도 닫혀 있다', async () => {
    // Given
    const documents = await documentsService.listForViewer(
      users.deactivatedMember.githubId,
      milestoneId,
    );
    expect(
      documents.every((document) => document.viewerSubmission === undefined),
    ).toBe(true);

    // When / Then
    await expect(
      downloadFails(
        users.deactivatedMember.githubId,
        milestoneId,
        ownDocumentId,
      ),
    ).resolves.toEqual(hiddenAsMissing);
  });

  /**
   * 이 티켓은 교직원의 접근 범위를 바꾸지 않는다. 교직원은 학생용 「현재 파일」 경로의 문이
   * 아니다 — 목록도 교직원에게는 `viewerSubmission`을 내려주지 않아 누를 자리가 없다.
   */
  it('교직원은 학생 경로로 받지 못한다', async () => {
    // Given: 교직원 목록에는 학생용 제출 칸이 없다.
    const documents = await documentsService.listForViewer(
      users.staff.githubId,
      milestoneId,
    );
    expect(
      documents.every((document) => document.viewerSubmission === undefined),
    ).toBe(true);

    // When / Then: 학생 경로는 교직원에게 닫혀 있다(#1204 이전과 같다).
    await expect(
      downloadFails(users.staff.githubId, milestoneId, ownDocumentId),
    ).resolves.toEqual(hiddenAsMissing);
  });

  /**
   * 위 시험은 교직원을 **팀 밖**에 두므로 팀 조건에서 이미 걸린다 — 학생용 where에서 교직원을
   * 빼는 조각(`hasStaffAccess`·`hasAdminAccess` false)을 지워도 답이 같다. 그 조각이 실제로
   * 판정을 가르는 것은 한 사람에게 팀 소속과 교직원 권한이 겹칠 때뿐이라, 그 사람을 따로 세운다.
   *
   * 목록은 이 사람을 교직원 분기로 보내 `viewerSubmission`을 내려주지 않으므로, 받기도 닫혀
   * 있어야 두 경로가 같은 답을 한다.
   */
  it('교직원은 그 팀의 팀원이어도 학생 경로로 받지 못한다', async () => {
    // Given: 되돌려진 팀의 팀원이지만 목록은 학생 칸을 주지 않는다.
    const documents = await documentsService.listForViewer(
      users.staffTeammate.githubId,
      milestoneId,
    );
    expect(
      documents.every((document) => document.viewerSubmission === undefined),
    ).toBe(true);

    // When / Then: 팀원 자격만으로는 학생 경로가 열리지 않는다.
    await expect(
      downloadFails(users.staffTeammate.githubId, milestoneId, ownDocumentId),
    ).resolves.toEqual(hiddenAsMissing);
  });

  /**
   * 교직원 전용 경로는 이 티켓이 한 줄도 건드리지 않았다 — 되돌려진 신청의 같은 파일을 승인
   * 조건 없이 그대로 준다. 역할 검사는 이 서비스가 아니라 앞단의
   * `MilestoneDocumentsStaffGuard`가 하므로(서비스는 사용자 인자를 받지 않는다) 이 시험이
   * 고정하는 것은 **경로의 결과**이지 누가 그 경로에 들어올 수 있는가가 아니다.
   */
  it('교직원 전용 경로는 되돌려진 신청의 같은 파일을 그대로 돌려준다', async () => {
    // Given / When
    const file = await staffFilesService.downloadSubmissionFile(
      milestoneId,
      ownDocumentId,
      revertedApplicationId,
    );

    // Then
    await expect(buffer(file.body)).resolves.toEqual(
      Buffer.from(`bytes:${ownStorageKey}`),
    );
  });
});
