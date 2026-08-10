import { AccountStatus, ProgramLifecycle, Role } from '@prisma/client';
import { PROGRAM_LIFECYCLE_AUDIT_ACTIONS } from '../../audit-log/audit-log-metadata';
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
