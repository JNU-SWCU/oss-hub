import { AccountStatus, Prisma, ProgramLifecycle } from '@prisma/client';
import { PROGRAM_DELETION_AUDIT_ACTIONS } from '../../audit-log/domain/audit-log-metadata';
import type { AuditLogRecordInput } from '../../audit-log/domain/audit-log-record-input';
import type { AuditLogService } from '../../audit-log/service/audit-log.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ProgramDeletionScopeCounts } from '../domain/program-deletion-scope';
import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from '../program-error-code.enum';
import { ProgramLifecycleRepository } from '../repository/program-lifecycle.repository';
import { ProgramLifecycleService } from './program-lifecycle.service';

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
    readonly cover?: { readonly storageKey: string | null };
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
  const programCoverFindUnique = jest
    .fn()
    .mockResolvedValue(overrides.cover ?? null);
  const programCoverDelete = jest.fn().mockResolvedValue(undefined);
  const programPurgeFileTombstoneCreateMany = jest
    .fn<
      Promise<Prisma.BatchPayload>,
      [Prisma.ProgramPurgeFileTombstoneCreateManyArgs]
    >()
    .mockResolvedValue({ count: 1 });
  const transactionClient = {
    programCover: {
      findUnique: programCoverFindUnique,
      delete: programCoverDelete,
    },
    programPurgeFileTombstone: {
      createMany: programPurgeFileTombstoneCreateMany,
    },
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
  const service = new ProgramLifecycleService(
    new ProgramLifecycleRepository(prisma),
    auditLog,
  );
  return {
    service,
    programCoverDelete,
    programPurgeFileTombstoneCreateMany,
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

describe('ProgramLifecycleService.delete — 교직원·관리자 영구 삭제 (#1095, 종전 #875)', () => {
  it('removes an external cover reference without scheduling object deletion', async () => {
    const { service, programCoverDelete, programPurgeFileTombstoneCreateMany } =
      createDeleteService({ cover: { storageKey: null } });
    await service.delete(1001n, 'program-1');
    expect(programCoverDelete).toHaveBeenCalledWith({
      where: { programId: 'program-1' },
    });
    expect(programPurgeFileTombstoneCreateMany).not.toHaveBeenCalled();
  });
  it('표지가 있는 프로그램을 삭제하면 같은 트랜잭션에서 파일 정리를 예약한다', async () => {
    const {
      service,
      programCoverDelete,
      programPurgeFileTombstoneCreateMany,
      programDelete,
    } = createDeleteService({
      cover: { storageKey: 'program-covers/delete-cover' },
    });

    await service.delete(1001n, 'program-1');

    expect(
      programPurgeFileTombstoneCreateMany.mock.calls[0]?.[0],
    ).toMatchObject({
      data: [
        {
          storageKey: 'program-covers/delete-cover',
        },
      ],
      skipDuplicates: true,
    });
    expect(programCoverDelete).toHaveBeenCalledWith({
      where: { programId: 'program-1' },
    });
    expect(programCoverDelete.mock.invocationCallOrder[0]).toBeLessThan(
      programDelete.mock.invocationCallOrder[0] ?? 0,
    );
  });

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

  it('STAFF는 관리자 접근이 없어도 삭제할 수 있고 감사 로그에 그 교직원이 남는다', async () => {
    const { service, programDelete, record } = createDeleteService({
      user: {
        hasStaffAccess: true,
        hasAdminAccess: false,
        accountStatus: AccountStatus.ACTIVE,
      },
    });

    await expect(service.delete(1001n, 'program-1')).resolves.toEqual({
      id: 'program-1',
      deleted: true,
    });
    expect(programDelete).toHaveBeenCalledWith({ where: { id: 'program-1' } });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      actorGithubId: 1001n,
      action: PROGRAM_DELETION_AUDIT_ACTIONS.PROGRAM_DELETED,
      targetType: 'PROGRAM',
      targetId: 'program-1',
    });
  });

  it('교직원·관리자 접근이 모두 없으면(학생) 403을 받고 조회조차 하지 않는다', async () => {
    const { service, programFindUnique } = createDeleteService({
      user: {
        hasStaffAccess: false,
        hasAdminAccess: false,
        accountStatus: AccountStatus.ACTIVE,
      },
    });

    await expect(service.delete(1001n, 'program-1')).rejects.toMatchObject({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_FORBIDDEN],
    });
    expect(programFindUnique).not.toHaveBeenCalled();
  });

  it('교직원 접근이 있어도 계정이 비활성이면 403을 받고 조회조차 하지 않는다', async () => {
    const { service, programFindUnique } = createDeleteService({
      user: {
        hasStaffAccess: true,
        hasAdminAccess: false,
        accountStatus: AccountStatus.DEACTIVATED,
      },
    });

    await expect(service.delete(1001n, 'program-1')).rejects.toMatchObject({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_FORBIDDEN],
    });
    expect(programFindUnique).not.toHaveBeenCalled();
  });

  it('STAFF의 일반 삭제도 자식 데이터가 있으면 409 PRG_012로 막히고 감사 로그를 남기지 않는다', async () => {
    const { service, programDelete, record } = createDeleteService({
      user: {
        hasStaffAccess: true,
        hasAdminAccess: false,
        accountStatus: AccountStatus.ACTIVE,
      },
      blockingCounts: { applications: 2, teams: 1, submissions: 3 },
    });

    await expect(service.delete(1001n, 'program-1')).rejects.toMatchObject({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_BLOCKED],
      extensions: {
        blockingCounts: expect.objectContaining({
          applications: 2,
          teams: 1,
          submissions: 3,
        }) as unknown,
      },
    });
    expect(programDelete).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('program을 찾지 못하면 PROGRAM_NOT_FOUND를 던진다', async () => {
    const { service } = createDeleteService({ program: null });

    await expect(
      service.delete(1001n, 'missing-program'),
    ).rejects.toMatchObject({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_NOT_FOUND],
    });
  });

  it('자식 데이터가 없으면 프로그램을 삭제한다', async () => {
    const { service, programDelete } = createDeleteService({
      program: {
        id: 'program-1',
        name: '합성 삭제 대상 프로그램',
        lifecycle: ProgramLifecycle.PUBLISHED,
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
    readonly cover?: { readonly storageKey: string | null };
    readonly counts?: Partial<Record<string, number>>;
    readonly applicationIds?: readonly string[];
    readonly applicationDecisionNotifications?: readonly {
      readonly id: string;
    }[];

    readonly currentScopeCounts?: ProgramDeletionScopeCounts;

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
  const programCoverFindUnique = jest
    .fn()
    .mockResolvedValue(overrides.cover ?? null);
  const programCoverDelete = jest.fn().mockResolvedValue(undefined);

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
    .fn<
      Promise<Prisma.BatchPayload>,
      [Prisma.ProgramPurgeFileTombstoneCreateManyArgs]
    >()
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

  const record = jest
    .fn<Promise<void>, [AuditLogRecordInput]>()
    .mockResolvedValue(undefined);

  const transactionClient = {
    $queryRaw: queryRaw,
    programCover: {
      findUnique: programCoverFindUnique,
      delete: programCoverDelete,
    },
    program: { findUnique: programFindUnique, delete: programDelete },
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
  const service = new ProgramLifecycleService(
    new ProgramLifecycleRepository(prisma),
    auditLog,
  );
  return {
    service,
    userFindUnique,
    programFindUnique,
    programDelete,
    prismaTransaction,
    programCoverDelete,
    queryRaw,
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

describe('ProgramLifecycleService.purge — 교직원·관리자 의도적 전체 삭제 (#1095)', () => {
  it('excludes an external reference from purge storage cleanup counts', async () => {
    const { service, programCoverDelete, programPurgeFileTombstoneCreateMany } =
      createPurgeService({ cover: { storageKey: null }, templateFiles: [] });
    const result = await service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS);
    expect(result.deletedCounts.programPurgeFileTombstones).toBe(0);
    expect(programCoverDelete).toHaveBeenCalledWith({
      where: { programId: 'program-1' },
    });
    expect(programPurgeFileTombstoneCreateMany).not.toHaveBeenCalled();
  });
  it('표지 정리를 예약한 뒤 연결 행을 삭제하고 tombstone 개수에 포함한다', async () => {
    const {
      service,
      programCoverDelete,
      programPurgeFileTombstoneCreateMany,
      programDelete,
    } = createPurgeService({
      cover: { storageKey: 'program-covers/purge-cover' },
      templateFiles: [],
    });

    const result = await service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS);

    expect(result.deletedCounts.programPurgeFileTombstones).toBe(1);
    expect(
      programPurgeFileTombstoneCreateMany.mock.calls[0]?.[0],
    ).toMatchObject({
      data: [
        {
          storageKey: 'program-covers/purge-cover',
        },
      ],
      skipDuplicates: true,
    });
    expect(programCoverDelete).toHaveBeenCalledWith({
      where: { programId: 'program-1' },
    });
    expect(programCoverDelete.mock.invocationCallOrder[0]).toBeLessThan(
      programDelete.mock.invocationCallOrder[0] ?? 0,
    );
  });

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

    expect(submissionFileUpdateMany).toHaveBeenCalledTimes(2);
    expect(submissionFileUpdateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          AND: [
            {
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
            { lifecycle: { not: 'DELETED' } },
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
    expect(submissionFileUpdateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          AND: [
            {
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
            { lifecycle: 'DELETED' },
          ],
        },
        data: {
          applicationId: null,
          milestoneId: null,
          milestoneDocumentSubmissionId: null,
          milestoneDocumentSubmissionHistoryId: null,
        },
      }) as unknown,
    );

    expect(programPurgeFileTombstoneCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          storageKey: 'program-authoring/template-1',
        }),
      ],
      skipDuplicates: true,
    });

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

  it('APPLICATION_DECISION 알림이 없으면 ACKNOWLEDGED/본체 삭제를 건너뛰고 프로그램 축 알림만 지운다', async () => {
    const { service, notificationDeleteMany } = createPurgeService({
      applicationDecisionNotifications: [],
    });

    await service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS);

    expect(notificationDeleteMany).toHaveBeenCalledTimes(2);
    expect(notificationDeleteMany).toHaveBeenCalledWith({
      where: {
        type: 'DEADLINE_DIGEST',
        idempotencyKey: { contains: ':program-1:' },
      },
    });
    expect(notificationDeleteMany).toHaveBeenCalledWith({
      where: {
        type: 'TEAM_DELETED',
        payload: { path: ['programId'], equals: 'program-1' },
      },
    });
  });

  it('STAFF는 관리자 접근이 없어도 purge할 수 있고 감사 로그에 그 교직원이 남는다', async () => {
    const { service, programDelete, record } = createPurgeService({
      user: {
        hasStaffAccess: true,
        hasAdminAccess: false,
        accountStatus: AccountStatus.ACTIVE,
      },
    });

    const result = await service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS);

    expect(result).toMatchObject({ id: 'program-1', deleted: true });
    expect(programDelete).toHaveBeenCalledWith({ where: { id: 'program-1' } });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      actorGithubId: 1001n,
      action: PROGRAM_DELETION_AUDIT_ACTIONS.PROGRAM_DELETED,
      targetType: 'PROGRAM',
      targetId: 'program-1',
    });
  });

  it('교직원·관리자 접근이 모두 없으면(학생) purge 시도 시 403 PRG_011을 받고 프로그램을 조회하지 않는다', async () => {
    const { service, programFindUnique } = createPurgeService({
      user: {
        hasStaffAccess: false,
        hasAdminAccess: false,
        accountStatus: AccountStatus.ACTIVE,
      },
    });

    await expect(
      service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS),
    ).rejects.toMatchObject({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_FORBIDDEN],
    });
    expect(programFindUnique).not.toHaveBeenCalled();
  });

  it('교직원 접근이 있어도 계정이 비활성이면 purge는 403 PRG_011이다', async () => {
    const { service, programFindUnique } = createPurgeService({
      user: {
        hasStaffAccess: true,
        hasAdminAccess: false,
        accountStatus: AccountStatus.DEACTIVATED,
      },
    });

    await expect(
      service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS),
    ).rejects.toMatchObject({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_FORBIDDEN],
    });
    expect(programFindUnique).not.toHaveBeenCalled();
  });

  it('STAFF의 purge도 expectedScope가 어긋나면 409 PRG_014로 중단하고 아무것도 지우지 않는다', async () => {
    const { service, applicationFindMany, programDelete, record } =
      createPurgeService({
        user: {
          hasStaffAccess: true,
          hasAdminAccess: false,
          accountStatus: AccountStatus.ACTIVE,
        },
        currentScopeCounts: {
          applications: 1,
          teams: 0,
          boardPosts: 0,
          submissions: 0,
          submissionEvents: 0,
          scopeFingerprint: 'staff-drifted-scope-fingerprint',
        },
      });

    await expect(
      service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS),
    ).rejects.toMatchObject({
      errorCode:
        PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_PURGE_SCOPE_CHANGED],
      extensions: {
        currentScopeCounts: expect.objectContaining({
          applications: 1,
        }) as unknown,
      },
    });
    expect(applicationFindMany).not.toHaveBeenCalled();
    expect(programDelete).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
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

  it('현재 범위가 확인 범위와 같으면 프로그램 트리를 purge한다', async () => {
    const { service, programDelete } = createPurgeService({
      program: {
        id: 'program-1',
        name: '합성 purge 대상 프로그램',
        lifecycle: ProgramLifecycle.PUBLISHED,
      },
    });

    const result = await service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS);

    expect(result.id).toBe('program-1');
    expect(result.deleted).toBe(true);
    expect(programDelete).toHaveBeenCalledWith({ where: { id: 'program-1' } });
  });

  it('ARCHIVED 프로그램도 별도 lifecycle 변경 없이 직접 purge한다', async () => {
    const { service, programDelete, record } = createPurgeService({
      program: {
        id: 'program-1',
        name: '합성 보관 프로그램',
        lifecycle: ProgramLifecycle.ARCHIVED,
      },
    });

    await expect(
      service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS),
    ).resolves.toMatchObject({ id: 'program-1', deleted: true });

    expect(programDelete).toHaveBeenCalledWith({ where: { id: 'program-1' } });
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      metadata: {
        programName: '합성 보관 프로그램',
        lifecycle: ProgramLifecycle.ARCHIVED,
      },
    });
  });

  it('expectedScope가 현재 범위와 다르면 409 PRG_014로 거부하고 자식 삭제를 시작하지 않는다', async () => {
    const { service, applicationFindMany, programDelete, record } =
      createPurgeService({
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

    expect(applicationFindMany).not.toHaveBeenCalled();
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

  it('범위 재확인 쿼리는 $transaction 콜백 안(=트랜잭션 클라이언트)에서만 실행된다', async () => {
    const { service, queryRaw } = createPurgeService();

    await service.purge(1001n, 'program-1', ZERO_SCOPE_COUNTS);

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
