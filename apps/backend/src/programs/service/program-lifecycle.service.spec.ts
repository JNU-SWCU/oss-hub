import { AccountStatus, ProgramLifecycle, Role } from '@prisma/client';
import {
  PROGRAM_DELETION_AUDIT_ACTIONS,
  PROGRAM_LIFECYCLE_AUDIT_ACTIONS,
} from '../../audit-log/audit-log-metadata';
import type { AuditLogRecordInput } from '../../audit-log/audit-log.repository';
import type { AuditLogService } from '../../audit-log/audit-log.service';
import type { PrismaService } from '../../prisma/prisma.service';
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
      role: Role.ADMIN,
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
      user: { role: Role.STUDENT, accountStatus: AccountStatus.ACTIVE },
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
    readonly orphanMilestoneDocumentSubmissionCount?: number;
  } = {},
) {
  const userFindUnique = jest.fn().mockResolvedValue(
    overrides.user ?? {
      role: Role.ADMIN,
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
  const submissionCount = jest.fn().mockResolvedValue(counts.submissions);
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
  const milestoneDocumentSubmissionCount = jest
    .fn()
    .mockResolvedValue(overrides.orphanMilestoneDocumentSubmissionCount ?? 0);
  const record = jest
    .fn<Promise<void>, [AuditLogRecordInput]>()
    .mockResolvedValue(undefined);
  const transactionClient = {
    program: { findUnique: programFindUnique, delete: programDelete },
    application: { count: applicationCount },
    team: { count: teamCount },
    boardPost: { count: boardPostCount },
    submission: { count: submissionCount },
    repository: { count: repositoryCount },
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
    submissionCount,
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
      user: { role: Role.STAFF, accountStatus: AccountStatus.ACTIVE },
    });

    await expect(service.delete(1001n, 'program-1')).rejects.toMatchObject({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_FORBIDDEN],
    });
    expect(programFindUnique).not.toHaveBeenCalled();
  });

  it('STUDENT는 403을 받는다', async () => {
    const { service, programFindUnique } = createDeleteService({
      user: { role: Role.STUDENT, accountStatus: AccountStatus.ACTIVE },
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

  it('applications==0인데 고아 MilestoneDocumentSubmission이 남아 있으면 불변조건 위반으로 보고 기존 409 차단으로 흡수한다', async () => {
    const { service, programDelete, record } = createDeleteService({
      orphanMilestoneDocumentSubmissionCount: 1,
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
});
