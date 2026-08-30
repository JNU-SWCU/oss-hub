import { AccountStatus, Prisma, ProgramLifecycle } from '@prisma/client';
import {
  PROGRAM_DELETION_AUDIT_ACTIONS,
  PROGRAM_LIFECYCLE_AUDIT_ACTIONS,
} from '../../audit-log/audit-log-metadata';
import type { AuditLogRecordInput } from '../../audit-log/audit-log.repository';
import type { AuditLogService } from '../../audit-log/audit-log.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ProgramDeletionScopeCounts } from '../program-deletion-scope';
import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from '../program-error-code.enum';
import { ProgramLifecycleService } from './program-lifecycle.service';

// 합성 데이터만 사용한다 (docs/rules/security.md)
function createService(
  overrides: {
    readonly user?: unknown;
    readonly program?: unknown;
  } = {},
) {
  const userFindUnique = jest.fn().mockResolvedValue(
    overrides.user ?? {
      hasStaffAccess: false,
      hasAdminAccess: true,
      accountStatus: AccountStatus.ACTIVE,
    },
  );
  const programFindUnique = jest.fn().mockResolvedValue(
    'program' in overrides
      ? overrides.program
      : {
          id: 'program-1',
          name: '합성 프로그램 이름',
          lifecycle: ProgramLifecycle.PUBLISHED,
        },
  );
  const programUpdate = jest.fn().mockResolvedValue(undefined);
  const record = jest
    .fn<Promise<void>, [AuditLogRecordInput]>()
    .mockResolvedValue(undefined);
  const transactionClient = {
    program: { findUnique: programFindUnique, update: programUpdate },
  };
  const prisma = {
    user: { findUnique: userFindUnique },
    $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
      callback(transactionClient),
    ),
  } as unknown as PrismaService;
  const auditLog = { record } as unknown as AuditLogService;
  const service = new ProgramLifecycleService(prisma, auditLog);
  return { service, userFindUnique, programFindUnique, programUpdate, record };
}

describe('ProgramLifecycleService', () => {
  it('lifecycle 변경 시 select에 name을 포함해 조회하고, 감사 metadata에 이름 스냅샷을 담는다', async () => {
    const { service, programFindUnique, record } = createService();

    await service.update(1001n, 'program-1', ProgramLifecycle.ARCHIVED);

    expect(programFindUnique).toHaveBeenCalledWith({
      where: { id: 'program-1' },
      select: { id: true, name: true, lifecycle: true },
    });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      action: PROGRAM_LIFECYCLE_AUDIT_ACTIONS.PROGRAM_ARCHIVED,
      targetType: 'PROGRAM',
      targetId: 'program-1',
      metadata: {
        schemaVersion: 2,
        programName: '합성 프로그램 이름',
        before: { lifecycle: ProgramLifecycle.PUBLISHED },
        after: { lifecycle: ProgramLifecycle.ARCHIVED },
      },
    });
  });

  it('PROGRAM_RESTORED에도 같은 이름 스냅샷 규약을 적용한다', async () => {
    const { service, record } = createService({
      program: {
        id: 'program-2',
        name: '합성 복구 대상',
        lifecycle: ProgramLifecycle.ARCHIVED,
      },
    });

    await service.update(1001n, 'program-2', ProgramLifecycle.PUBLISHED);

    expect(record.mock.calls[0]?.[0]).toMatchObject({
      action: PROGRAM_LIFECYCLE_AUDIT_ACTIONS.PROGRAM_RESTORED,
      metadata: {
        programName: '합성 복구 대상',
      },
    });
  });

  it('lifecycle이 이미 같으면 감사 행을 쓰지 않는다', async () => {
    const { service, record } = createService();

    await service.update(1001n, 'program-1', ProgramLifecycle.PUBLISHED);

    expect(record).not.toHaveBeenCalled();
  });

  it('program을 찾지 못하면 PROGRAM_NOT_FOUND를 던진다', async () => {
    const { service } = createService({ program: null });

    await expect(
      service.update(1001n, 'missing-program', ProgramLifecycle.ARCHIVED),
    ).rejects.toMatchObject({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_NOT_FOUND],
    });
  });

  it('STAFF/ADMIN이 아니거나 비활성 계정이면 거부하고 조회조차 하지 않는다', async () => {
    const { service, programFindUnique } = createService({
      user: { role: 'STUDENT', accountStatus: AccountStatus.ACTIVE },
    });

    await expect(
      service.update(1001n, 'program-1', ProgramLifecycle.ARCHIVED),
    ).rejects.toMatchObject({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.STAFF_APPROVAL_REQUIRED],
    });
    expect(programFindUnique).not.toHaveBeenCalled();
  });
});

