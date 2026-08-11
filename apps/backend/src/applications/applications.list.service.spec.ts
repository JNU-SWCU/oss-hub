import {
  ApplicationStatus,
  OutboxEventStatus,
  Prisma,
  ProgramCategory,
  RepositoryConnectionMode,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
} from '@prisma/client';
import {
  type ApplicationListPage,
  ApplicationsRepository,
  type ApplyProgramRecord,
} from './applications.repository';
import { ApplicationsErrorCode } from './applications-error-code.enum';
import { ApplicationsService } from './applications.service';
import type { AuditLogService } from '../audit-log/audit-log.service';

/** 이 스펙들은 판정 경로를 타지 않으므로 감사 기록기는 호출되지 않는다. */
const noopAuditLog = { record: jest.fn() } as unknown as AuditLogService;

const PROGRAM_ID = 'synthetic-program';

const OPEN_PROGRAM: ApplyProgramRecord = {
  id: PROGRAM_ID,
  category: ProgramCategory.BASIC,
  applicationTemplateVersion: 1,
  applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
  applicationEndAt: new Date('2026-07-31T23:59:59.000Z'),
  repositoryProvisioningEnabled: false,
};

const EMPTY_PAGE: ApplicationListPage = {
  items: [],
  page: 1,
  pageSize: 20,
  totalItems: 0,
  totalPages: 0,
};

describe('ApplicationsService.listForProgram', () => {
  it('프로그램이 없으면 404 를 던진다', async () => {
    const listApplicationsForProgram = jest.fn();
    const repository = {
      findProgramById: jest.fn().mockResolvedValue(null),
      listApplicationsForProgram,
    } as unknown as ApplicationsRepository;
    const service = new ApplicationsService(repository, noopAuditLog);

    await expect(
      service.listForProgram(PROGRAM_ID, {
        page: 1,
        pageSize: 20,
        search: '',
        status: 'all',
      }),
    ).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.PROGRAM_NOT_FOUND,
        status: 404,
      },
    });
    expect(listApplicationsForProgram).not.toHaveBeenCalled();
  });

  it('프로그램이 있으면 repository 목록을 그대로 반환한다', async () => {
    const page: ApplicationListPage = {
      items: [
        {
          id: 'app-1',
          programId: PROGRAM_ID,
          repositoryConnectionMode: RepositoryConnectionMode.NEW,
          repositoryUrl: null,
          status: ApplicationStatus.SUBMITTED,
          submittedAt: new Date('2026-07-15T00:00:00.000Z'),
          rejectionReason: null,
          repositoryProvisioning: {
            enabled: true,
            jobStatus: 'NOT_REQUESTED',
            updatedAt: new Date('2026-07-15T01:00:00.000Z'),
            safeErrorClass: null,
          },
          repository: null,
          isRepositoryPublicationPlanned: true,
          participation: 'INDIVIDUAL',
          applicant: {
            id: 'student-1',
            name: '합성 학생',
            nickname: 'login-1',
          },
          team: null,
          answers: {
            applicantName: '합성 학생',
            title: '제목',
            summary: '요약',
          },
        },
        {
          id: 'app-2',
          programId: PROGRAM_ID,
          repositoryConnectionMode: RepositoryConnectionMode.NEW,
          repositoryUrl: null,
          status: ApplicationStatus.APPROVED,
          submittedAt: new Date('2026-07-16T00:00:00.000Z'),
          rejectionReason: null,
          repositoryProvisioning: {
            enabled: true,
            jobStatus: 'PENDING',
            updatedAt: new Date('2026-07-16T01:00:00.000Z'),
            safeErrorClass: null,
          },
          repository: {
            url: 'https://github.test/synthetic-org/team-1',
            visibility: RepositoryVisibility.PRIVATE,
          },
          isRepositoryPublicationPlanned: false,
          participation: 'TEAM',
          applicant: {
            id: 'student-2',
            name: '팀장',
            nickname: 'leader',
          },
          team: { id: 'team-1', name: '합성 팀', memberCount: 3 },
          answers: {
            applicantName: '팀장',
            title: '팀 제목',
            summary: '팀 요약',
          },
        },
      ],
      page: 2,
      pageSize: 10,
      totalItems: 12,
      totalPages: 2,
    };
    const listApplicationsForProgram = jest.fn().mockResolvedValue(page);
    const repository = {
      findProgramById: jest.fn().mockResolvedValue(OPEN_PROGRAM),
      listApplicationsForProgram,
    } as unknown as ApplicationsRepository;
    const service = new ApplicationsService(repository, noopAuditLog);
    const query = {
      page: 2,
      pageSize: 10,
      search: '합성',
      status: 'SUBMITTED' as const,
    };

    await expect(service.listForProgram(PROGRAM_ID, query)).resolves.toEqual(
      page,
    );
    expect(listApplicationsForProgram).toHaveBeenCalledWith(PROGRAM_ID, query);
    expect(page.items[0]?.team).toBeNull();
    expect(page.items[1]?.team?.name).toBe('합성 팀');
  });

  it('빈 목록도 페이지 메타를 유지한다', async () => {
    const repository = {
      findProgramById: jest.fn().mockResolvedValue(OPEN_PROGRAM),
      listApplicationsForProgram: jest.fn().mockResolvedValue(EMPTY_PAGE),
    } as unknown as ApplicationsRepository;
    const service = new ApplicationsService(repository, noopAuditLog);

    await expect(
      service.listForProgram(PROGRAM_ID, {
        page: 1,
        pageSize: 20,
        search: '',
        status: 'all',
      }),
    ).resolves.toEqual(EMPTY_PAGE);
  });
});

