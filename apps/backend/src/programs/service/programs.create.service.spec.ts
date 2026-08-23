import { AccountStatus, ProgramCategory } from '@prisma/client';
import type { AuditLogService } from '../../audit-log/audit-log.service';
import { PROGRAM_CREATED_AUDIT_ACTIONS } from '../../audit-log/audit-log-metadata';
import { DomainException } from '../../common/error-code';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateProgramRequestDto } from '../dto/create-program-request.dto';
import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from '../program-error-code.enum';
import { ProgramCreationService } from './program-creation.service';
import { ProgramsRepository } from '../repository/programs.repository';

const input: CreateProgramRequestDto = {
  name: '  2026 OSS Contest  ',
  organizer: '  SW Center  ',
  category: ProgramCategory.OSS_CONTEST,
  applicationStartAt: '2026-08-01T00:00:00+09:00',
  applicationEndAt: '2026-08-15T23:59:59+09:00',
  startAt: '2026-08-16T00:00:00+09:00',
  endAt: '2027-02-01T00:00:00+09:00',
  teamMinSize: 2,
  teamMaxSize: 4,
  description: '  Program overview  ',
};

describe('ProgramsService', () => {
  const findUnique = jest.fn();
  const create = jest.fn(
    (request: {
      readonly data: {
        readonly name: string;
        readonly teamMinSize: number;
        readonly teamMaxSize: number;
      };
    }) => {
      return Promise.resolve({ id: 'program', name: request.data.name });
    },
  );
  const record = jest
    .fn<Promise<unknown>, Parameters<AuditLogService['record']>>()
    .mockResolvedValue(undefined);
  const writer = {
    program: { create },
    auditLog: {},
  };
  const $transaction = jest.fn((operation: (tx: typeof writer) => unknown) =>
    operation(writer),
  );
  const prisma = {
    user: { findUnique },
    $transaction,
  } as unknown as PrismaService;
  const auditLog = { record } as unknown as AuditLogService;
  const service = new ProgramCreationService(
    new ProgramsRepository(prisma),
    auditLog,
  );

  beforeEach(() => {
    findUnique.mockReset();
    create.mockReset();
    create.mockImplementation(
      (request: {
        readonly data: {
          readonly name: string;
          readonly teamMinSize: number;
          readonly teamMaxSize: number;
        };
      }) => Promise.resolve({ id: 'program', name: request.data.name }),
    );
    record.mockReset();
    record.mockResolvedValue(undefined);
    $transaction.mockClear();
  });

  it('stores the server-owned OSS contest template for an approved staff member', async () => {
    findUnique.mockResolvedValue({
      hasStaffAccess: true,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
    });
    create.mockResolvedValue({ id: 'program-1', name: '2026 OSS Contest' });

    await service.create(101n, input);

    expect(create).toHaveBeenCalledWith({
      data: {
        name: '2026 OSS Contest',
        organizer: 'SW Center',
        category: ProgramCategory.OSS_CONTEST,
        description: 'Program overview',
        applicationTemplateKey: 'oss-contest',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-08-01T00:00:00+09:00'),
        applicationEndAt: new Date('2026-08-15T23:59:59+09:00'),
        startAt: new Date('2026-08-16T00:00:00+09:00'),
        endAt: new Date('2027-02-01T00:00:00+09:00'),
        teamMinSize: 2,
        teamMaxSize: 4,
      },
    });
  });

  it('stores an editable team range for an individual template', async () => {
    findUnique.mockResolvedValue({
      hasStaffAccess: false,
      hasAdminAccess: true,
      accountStatus: AccountStatus.ACTIVE,
    });
    create.mockResolvedValue({ id: 'program-2', name: '2026 OSS Contest' });

    await service.create(101n, {
      ...input,
      category: ProgramCategory.BASIC,
      teamMinSize: 2,
      teamMaxSize: 4,
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        name: '2026 OSS Contest',
        organizer: 'SW Center',
        category: ProgramCategory.BASIC,
        description: 'Program overview',
        applicationTemplateKey: 'basic',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-08-01T00:00:00+09:00'),
        applicationEndAt: new Date('2026-08-15T23:59:59+09:00'),
        startAt: new Date('2026-08-16T00:00:00+09:00'),
        endAt: new Date('2027-02-01T00:00:00+09:00'),
        teamMinSize: 2,
        teamMaxSize: 4,
      },
    });
  });

  it.each(Object.values(ProgramCategory))(
    'defaults %s to the editable 1..1 range',
    async (category) => {
      findUnique.mockResolvedValue({
        hasStaffAccess: true,
        hasAdminAccess: false,
        accountStatus: AccountStatus.ACTIVE,
      });
      create.mockResolvedValue({
        id: 'program-default-range',
        name: '2026 OSS Contest',
      });

      await service.create(101n, {
        ...input,
        category,
        teamMinSize: undefined,
        teamMaxSize: undefined,
      });

      const request = create.mock.calls.at(-1)?.[0];
      expect(request?.data.teamMinSize).toBe(1);
      expect(request?.data.teamMaxSize).toBe(1);
    },
  );

  it('allows applicationEndAt to equal the operating start', async () => {
    findUnique.mockResolvedValue({
      hasStaffAccess: true,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
    });
    create.mockResolvedValue({
      id: 'program-equal-boundary',
      name: '2026 OSS Contest',
    });

    await expect(
      service.create(101n, {
        ...input,
        startAt: input.applicationEndAt,
      }),
    ).resolves.toEqual({
      id: 'program-equal-boundary',
      name: '2026 OSS Contest',
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'application end after program start',
      '2026-08-15T23:59:58+09:00',
      input.endAt,
    ],
    ['program start equal to program end', input.endAt, input.endAt],
    [
      'program start after program end',
      '2027-02-02T00:00:00+09:00',
      input.endAt,
    ],
  ])('rejects %s before a program is stored', async (_case, startAt, endAt) => {
    findUnique.mockResolvedValue({
      hasStaffAccess: true,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
    });

    await expect(
      service.create(101n, { ...input, startAt, endAt }),
    ).rejects.toMatchObject<Partial<DomainException>>({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.VALIDATION_ERROR],
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a reversed team range before a program is stored', async () => {
    findUnique.mockResolvedValue({
      hasStaffAccess: true,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
    });

    await expect(
      service.create(101n, { ...input, teamMinSize: 4, teamMaxSize: 2 }),
    ).rejects.toMatchObject<Partial<DomainException>>({
      errorCode: {
        code: ProgramErrorCode.VALIDATION_ERROR,
        message: PROGRAM_ERROR_CODES[ProgramErrorCode.VALIDATION_ERROR].message,
        status: 400,
      },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['invalid', 'not-a-date'],
    ['equal to application end', input.applicationEndAt],
    ['before application end', '2026-08-15T23:59:58+09:00'],
  ])('rejects an endAt that is %s', async (_case, endAt) => {
    findUnique.mockResolvedValue({
      hasStaffAccess: true,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
    });

    await expect(
      service.create(101n, {
        ...input,
        endAt,
      } as CreateProgramRequestDto),
    ).rejects.toMatchObject<Partial<DomainException>>({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.VALIDATION_ERROR],
      extensions: {
        fieldErrors: [
          {
            field: 'endAt',
            code: 'INVALID_END_AT',
            message:
              'Program end must be a valid date after the application period ends.',
          },
        ],
      },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects inactive staff before a program is stored', async () => {
    findUnique.mockResolvedValue({
      hasStaffAccess: true,
      hasAdminAccess: false,
      accountStatus: AccountStatus.DEACTIVATED,
    });

    await expect(service.create(101n, input)).rejects.toMatchObject<
      Partial<DomainException>
    >({
      errorCode: PROGRAM_ERROR_CODES[ProgramErrorCode.FORBIDDEN],
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('records PROGRAM_CREATED on the same TransactionClient as create', async () => {
    findUnique.mockResolvedValue({
      hasStaffAccess: true,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
    });
    create.mockResolvedValue({ id: 'program-audit', name: '2026 OSS Contest' });

    await service.create(101n, input);

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[1]).toBe(writer);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorGithubId: 101n,
        action: PROGRAM_CREATED_AUDIT_ACTIONS.PROGRAM_CREATED,
        targetType: 'PROGRAM',
        targetId: 'program-audit',
        metadata: {
          schemaVersion: 1,
          programName: '2026 OSS Contest',
        },
      }),
      writer,
    );
  });
});