// 합성 데이터만 사용한다 (docs/rules/security.md)
function createDeleteService(
  overrides: {
    readonly user?: unknown;
    readonly program?: unknown;
    readonly blockingCounts?: Partial<{
      readonly applications: number;
      readonly teams: number;
      readonly boardPosts: number;
      readonly submissions: number;
    }>;
    readonly createRequest?: unknown;
    readonly milestones?: readonly { readonly id: string }[];
    readonly milestoneDocuments?: readonly { readonly id: string }[];
    readonly orphanRepositoryCount?: number;
  } = {},
) {
  const userFindUnique = jest.fn().mockResolvedValue(
    overrides.user ?? {
      hasStaffAccess: false,
      hasAdminAccess: true,
      accountStatus: AccountStatus.ACTIVE,
    },
  );
  const programFindUnique = jest.fn().mockResolvedValue(
    'program' in overrides
      ? overrides.program
      : {
          id: 'program-1',
          name: '합성 삭제 대상 프로그램',
          lifecycle: ProgramLifecycle.PUBLISHED,
        },
  );
  const counts = {
    applications: 0,
    teams: 0,
    boardPosts: 0,
    submissions: 0,
    ...overrides.blockingCounts,
  };
  const applicationCount = jest.fn().mockResolvedValue(counts.applications);
  const teamCount = jest.fn().mockResolvedValue(counts.teams);
  const boardPostCount = jest.fn().mockResolvedValue(counts.boardPosts);
  const milestoneDocumentSubmissionCount = jest
    .fn()
    .mockResolvedValue(counts.submissions);
  const programCreateRequestFindUnique = jest
    .fn()
    .mockResolvedValue(
      'createRequest' in overrides ? overrides.createRequest : null,
    );
  const programAuthoringUploadDeleteMany = jest
    .fn()
    .mockResolvedValue({ count: 0 });
  const programCreateRequestDelete = jest.fn().mockResolvedValue(undefined);
  const milestoneFindMany = jest
    .fn()
    .mockResolvedValue(overrides.milestones ?? []);
  const milestoneDocumentFindMany = jest
    .fn()
    .mockResolvedValue(overrides.milestoneDocuments ?? []);
  const milestoneDocumentTemplateFileDeleteMany = jest
    .fn()
    .mockResolvedValue({ count: 0 });
  const submissionFileDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const milestoneDocumentDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const milestoneDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const programDelete = jest.fn().mockResolvedValue(undefined);
  const repositoryCount = jest
    .fn()
    .mockResolvedValue(overrides.orphanRepositoryCount ?? 0);
  const record = jest
    .fn<Promise<void>, [AuditLogRecordInput]>()
    .mockResolvedValue(undefined);
  const transactionClient = {
    program: { findUnique: programFindUnique, delete: programDelete },
    application: { count: applicationCount },
    team: { count: teamCount },
    boardPost: { count: boardPostCount },
    githubRepository: { count: repositoryCount },
    milestoneDocumentSubmission: { count: milestoneDocumentSubmissionCount },
    programCreateRequest: {
      findUnique: programCreateRequestFindUnique,
      delete: programCreateRequestDelete,
    },
    programAuthoringUpload: { deleteMany: programAuthoringUploadDeleteMany },
    milestone: { findMany: milestoneFindMany, deleteMany: milestoneDeleteMany },
    milestoneDocument: {
      findMany: milestoneDocumentFindMany,
      deleteMany: milestoneDocumentDeleteMany,
    },
    milestoneDocumentTemplateFile: {
      deleteMany: milestoneDocumentTemplateFileDeleteMany,
    },
    submissionFile: { deleteMany: submissionFileDeleteMany },
  };
  const prisma = {
    user: { findUnique: userFindUnique },
    $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
      callback(transactionClient),
    ),
  } as unknown as PrismaService;
  const auditLog = { record } as unknown as AuditLogService;
  const service = new ProgramLifecycleService(prisma, auditLog);
  return {
    service,
    userFindUnique,
    programFindUnique,
    applicationCount,
    teamCount,
    boardPostCount,
    programCreateRequestFindUnique,
    programAuthoringUploadDeleteMany,
    programCreateRequestDelete,
    milestoneFindMany,
    milestoneDocumentFindMany,
    milestoneDocumentTemplateFileDeleteMany,
    submissionFileDeleteMany,
    milestoneDocumentDeleteMany,
    milestoneDeleteMany,
    programDelete,
    repositoryCount,
    milestoneDocumentSubmissionCount,
    record,
  };
}