describe('ApplicationsRepository.listApplicationsForProgram', () => {
  const applicationUpdatedAt = new Date('2026-07-25T01:00:00.000Z');
  const outboxCreatedAt = new Date('2026-07-25T02:00:00.000Z');
  const jobUpdatedAt = new Date('2026-07-25T03:00:00.000Z');
  const query = {
    page: 1,
    pageSize: 20,
    search: '',
    status: 'all' as const,
  };

  type ProjectionSource = {
    applicationStatus?: ApplicationStatus;
    enabled?: boolean;
    outboxStatus?: OutboxEventStatus;
    jobStatus?: RepositoryProvisionJobStatus;
    lastErrorCode?: string | null;
  };

  const projectRepositoryProvisioning = async ({
    applicationStatus = ApplicationStatus.APPROVED,
    enabled = true,
    outboxStatus,
    jobStatus,
    lastErrorCode = null,
  }: ProjectionSource) => {
    const transaction = {
      application: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'app-1',
            status: applicationStatus,
            submittedAt: applicationUpdatedAt,
            updatedAt: applicationUpdatedAt,
            rejectionReason: null,
            teamId: null,
            answers: {},
            program: { repositoryProvisioningEnabled: enabled },
            applicant: { id: 'student-1', name: null, nickname: 'student' },
            team: null,
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      outboxEvent: {
        findMany: jest.fn().mockResolvedValue(
          outboxStatus === undefined
            ? []
            : [
                {
                  idempotencyKey: 'repository-provision:app-1',
                  status: outboxStatus,
                  createdAt: outboxCreatedAt,
                },
              ],
        ),
      },
      repositoryProvisionJob: {
        findMany: jest.fn().mockResolvedValue(
          jobStatus === undefined
            ? []
            : [
                {
                  applicationId: 'app-1',
                  status: jobStatus,
                  updatedAt: jobUpdatedAt,
                  lastErrorCode,
                },
              ],
        ),
      },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation(
          (operation: (client: typeof transaction) => Promise<unknown>) =>
            operation(transaction),
        ),
    };
    const repository = new ApplicationsRepository(prisma as never, {
      TEAM_JOIN_CODE_SECRET: 'synthetic-list-secret',
    });

    const page = await repository.listApplicationsForProgram(PROGRAM_ID, query);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    return page.items[0]?.repositoryProvisioning;
  };

  it.each([
    {
      name: 'enabled submitted without artifacts',
      source: { applicationStatus: ApplicationStatus.SUBMITTED, enabled: true },
      expected: {
        enabled: true,
        jobStatus: 'NOT_REQUESTED',
        updatedAt: applicationUpdatedAt,
        safeErrorClass: null,
      },
    },
    {
      name: 'disabled rejected without artifacts',
      source: { applicationStatus: ApplicationStatus.REJECTED, enabled: false },
      expected: {
        enabled: false,
        jobStatus: 'DISABLED',
        updatedAt: applicationUpdatedAt,
        safeErrorClass: null,
      },
    },
    {
      name: 'submitted with an outbox artifact',
      source: {
        applicationStatus: ApplicationStatus.SUBMITTED,
        outboxStatus: OutboxEventStatus.PENDING,
      },
      expected: {
        enabled: true,
        jobStatus: 'ANOMALOUS',
        updatedAt: applicationUpdatedAt,
        safeErrorClass: 'UNKNOWN',
      },
    },
    {
      name: 'rejected with completed artifacts',
      source: {
        applicationStatus: ApplicationStatus.REJECTED,
        enabled: false,
        outboxStatus: OutboxEventStatus.PROCESSED,
        jobStatus: RepositoryProvisionJobStatus.SUCCEEDED,
      },
      expected: {
        enabled: false,
        jobStatus: 'ANOMALOUS',
        updatedAt: applicationUpdatedAt,
        safeErrorClass: 'UNKNOWN',
      },
    },
  ])('non-approved: $name', async ({ source, expected }) => {
    await expect(projectRepositoryProvisioning(source)).resolves.toEqual(
      expected,
    );
  });

  it.each([
    ['job without outbox', undefined, RepositoryProvisionJobStatus.PENDING],
    [
      'job with pending outbox',
      OutboxEventStatus.PENDING,
      RepositoryProvisionJobStatus.PENDING,
    ],
    [
      'job with processing outbox',
      OutboxEventStatus.PROCESSING,
      RepositoryProvisionJobStatus.PROCESSING,
    ],
    [
      'job with failed outbox',
      OutboxEventStatus.FAILED,
      RepositoryProvisionJobStatus.FAILED_FINAL,
    ],
    ['processed outbox without job', OutboxEventStatus.PROCESSED, undefined],
  ])(
    'approved impossible relation: %s',
    async (_name, outboxStatus, jobStatus) => {
      await expect(
        projectRepositoryProvisioning({ outboxStatus, jobStatus }),
      ).resolves.toEqual({
        enabled: true,
        jobStatus: 'ANOMALOUS',
        updatedAt: applicationUpdatedAt,
        safeErrorClass: 'UNKNOWN',
      });
    },
  );

  it.each([
    [RepositoryProvisionJobStatus.PENDING, null, 'PENDING', null],
    [RepositoryProvisionJobStatus.PROCESSING, null, 'PROCESSING', null],
    [RepositoryProvisionJobStatus.SUCCEEDED, null, 'SUCCEEDED', null],
    [
      RepositoryProvisionJobStatus.FAILED_RETRYABLE,
      'GITHUB_OPERATIONS_RATE_LIMITED',
      'RETRYABLE_FAILED',
      'RATE_LIMIT',
    ],
    [
      RepositoryProvisionJobStatus.FAILED_FINAL,
      'GITHUB_OPERATIONS_AUTHENTICATION',
      'FAILED',
      'AUTH',
    ],
    [
      RepositoryProvisionJobStatus.FAILED_FINAL,
      'GITHUB_OPERATIONS_INVALID_INPUT',
      'FAILED',
      'UPSTREAM_REJECTED',
    ],
    [
      RepositoryProvisionJobStatus.FAILED_FINAL,
      'REPOSITORY_PROVISION_INTERNAL',
      'FAILED',
      'UNKNOWN',
    ],
  ])(
    'processed job %s with error %s projects %s',
    async (jobStatus, lastErrorCode, expectedStatus, safeErrorClass) => {
      await expect(
        projectRepositoryProvisioning({
          outboxStatus: OutboxEventStatus.PROCESSED,
          jobStatus,
          lastErrorCode,
        }),
      ).resolves.toEqual({
        enabled: true,
        jobStatus: expectedStatus,
        updatedAt: jobUpdatedAt,
        safeErrorClass,
      });
    },
  );

  it.each([
    [OutboxEventStatus.PENDING, 'PENDING', null],
    [OutboxEventStatus.PROCESSING, 'PENDING', null],
    [OutboxEventStatus.FAILED, 'FAILED', 'UNKNOWN'],
  ])(
    'enabled outbox-only %s projects %s',
    async (outboxStatus, expectedStatus, safeErrorClass) => {
      await expect(
        projectRepositoryProvisioning({ outboxStatus }),
      ).resolves.toEqual({
        enabled: true,
        jobStatus: expectedStatus,
        updatedAt: outboxCreatedAt,
        safeErrorClass,
      });
    },
  );

  it.each([
    [
      true,
      {
        enabled: true,
        jobStatus: 'ANOMALOUS',
        updatedAt: applicationUpdatedAt,
        safeErrorClass: 'UNKNOWN',
      },
    ],
    [
      false,
      {
        enabled: false,
        jobStatus: 'DISABLED',
        updatedAt: applicationUpdatedAt,
        safeErrorClass: null,
      },
    ],
  ])('approved no-artifact enabled=%s', async (enabled, expected) => {
    await expect(projectRepositoryProvisioning({ enabled })).resolves.toEqual(
      expected,
    );
  });

  it.each([
    OutboxEventStatus.PENDING,
    OutboxEventStatus.PROCESSING,
    OutboxEventStatus.FAILED,
  ])('disabled outbox-only %s is anomalous', async (outboxStatus) => {
    await expect(
      projectRepositoryProvisioning({ enabled: false, outboxStatus }),
    ).resolves.toEqual({
      enabled: false,
      jobStatus: 'ANOMALOUS',
      updatedAt: applicationUpdatedAt,
      safeErrorClass: 'UNKNOWN',
    });
  });

  /**
   * 저장소 주소는 `Application.repository` 1:1 관계에서만 온다 — 저장소 식별 단위는
   * application 이므로 `Team.repositories` 로 가지 않는다(schema.prisma Repository 주석, #113).
   */
  describe('repository 필드', () => {
    /** jest.fn() 의 호출 인자는 any 라 명시적으로 좁혀 읽는다. */
    const readSelect = (spy: jest.Mock): Record<string, unknown> => {
      const calls = spy.mock.calls as unknown as {
        select: Record<string, unknown>;
      }[][];
      const args = calls[0]?.[0];
      if (args === undefined) {
        throw new Error('application.findMany 가 호출되지 않았다');
      }
      return args.select;
    };

    const listWithRepository = async (
      repository: {
        nameWithOwner: string;
        visibility: RepositoryVisibility;
      } | null,
    ) => {
      const findMany = jest.fn().mockResolvedValue([
        {
          id: 'app-1',
          status: ApplicationStatus.APPROVED,
          submittedAt: applicationUpdatedAt,
          updatedAt: applicationUpdatedAt,
          rejectionReason: null,
          teamId: 'team-1',
          answers: {},
          isRepositoryPublicationPlanned: true,
          repository,
          program: { repositoryProvisioningEnabled: true },
          applicant: { id: 'student-1', name: null, nickname: 'student' },
          team: { id: 'team-1', name: '합성 팀', _count: { members: 2 } },
        },
      ]);
      const transaction = {
        application: { findMany, count: jest.fn().mockResolvedValue(1) },
        outboxEvent: { findMany: jest.fn().mockResolvedValue([]) },
        repositoryProvisionJob: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const prisma = {
        $transaction: jest
          .fn()
          .mockImplementation(
            (operation: (client: typeof transaction) => Promise<unknown>) =>
              operation(transaction),
          ),
      };
      const repositoryUnderTest = new ApplicationsRepository(prisma as never, {
        TEAM_JOIN_CODE_SECRET: 'synthetic-list-secret',
      });

      const page = await repositoryUnderTest.listApplicationsForProgram(
        PROGRAM_ID,
        query,
      );
      return { item: page.items[0], findMany };
    };

    it.each([RepositoryVisibility.PUBLIC, RepositoryVisibility.PRIVATE])(
      '%s 저장소의 url·visibility 를 그대로 내려보낸다',
      async (visibility) => {
        const { item } = await listWithRepository({
          nameWithOwner: 'synthetic-org/team-1',
          visibility,
        });

        expect(item?.repository).toEqual({
          url: 'https://github.com/synthetic-org/team-1',
          visibility,
        });
      },
    );

    it('저장소가 아직 없으면 null 이다', async () => {
      const { item } = await listWithRepository(null);

      expect(item?.repository).toBeNull();
    });

    it('Application.repository 1:1 관계만 select 하고 team.repositories 는 읽지 않는다', async () => {
      const { findMany } = await listWithRepository(null);

      const select = readSelect(findMany);
      expect(select).toMatchObject({
        repository: { select: { nameWithOwner: true, visibility: true } },
      });
      expect(select).toHaveProperty('team');
      expect(
        (select as { team: { select: Record<string, unknown> } }).team.select,
      ).not.toHaveProperty('repositories');
    });
  });
});