describe('ProgramLifecycleService.delete — ADMIN 전용 영구 삭제 (#875)', () => {
  it('ADMIN이 차단 사유 없는 프로그램을 삭제하면 자식 스캐폴딩을 지우고 감사 로그를 남긴다', async () => {
    const {
      service,
      programDelete,
      milestoneDeleteMany,
      milestoneDocumentDeleteMany,
      milestoneDocumentTemplateFileDeleteMany,
      submissionFileDeleteMany,
      programCreateRequestDelete,
      programAuthoringUploadDeleteMany,
      record,
    } = createDeleteService({
      createRequest: { id: 'create-request-1', actorId: 'actor-1' },
      milestones: [{ id: 'milestone-1' }],
      milestoneDocuments: [{ id: 'document-1' }],
    });

    const result = await service.delete(1001n, 'program-1');

    expect(result).toEqual({ id: 'program-1', deleted: true });
    expect(programAuthoringUploadDeleteMany).toHaveBeenCalledWith({
      where: {
        createRequestId: 'create-request-1',
        createRequestActorId: 'actor-1',
      },
    });
    expect(programCreateRequestDelete).toHaveBeenCalledWith({
      where: { programId: 'program-1' },
    });
    expect(milestoneDocumentTemplateFileDeleteMany).toHaveBeenCalledWith({
      where: { milestoneDocumentId: { in: ['document-1'] } },
    });
    expect(submissionFileDeleteMany).toHaveBeenCalledWith({
      where: { milestoneId: { in: ['milestone-1'] } },
    });
    expect(milestoneDocumentDeleteMany).toHaveBeenCalledWith({
      where: { milestoneId: { in: ['milestone-1'] } },
    });
    expect(milestoneDeleteMany).toHaveBeenCalledWith({
      where: { programId: 'program-1' },
    });
    expect(programDelete).toHaveBeenCalledWith({
      where: { id: 'program-1' },
    });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      action: PROGRAM_DELETION_AUDIT_ACTIONS.PROGRAM_DELETED,
      targetType: 'PROGRAM',
      targetId: 'program-1',
      metadata: {
        programName: '합성 삭제 대상 프로그램',
        lifecycle: ProgramLifecycle.PUBLISHED,
        blockingCounts: {
          applications: 0,
          teams: 0,
          submissions: 0,
          boardPosts: 0,
        },
      },
    });
  });

  it('STAFF는 프로그램을 생성했더라도 403을 받는다', async () => {
    const { service, programFindUnique } = createDeleteService({
      user: { role: 'STAFF', accountStatus: AccountStatus.ACTIVE },
    });

    await expect(service.delete(1001n, 'program-1')).rejects.toMatchObject({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_FORBIDDEN],
    });
    expect(programFindUnique).not.toHaveBeenCalled();
  });

  it('STUDENT는 403을 받는다', async () => {
    const { service, programFindUnique } = createDeleteService({
      user: { role: 'STUDENT', accountStatus: AccountStatus.ACTIVE },
    });

    await expect(service.delete(1001n, 'program-1')).rejects.toMatchObject({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_FORBIDDEN],
    });
    expect(programFindUnique).not.toHaveBeenCalled();
  });

  it('program을 찾지 못하면 PROGRAM_NOT_FOUND를 던진다', async () => {
    const { service } = createDeleteService({ program: null });

    await expect(
      service.delete(1001n, 'missing-program'),
    ).rejects.toMatchObject({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_NOT_FOUND],
    });
  });

  it('deletionProtected가 true면 차단 사유 조회 없이 409 PRG_013으로 거부하고 ADMIN도 우회하지 못한다', async () => {
    const { service, programDelete, applicationCount, record } =
      createDeleteService({
        program: {
          id: 'program-1',
          name: '합성 보호 대상 프로그램',
          lifecycle: ProgramLifecycle.PUBLISHED,
          deletionProtected: true,
        },
      });

    await expect(service.delete(1001n, 'program-1')).rejects.toMatchObject({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_PROTECTED],
    });
    expect(applicationCount).not.toHaveBeenCalled();
    expect(programDelete).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('deletionProtected가 false(기본값)인 프로그램은 기존과 동일하게 삭제된다', async () => {
    const { service, programDelete } = createDeleteService({
      program: {
        id: 'program-1',
        name: '합성 삭제 대상 프로그램',
        lifecycle: ProgramLifecycle.PUBLISHED,
        deletionProtected: false,
      },
    });

    await expect(service.delete(1001n, 'program-1')).resolves.toEqual({
      id: 'program-1',
      deleted: true,
    });
    expect(programDelete).toHaveBeenCalledWith({ where: { id: 'program-1' } });
  });

  it('신청·팀·제출물·게시글이 하나라도 남아 있으면 409와 함께 4종 blockingCounts를 전부 보고한다', async () => {
    const { service, programDelete, record } = createDeleteService({
      blockingCounts: {
        applications: 2,
        teams: 1,
        submissions: 3,
        boardPosts: 5,
      },
    });

    await expect(service.delete(1001n, 'program-1')).rejects.toMatchObject({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_BLOCKED],
      extensions: {
        blockingCounts: {
          applications: 2,
          teams: 1,
          submissions: 3,
          boardPosts: 5,
        },
      },
    });
    expect(programDelete).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('boardPosts만 남아 있어도 다른 카운트는 0으로 정확히 보고하며 차단한다', async () => {
    const { service } = createDeleteService({
      blockingCounts: { boardPosts: 1 },
    });

    await expect(service.delete(1001n, 'program-1')).rejects.toMatchObject({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_BLOCKED],
      extensions: {
        blockingCounts: {
          applications: 0,
          teams: 0,
          submissions: 0,
          boardPosts: 1,
        },
      },
    });
  });

  it('ProgramCreateRequest가 없는 프로그램은 그 삭제 단계를 건너뛴다', async () => {
    const {
      service,
      programCreateRequestDelete,
      programAuthoringUploadDeleteMany,
    } = createDeleteService({ createRequest: null });

    await service.delete(1001n, 'program-1');

    expect(programCreateRequestDelete).not.toHaveBeenCalled();
    expect(programAuthoringUploadDeleteMany).not.toHaveBeenCalled();
  });

  // 불변조건 회귀 테스트: Application 하드삭제는 SUBMITTED 상태에서만 일어나므로
  // applications===0이면 Repository·MilestoneDocumentSubmission도 0이어야 한다.
  // 그 불변조건이 깨진 상태(도달 불가능해야 하는 이상 상태)를 합성해, FK 위반 500이
  // 아니라 기존 409(PRG_012) 차단으로 흡수되는지 확인한다.
  it('applications==0인데 고아 Repository가 남아 있으면 불변조건 위반으로 보고 기존 409 차단으로 흡수한다', async () => {
    const { service, programDelete, record } = createDeleteService({
      orphanRepositoryCount: 1,
    });

    await expect(service.delete(1001n, 'program-1')).rejects.toMatchObject({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_BLOCKED],
      extensions: {
        blockingCounts: {
          applications: 0,
          teams: 0,
          submissions: 0,
          boardPosts: 0,
        },
      },
    });
    expect(programDelete).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('target MilestoneDocumentSubmission이 남아 있으면 409 차단 카운트로 보고한다', async () => {
    const { service, programDelete, record } = createDeleteService({
      blockingCounts: { submissions: 1 },
    });

    await expect(service.delete(1001n, 'program-1')).rejects.toMatchObject({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_BLOCKED],
      extensions: {
        blockingCounts: {
          applications: 0,
          teams: 0,
          submissions: 1,
          boardPosts: 0,
        },
      },
    });
    expect(programDelete).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});

// 합성 데이터만 사용한다 (docs/rules/security.md)
const ZERO_SCOPE_FINGERPRINT = '00000000000000000000000000000000';
const ZERO_SCOPE_COUNTS: ProgramDeletionScopeCounts = {
  applications: 0,
  teams: 0,
  boardPosts: 0,
  submissions: 0,
  submissionEvents: 0,
  scopeFingerprint: ZERO_SCOPE_FINGERPRINT,
};

function createPurgeService(
  overrides: {
    readonly user?: unknown;
    readonly program?: unknown;
    readonly createRequest?: unknown;
    readonly templateFiles?: readonly { readonly storageKey: string }[];
    readonly counts?: Partial<Record<string, number>>;
    readonly applicationIds?: readonly string[];
    readonly applicationDecisionNotifications?: readonly {
      readonly id: string;
    }[];
    /**
     * 이관된 제출(provenance가 달린 internal slot header) 수 — 0이 아니면 contract 전이라
     * purge가 409로 막힌다. 기본값 0은 이관 대상이 없는 프로그램이다.
     */
    readonly migratedSubmissionCount?: number;
    /** purge 트랜잭션 안에서 재확인하는 현재 범위 스냅샷 — 기본값은 전부 0이다. */
    readonly currentScopeCounts?: ProgramDeletionScopeCounts;
    /** 첫 purge transaction이 충돌하면 뒤의 fresh read가 보는 범위다. */
    readonly freshScopeCounts?: ProgramDeletionScopeCounts;
    readonly transactionError?: Error;
  } = {},
) {
  const userFindUnique = jest.fn().mockResolvedValue(
    overrides.user ?? {
      hasStaffAccess: false,
      hasAdminAccess: true,
      accountStatus: AccountStatus.ACTIVE,
    },
  );
  const programFindUnique = jest.fn().mockResolvedValue(
    'program' in overrides
      ? overrides.program
      : {
          id: 'program-1',
          name: '합성 purge 대상 프로그램',
          lifecycle: ProgramLifecycle.PUBLISHED,
        },
  );
  const programDelete = jest.fn().mockResolvedValue(undefined);

  const currentScopeCounts = overrides.currentScopeCounts ?? ZERO_SCOPE_COUNTS;
  const freshScopeCounts = overrides.freshScopeCounts ?? currentScopeCounts;
  const queryRaw = jest.fn().mockResolvedValue([
    {
      applications: BigInt(freshScopeCounts.applications),
      teams: BigInt(freshScopeCounts.teams),
      boardPosts: BigInt(freshScopeCounts.boardPosts),
      submissions: BigInt(freshScopeCounts.submissions),
      submissionEvents: BigInt(freshScopeCounts.submissionEvents),
      scopeFingerprint: freshScopeCounts.scopeFingerprint,
    },
  ]);

  const count = (key: string, fallback = 1) => {
    if (overrides.counts?.[key] !== undefined) {
      return overrides.counts[key];
    }
    switch (key) {
      case 'applications':
        return currentScopeCounts.applications;
      case 'teams':
        return currentScopeCounts.teams;
      case 'boardPosts':
        return currentScopeCounts.boardPosts;
      case 'submissions':
        return currentScopeCounts.submissions;
      case 'submissionFiles':
      case 'milestoneDocumentSubmissionHistories':
      case 'milestoneDocumentReviewHistories':
        return 0;
      default:
        return fallback;
    }
  };
  const countMany = (key: string, fallback = 1) =>
    jest.fn().mockResolvedValue({ count: count(key, fallback) });

  const publicShowcaseRepositoryDeleteMany = countMany(
    'publicShowcaseRepositories',
  );
  const outboxEventDeleteMany = jest.fn().mockResolvedValue({ count: 1 });
  const applicationIds = overrides.applicationIds ?? ['application-1'];
  const applicationFindMany = jest
    .fn()
    .mockResolvedValue(applicationIds.map((id) => ({ id })));
  const applicationDecisionNotifications =
    overrides.applicationDecisionNotifications ?? [{ id: 'notification-1' }];
  const notificationFindMany = jest
    .fn()
    .mockResolvedValue(applicationDecisionNotifications);
  const notificationDeleteMany = jest.fn().mockResolvedValue({ count: 1 });
  const boardCommentDeleteMany = countMany('boardComments');
  const boardPostDeleteMany = countMany('boardPosts');
  const githubRepositoryUpdateMany = countMany('githubRepositoriesDetached');
  const repositoryProvisionJobDeleteMany = countMany('repositoryProvisionJobs');
  const submissionFileUpdateMany = countMany('submissionFiles');
  const programCreateRequestFindUnique = jest
    .fn()
    .mockResolvedValue(
      'createRequest' in overrides
        ? overrides.createRequest
        : { id: 'create-request-1', actorId: 'actor-1' },
    );
  const programAuthoringUploadUpdateMany = countMany('programAuthoringUploads');
  const templateFiles = overrides.templateFiles ?? [
    { storageKey: 'program-authoring/template-1' },
  ];
  const milestoneDocumentTemplateFileFindMany = jest
    .fn()
    .mockResolvedValue(templateFiles);
  const programPurgeFileTombstoneCreateMany = jest
    .fn()
    .mockResolvedValue({ count: templateFiles.length });
  const milestoneDocumentReviewHistoryDeleteMany = countMany(
    'milestoneDocumentReviewHistories',
  );
  const milestoneDocumentSubmissionHistoryDeleteMany = countMany(
    'milestoneDocumentSubmissionHistories',
  );
  const milestoneDocumentSubmissionDeleteMany = countMany(
    'milestoneDocumentSubmissions',
    0,
  );
  const milestoneDocumentTemplateFileDeleteMany = countMany(
    'milestoneDocumentTemplateFiles',
  );
  const milestoneDocumentDeleteMany = countMany('milestoneDocuments');
  const applicationDeleteMany = countMany('applications');
  const teamInvitationDeleteMany = countMany('teamInvitations');
  const teamMemberDeleteMany = countMany('teamMembers');
  const teamDeleteMany = countMany('teams');
  const programCreateRequestDeleteMany = countMany('programCreateRequests');
  const milestoneDeleteMany = countMany('milestones');

  const migratedSubmissionCount = jest
    .fn()
    .mockResolvedValue(overrides.migratedSubmissionCount ?? 0);

  const record = jest
    .fn<Promise<void>, [AuditLogRecordInput]>()
    .mockResolvedValue(undefined);

  const transactionClient = {
    $queryRaw: queryRaw,
    program: { findUnique: programFindUnique, delete: programDelete },
    publicShowcaseRepository: {
      deleteMany: publicShowcaseRepositoryDeleteMany,
    },
    outboxEvent: { deleteMany: outboxEventDeleteMany },
    notification: {
      findMany: notificationFindMany,
      deleteMany: notificationDeleteMany,
    },
    boardComment: { deleteMany: boardCommentDeleteMany },
    boardPost: { deleteMany: boardPostDeleteMany },
    githubRepository: { updateMany: githubRepositoryUpdateMany },
    repositoryProvisionJob: { deleteMany: repositoryProvisionJobDeleteMany },
    submissionFile: { updateMany: submissionFileUpdateMany },
    programCreateRequest: {
      findUnique: programCreateRequestFindUnique,
      deleteMany: programCreateRequestDeleteMany,
    },
    programAuthoringUpload: { updateMany: programAuthoringUploadUpdateMany },
    milestoneDocumentTemplateFile: {
      findMany: milestoneDocumentTemplateFileFindMany,
      deleteMany: milestoneDocumentTemplateFileDeleteMany,
    },
    programPurgeFileTombstone: {
      createMany: programPurgeFileTombstoneCreateMany,
    },
    milestoneDocumentReviewHistory: {
      deleteMany: milestoneDocumentReviewHistoryDeleteMany,
    },
    milestoneDocumentSubmissionHistory: {
      deleteMany: milestoneDocumentSubmissionHistoryDeleteMany,
    },
    milestoneDocumentSubmission: {
      count: migratedSubmissionCount,
      deleteMany: milestoneDocumentSubmissionDeleteMany,
    },
    milestoneDocument: { deleteMany: milestoneDocumentDeleteMany },
    teamInvitation: { deleteMany: teamInvitationDeleteMany },
    teamMember: { deleteMany: teamMemberDeleteMany },
    team: { deleteMany: teamDeleteMany },
    milestone: { deleteMany: milestoneDeleteMany },
    application: {
      deleteMany: applicationDeleteMany,
      findMany: applicationFindMany,
    },
  };
  let transactionCount = 0;
  const prismaTransaction = jest.fn((callback: (tx: unknown) => unknown) => {
    transactionCount += 1;
    if (transactionCount === 1 && overrides.transactionError) {
      return Promise.reject(overrides.transactionError);
    }
    return callback(transactionClient);
  });
  const prisma = {
    user: { findUnique: userFindUnique },
    $transaction: prismaTransaction,
  } as unknown as PrismaService;
  const auditLog = { record } as unknown as AuditLogService;
  const service = new ProgramLifecycleService(prisma, auditLog);
  return {
    service,
    userFindUnique,
    programFindUnique,
    programDelete,
    prismaTransaction,
    queryRaw,
    publicShowcaseRepositoryDeleteMany,
    outboxEventDeleteMany,
    applicationFindMany,
    notificationFindMany,
    notificationDeleteMany,
    boardCommentDeleteMany,
    boardPostDeleteMany,
    githubRepositoryUpdateMany,
    repositoryProvisionJobDeleteMany,
    submissionFileUpdateMany,
    programCreateRequestFindUnique,
    programAuthoringUploadUpdateMany,
    milestoneDocumentTemplateFileFindMany,
    programPurgeFileTombstoneCreateMany,
    milestoneDocumentReviewHistoryDeleteMany,
    milestoneDocumentSubmissionHistoryDeleteMany,
    milestoneDocumentSubmissionDeleteMany,
    milestoneDocumentTemplateFileDeleteMany,
    milestoneDocumentDeleteMany,
    applicationDeleteMany,
    teamInvitationDeleteMany,
    teamMemberDeleteMany,
    teamDeleteMany,
    programCreateRequestDeleteMany,
    milestoneDeleteMany,
    record,
  };
}

describe('ProgramLifecycleService.purge — ADMIN 의도적 전체 삭제', () => {
  it('ADMIN이 자식 가득한 프로그램을 purge하면 전 계층을 명시 순서로 지우고 파일은 worker에 위임한다', async () => {
    const {
      service,
      outboxEventDeleteMany,
      applicationFindMany,
      notificationFindMany,
      notificationDeleteMany,
      boardCommentDeleteMany,
      boardPostDeleteMany,
      githubRepositoryUpdateMany,
      repositoryProvisionJobDeleteMany,
      submissionFileUpdateMany,
      programAuthoringUploadUpdateMany,
      programPurgeFileTombstoneCreateMany,
      milestoneDocumentReviewHistoryDeleteMany,
      milestoneDocumentSubmissionHistoryDeleteMany,
      milestoneDocumentSubmissionDeleteMany,
      milestoneDocumentTemplateFileDeleteMany,
      milestoneDocumentDeleteMany,
      applicationDeleteMany,
      teamInvitationDeleteMany,
      teamMemberDeleteMany,
      teamDeleteMany,
      programCreateRequestDeleteMany,
      milestoneDeleteMany,
      programDelete,
      record,
    } = createPurgeService();

    const result = await service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS);

    expect(result.id).toBe('program-1');
    expect(result.deleted).toBe(true);

    // GithubRepository는 하드 삭제가 아니라 program/application/team FK만 해제하고,
    // publishedAt도 함께 revoke한다 — 그래야 공개 아카이브가 program 없는 발행 행을
    // 만나지 않는다(purge 후 공개 노출 자격은 program 존재에 종속).
    expect(githubRepositoryUpdateMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { programId: 'program-1' },
          { application: { is: { programId: 'program-1' } } },
          { team: { is: { programId: 'program-1' } } },
        ],
      },
      data: {
        programId: null,
        applicationId: null,
        teamId: null,
        publishedAt: null,
      },
    });

    // OutboxEvent는 Program aggregate와 이 프로그램 산하 Application aggregate 둘 다 지운다.
    expect(applicationFindMany).toHaveBeenCalledWith({
      where: { programId: 'program-1' },
      select: { id: true },
    });
    expect(outboxEventDeleteMany).toHaveBeenCalledWith({
      where: { aggregateType: 'PROGRAM', aggregateId: 'program-1' },
    });
    expect(outboxEventDeleteMany).toHaveBeenCalledWith({
      where: {
        aggregateType: 'Application',
        aggregateId: { in: ['application-1'] },
      },
    });

    // Notification: APPLICATION_DECISION(payload.programId)을 찾아 그 응답 확인 기록과
    // 함께 지우고, DEADLINE_DIGEST는 idempotencyKey에 박힌 programId로 지운다.
    expect(notificationFindMany).toHaveBeenCalledWith({
      where: {
        type: 'APPLICATION_DECISION',
        payload: { path: ['programId'], equals: 'program-1' },
      },
      select: { id: true },
    });
    expect(notificationDeleteMany).toHaveBeenCalledWith({
      where: {
        type: 'APPLICATION_DECISION_ACKNOWLEDGED',
        idempotencyKey: {
          in: ['application-decision-acknowledged:notification-1'],
        },
      },
    });
    expect(notificationDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['notification-1'] } },
    });
    expect(notificationDeleteMany).toHaveBeenCalledWith({
      where: {
        type: 'DEADLINE_DIGEST',
        idempotencyKey: { contains: ':program-1:' },
      },
    });

    // SubmissionFile은 하드 삭제가 아니라 FK를 분리하고 DELETE_PENDING으로 전환한다.
    expect(submissionFileUpdateMany).toHaveBeenCalledTimes(1);
    expect(submissionFileUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { application: { is: { programId: 'program-1' } } },
            { milestone: { is: { programId: 'program-1' } } },
            {
              submissionHistory: {
                is: {
                  submission: {
                    milestoneDocument: {
                      milestone: { programId: 'program-1' },
                    },
                  },
                },
              },
            },
          ],
        },
        data: expect.objectContaining({
          lifecycle: 'DELETE_PENDING',
          applicationId: null,
          milestoneId: null,
          milestoneDocumentSubmissionId: null,
          milestoneDocumentSubmissionHistoryId: null,
        }) as unknown,
      }) as unknown,
    );

    // template file은 storage worker가 지울 tombstone으로 옮겨진 뒤 원 행을 지운다 — 트랜잭션에서
    // storage port를 직접 호출하지 않는다.
    expect(programPurgeFileTombstoneCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          storageKey: 'program-authoring/template-1',
        }),
      ],
      skipDuplicates: true,
    });

    // ProgramAuthoringUpload도 하드 삭제가 아니라 DELETE_PENDING 전환 + createRequest FK 해제다.
    expect(programAuthoringUploadUpdateMany).toHaveBeenCalledWith({
      where: {
        createRequestId: 'create-request-1',
        createRequestActorId: 'actor-1',
      },
      data: expect.objectContaining({
        lifecycle: 'DELETE_PENDING',
        createRequestId: null,
        createRequestActorId: null,
      }) as unknown,
    });

    for (const mock of [
      boardCommentDeleteMany,
      boardPostDeleteMany,
      repositoryProvisionJobDeleteMany,
      milestoneDocumentReviewHistoryDeleteMany,
      milestoneDocumentSubmissionHistoryDeleteMany,
      milestoneDocumentSubmissionDeleteMany,
      milestoneDocumentTemplateFileDeleteMany,
      milestoneDocumentDeleteMany,
      applicationDeleteMany,
      teamInvitationDeleteMany,
      teamMemberDeleteMany,
      teamDeleteMany,
      programCreateRequestDeleteMany,
      milestoneDeleteMany,
    ]) {
      expect(mock).toHaveBeenCalledTimes(1);
    }

    expect(programDelete).toHaveBeenCalledWith({ where: { id: 'program-1' } });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      action: PROGRAM_DELETION_AUDIT_ACTIONS.PROGRAM_DELETED,
      targetType: 'PROGRAM',
      targetId: 'program-1',
      metadata: { programName: '합성 purge 대상 프로그램' },
    });
  });

  it('ProgramCreateRequest가 없으면 authoring upload 전환·createRequest 삭제를 건너뛴다', async () => {
    const {
      service,
      programAuthoringUploadUpdateMany,
      programCreateRequestDeleteMany,
    } = createPurgeService({ createRequest: null });

    await service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS);

    expect(programAuthoringUploadUpdateMany).not.toHaveBeenCalled();
    expect(programCreateRequestDeleteMany).not.toHaveBeenCalled();
  });

  it('삭제할 template file이 없으면 tombstone을 만들지 않는다', async () => {
    const { service, programPurgeFileTombstoneCreateMany } = createPurgeService(
      { templateFiles: [] },
    );

    await service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS);

    expect(programPurgeFileTombstoneCreateMany).not.toHaveBeenCalled();
  });

  it('신청서가 없으면 Application 범위 OutboxEvent 삭제를 건너뛴다', async () => {
    const { service, outboxEventDeleteMany } = createPurgeService({
      applicationIds: [],
    });

    await service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS);

    expect(outboxEventDeleteMany).toHaveBeenCalledTimes(1);
    expect(outboxEventDeleteMany).toHaveBeenCalledWith({
      where: { aggregateType: 'PROGRAM', aggregateId: 'program-1' },
    });
  });

  it('APPLICATION_DECISION 알림이 없으면 ACKNOWLEDGED/본체 삭제를 건너뛰고 DEADLINE_DIGEST만 지운다', async () => {
    const { service, notificationDeleteMany } = createPurgeService({
      applicationDecisionNotifications: [],
    });

    await service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS);

    expect(notificationDeleteMany).toHaveBeenCalledTimes(1);
    expect(notificationDeleteMany).toHaveBeenCalledWith({
      where: {
        type: 'DEADLINE_DIGEST',
        idempotencyKey: { contains: ':program-1:' },
      },
    });
  });

  it('STAFF는 purge 시도 시 403 PRG_011을 받고 프로그램을 조회하지 않는다', async () => {
    const { service, programFindUnique } = createPurgeService({
      user: { role: 'STAFF', accountStatus: AccountStatus.ACTIVE },
    });

    await expect(
      service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS),
    ).rejects.toMatchObject({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_FORBIDDEN],
    });
    expect(programFindUnique).not.toHaveBeenCalled();
  });

  it('STUDENT는 purge 시도 시 403 PRG_011을 받는다', async () => {
    const { service } = createPurgeService({
      user: { role: 'STUDENT', accountStatus: AccountStatus.ACTIVE },
    });

    await expect(
      service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS),
    ).rejects.toMatchObject({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_FORBIDDEN],
    });
  });

  it('program을 찾지 못하면 PROGRAM_NOT_FOUND를 던지고 자식 삭제를 시작하지 않는다', async () => {
    const { service, programDelete } = createPurgeService({ program: null });

    await expect(
      service.purge(1001n, 'missing-program', ZERO_SCOPE_COUNTS),
    ).rejects.toMatchObject({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_NOT_FOUND],
    });
    expect(programDelete).not.toHaveBeenCalled();
  });

  it('deletionProtected가 true면 자식 삭제를 시작하기 전 409 PRG_013으로 거부하고 ADMIN도 우회하지 못한다', async () => {
    const {
      service,
      programDelete,
      applicationFindMany,
      publicShowcaseRepositoryDeleteMany,
      record,
    } = createPurgeService({
      program: {
        id: 'program-1',
        name: '합성 보호 purge 대상 프로그램',
        lifecycle: ProgramLifecycle.PUBLISHED,
        deletionProtected: true,
      },
    });

    await expect(
      service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS),
    ).rejects.toMatchObject({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_PROTECTED],
    });
    expect(applicationFindMany).not.toHaveBeenCalled();
    expect(publicShowcaseRepositoryDeleteMany).not.toHaveBeenCalled();
    expect(programDelete).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('이관된 제출이 남아 있으면 purge를 409로 막고 아무것도 지우지 않는다', async () => {
    // Given: bridge가 복사한 provenance header가 살아 있다 — source row도 아직 남아 있어
    // 지금 지우면 이관 이력을 잃는다. contract가 source를 제거할 때까지만의 임시 관문이다.
    const {
      service,
      programDelete,
      applicationFindMany,
      publicShowcaseRepositoryDeleteMany,
      queryRaw,
      record,
    } = createPurgeService({ migratedSubmissionCount: 3 });

    // When / Then
    await expect(
      service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS),
    ).rejects.toMatchObject({
      errorCode:
        PROGRAM_ERROR_CODES[
          ProgramErrorCode.PROGRAM_PURGE_LEGACY_MIGRATION_IN_PROGRESS
        ],
    });
    // 범위 재확인조차 하지 않는다 — 관문이 그보다 앞이다.
    expect(queryRaw).not.toHaveBeenCalled();
    expect(applicationFindMany).not.toHaveBeenCalled();
    expect(publicShowcaseRepositoryDeleteMany).not.toHaveBeenCalled();
    expect(programDelete).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('deletionProtected가 false(기본값)인 프로그램은 기존과 동일하게 purge된다', async () => {
    const { service, programDelete } = createPurgeService({
      program: {
        id: 'program-1',
        name: '합성 purge 대상 프로그램',
        lifecycle: ProgramLifecycle.PUBLISHED,
        deletionProtected: false,
      },
    });

    const result = await service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS);

    expect(result.id).toBe('program-1');
    expect(result.deleted).toBe(true);
    expect(programDelete).toHaveBeenCalledWith({ where: { id: 'program-1' } });
  });

  // TOCTOU(#F2): 확인 화면과 purge 사이에 생긴 행을 관리자가 못 보고 지우지 않도록,
  // 클라이언트가 보낸 expectedScope와 트랜잭션이 다시 읽은 현재 범위를 비교한다.
  it('expectedScope가 현재 범위와 다르면 409 PRG_014로 거부하고 자식 삭제를 시작하지 않는다', async () => {
    const {
      service,
      applicationFindMany,
      publicShowcaseRepositoryDeleteMany,
      programDelete,
      record,
    } = createPurgeService({
      currentScopeCounts: {
        applications: 1,
        teams: 0,
        boardPosts: 0,
        submissions: 0,
        submissionEvents: 0,
        scopeFingerprint: '11111111111111111111111111111111',
      },
    });

    await expect(
      service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS),
    ).rejects.toMatchObject({
      errorCode:
        PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_PURGE_SCOPE_CHANGED],
      extensions: {
        currentScopeCounts: {
          applications: 1,
          teams: 0,
          boardPosts: 0,
          submissions: 0,
          submissionEvents: 0,
          scopeFingerprint: '11111111111111111111111111111111',
        },
      },
    });

    // 비교에서 이미 막혔으므로 실제 자식 삭제 단계는 하나도 시작하지 않는다 — 부분 삭제 없음.
    expect(applicationFindMany).not.toHaveBeenCalled();
    expect(publicShowcaseRepositoryDeleteMany).not.toHaveBeenCalled();
    expect(programDelete).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('expectedScope가 현재 범위와 같으면 정상적으로 purge를 진행한다', async () => {
    const { service, programDelete } = createPurgeService({
      counts: { milestoneDocumentSubmissions: 3 },
      currentScopeCounts: {
        applications: 2,
        teams: 1,
        boardPosts: 0,
        submissions: 3,
        submissionEvents: 0,
        scopeFingerprint: '22222222222222222222222222222222',
      },
    });

    const result = await service.purge(1001n, 'program-1', {
      applications: 2,
      teams: 1,
      boardPosts: 0,
      submissions: 3,
      submissionEvents: 0,
      scopeFingerprint: '22222222222222222222222222222222',
    });

    expect(result).toMatchObject({ id: 'program-1', deleted: true });
    expect(programDelete).toHaveBeenCalledWith({ where: { id: 'program-1' } });
  });

  it('삭제 결과의 제출물 수는 target 제출 헤더 수다', async () => {
    const { service } = createPurgeService({
      currentScopeCounts: {
        applications: 0,
        teams: 0,
        boardPosts: 0,
        submissions: 3,
        submissionEvents: 0,
        scopeFingerprint: '33333333333333333333333333333333',
      },
      counts: { milestoneDocumentSubmissions: 3 },
    });

    const result = await service.purge(1001n, 'program-1', {
      applications: 0,
      teams: 0,
      boardPosts: 0,
      submissions: 3,
      submissionEvents: 0,
      scopeFingerprint: '33333333333333333333333333333333',
    });

    expect(result.deletedCounts).toMatchObject({
      submissions: 3,
      milestoneDocumentSubmissions: 3,
      submissionRevisions: 0,
      reviews: 0,
    });
  });

  // 단위 테스트로 "비교가 트랜잭션 밖에서 일어나지 않는다"는 것을 직접 증명하기는 어렵지만
  // (실제 트랜잭션이 아니라 콜백을 그대로 실행하는 목이므로), 이 스위트의 모든 $queryRaw
  // 호출이 매번 새 $transaction 콜백 실행 안에서만 이뤄진다는 것으로 대신 확인한다 —
  // $transaction이 호출되지 않은 상태에서 $queryRaw가 먼저 불리면 이 fixture 자체가
  // 깨진다(스코프 검사 mock이 트랜잭션 클라이언트에만 달려 있기 때문).
  it('범위 재확인 쿼리는 $transaction 콜백 안(=트랜잭션 클라이언트)에서만 실행된다', async () => {
    const { service, queryRaw } = createPurgeService();

    await service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS);

    // queryRaw는 트랜잭션 클라이언트 전용 mock이다 — prisma 최상위 객체에는 존재하지 않는다.
    // 이 mock이 호출됐다는 것 자체가 비교 쿼리가 트랜잭션 클라이언트를 통해서만
    // 실행됐다는 뜻이다(서비스 코드가 트랜잭션 밖 this.prisma로 같은 쿼리를 쏠 방법이 없다).
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('purge transaction은 Serializable을 요청한다', async () => {
    const { service, prismaTransaction } = createPurgeService();

    await service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS);

    expect(prismaTransaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('P2034는 fresh scope를 담은 PRG_014로 변환한다', async () => {
    const error = new Prisma.PrismaClientKnownRequestError('serialization', {
      code: 'P2034',
      clientVersion: 'test',
    });
    const { service, queryRaw } = createPurgeService({
      transactionError: error,
      freshScopeCounts: { ...ZERO_SCOPE_COUNTS, boardPosts: 2 },
    });

    await expect(
      service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS),
    ).rejects.toMatchObject({
      errorCode:
        PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_PURGE_SCOPE_CHANGED],
      extensions: {
        currentScopeCounts: { ...ZERO_SCOPE_COUNTS, boardPosts: 2 },
      },
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('P2034는 fresh scope가 expected와 동일해도 PRG_014로 변환한다 — identity churn도 보존대상이다', async () => {
    const error = new Prisma.PrismaClientKnownRequestError('serialization', {
      code: 'P2034',
      clientVersion: 'test',
    });
    const { service } = createPurgeService({
      transactionError: error,
      freshScopeCounts: ZERO_SCOPE_COUNTS,
    });

    await expect(
      service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS),
    ).rejects.toMatchObject({
      errorCode:
        PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_PURGE_SCOPE_CHANGED],
      extensions: { currentScopeCounts: ZERO_SCOPE_COUNTS },
    });
  });

  it('P2003와 fresh scope 변경은 PRG_014로 변환한다', async () => {
    const error = new Prisma.PrismaClientKnownRequestError('foreign key', {
      code: 'P2003',
      clientVersion: 'test',
    });
    const { service } = createPurgeService({
      transactionError: error,
      freshScopeCounts: { ...ZERO_SCOPE_COUNTS, boardPosts: 2 },
    });

    await expect(
      service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS),
    ).rejects.toMatchObject({
      errorCode:
        PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_PURGE_SCOPE_CHANGED],
      extensions: {
        currentScopeCounts: { ...ZERO_SCOPE_COUNTS, boardPosts: 2 },
      },
    });
  });

  it('purgeProgramTree의 삭제 건수와 scope가 다르면 fresh scope를 담은 PRG_014로 롤백한다', async () => {
    const { service, programDelete } = createPurgeService({
      counts: { boardPosts: 1 },
    });

    await expect(
      service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS),
    ).rejects.toMatchObject({
      errorCode:
        PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_PURGE_SCOPE_CHANGED],
      extensions: { currentScopeCounts: ZERO_SCOPE_COUNTS },
    });
    expect(programDelete).not.toHaveBeenCalled();
  });

  it('P2003와 fresh scope 불변은 그대로 다시 던진다', async () => {
    const error = new Prisma.PrismaClientKnownRequestError('foreign key', {
      code: 'P2003',
      clientVersion: 'test',
    });
    const { service } = createPurgeService({ transactionError: error });

    await expect(
      service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS),
    ).rejects.toBe(error);
  });

  it('알 수 없는 transaction 오류는 그대로 다시 던진다', async () => {
    const error = new Error('unexpected purge failure');
    const { service } = createPurgeService({ transactionError: error });

    await expect(
      service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS),
    ).rejects.toBe(error);
  });
});
