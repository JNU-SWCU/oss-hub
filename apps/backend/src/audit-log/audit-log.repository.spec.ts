import {
  AccountStatus,
  ProgramLifecycle,
  Role,
  RoleRequestStatus,
  type Prisma,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import {
  ACCESS_AUDIT_EVENT_KINDS,
  createAccessAuditMetadata,
  createProgramCreatedAuditMetadata,
  createProgramLifecycleAuditMetadata,
  createTeamCreatedAuditMetadata,
} from './audit-log-metadata';
import { AuditLogRepository } from './audit-log.repository';

// REPOSITORY_PUBLISH v1 metadata — repositoryFullName 스냅샷이 없어 join이 필요한
// 과거 행 시나리오를 만드는 데 쓴다(PROGRAM v1 테스트와 같은 패턴).
const LEGACY_REPOSITORY_PUBLISH_V1_METADATA = {
  schemaVersion: 1,
  repositoryId: 'repository-legacy',
  before: { visibility: 'PRIVATE' },
  after: { visibility: 'PUBLIC', publishedAt: '2026-07-24T04:00:00.000Z' },
} as const;

// APPLICATION_DECISION v1 metadata — applicantGithubLogin/programName 스냅샷이
// 없어 join이 필요한 과거 행 시나리오를 만드는 데 쓴다.
const LEGACY_APPLICATION_DECISION_V1_METADATA = {
  schemaVersion: 1,
  before: { status: 'SUBMITTED' },
  after: { status: 'APPROVED' },
} as const;

describe('AuditLogRepository', () => {
  it('필터를 AND로 적용하고 발생 시각 최신순으로 조회한다', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      auditLog: { findMany, count: jest.fn().mockResolvedValue(0) },
    } as unknown as PrismaService;
    const repository = new AuditLogRepository(prisma);

    await repository.list({
      actor: 'synthetic-admin',
      action: 'STAFF_ROLE_REQUEST_APPROVED',
      from: '2026-07-24',
      to: '2026-07-24',
      page: 1,
      limit: 20,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          actor: {
            nickname: { contains: 'synthetic-admin', mode: 'insensitive' },
          },
          action: 'STAFF_ROLE_REQUEST_APPROVED',
          occurredAt: {
            gte: new Date('2026-07-23T15:00:00.000Z'),
            lte: new Date('2026-07-24T14:59:59.999Z'),
          },
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('버전이 지정된 접근 감사 metadata를 변경 없이 저장한다', async () => {
    const metadata = {
      schemaVersion: 1,
      eventKind: 'ROLE_REQUEST_REJECTED',
      actor: {
        displayName: '합성 관리자',
        githubLogin: 'synthetic-admin',
      },
      before: {
        role: null,
        accountStatus: AccountStatus.ACTIVE,
        requestStatus: RoleRequestStatus.PENDING,
      },
      after: {
        role: null,
        accountStatus: AccountStatus.ACTIVE,
        requestStatus: RoleRequestStatus.REJECTED,
      },
      rejectionReason: '합성 반려 사유',
    } as const;
    const create = jest
      .fn<Promise<unknown>, [Prisma.AuditLogCreateArgs]>()
      .mockResolvedValue({
        id: 'audit-1',
        actor: { nickname: 'synthetic-admin' },
        action: 'STAFF_ROLE_REQUEST_REJECTED',
        targetType: 'ROLE_REQUEST',
        targetId: 'request-1',
        metadata,
        occurredAt: new Date('2026-07-24T03:00:00.000Z'),
      });
    const prisma = { auditLog: { create } } as unknown as PrismaService;
    const repository = new AuditLogRepository(prisma);
    const input = {
      actorGithubId: 1001n,
      action: 'STAFF_ROLE_REQUEST_REJECTED',
      targetType: 'ROLE_REQUEST',
      targetId: 'request-1',
      metadata,
    };

    await repository.record(input);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0].data).toEqual({
      actor: { connect: { githubId: 1001n } },
      action: 'STAFF_ROLE_REQUEST_REJECTED',
      targetType: 'ROLE_REQUEST',
      targetId: 'request-1',
      metadata,
    });
  });

  it('legacy metadata 빈 객체를 다시 쓰지 않고 legacy 증거로 매핑한다', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'legacy-audit',
        actor: { nickname: 'current-admin-login' },
        action: 'STAFF_ROLE_REQUEST_APPROVED',
        targetType: 'ROLE_REQUEST',
        targetId: 'request-legacy',
        metadata: {},
        occurredAt: new Date('2026-07-24T03:00:00.000Z'),
      },
    ]);
    const prisma = {
      auditLog: { findMany, count: jest.fn().mockResolvedValue(1) },
    } as unknown as PrismaService;
    const repository = new AuditLogRepository(prisma);

    const result = await repository.list({ page: 1, limit: 20 });

    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'legacy-audit',
        legacy: true,
        metadata: null,
        target: 'ROLE_REQUEST / request-legacy',
      }),
    ]);
  });

  it('schemaVersion 1(대상 스냅샷 없음) 행은 target 라벨을 targetType/targetId 폴백으로 계산한다', async () => {
    const metadata = {
      schemaVersion: 1,
      eventKind: 'DIRECT_ROLE_CHANGED',
      actor: {
        displayName: '이벤트 시점 관리자',
        githubLogin: 'event-time-admin',
      },
      before: {
        role: Role.STAFF,
        accountStatus: AccountStatus.ACTIVE,
        requestStatus: null,
      },
      after: {
        role: Role.ADMIN,
        accountStatus: AccountStatus.ACTIVE,
        requestStatus: null,
      },
    } as const;
    const prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'audit-v1',
            actor: { nickname: 'event-time-admin' },
            action: 'USER_ROLE_CHANGED',
            targetType: 'USER',
            targetId: 'v1-target',
            metadata,
            occurredAt: new Date('2026-07-24T03:00:00.000Z'),
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
    } as unknown as PrismaService;
    const repository = new AuditLogRepository(prisma);

    const result = await repository.list({ page: 1, limit: 20 });

    expect(result.items).toEqual([
      expect.objectContaining({
        legacy: false,
        target: 'USER / v1-target',
      }),
    ]);
  });

  it('새 감사 행은 현재 User가 아니라 metadata의 이벤트 시점 행위자·대상 정체성을 반환한다', async () => {
    const metadata = createAccessAuditMetadata({
      eventKind: ACCESS_AUDIT_EVENT_KINDS.DIRECT_ROLE_CHANGED,
      actor: {
        displayName: '이벤트 시점 관리자',
        githubLogin: 'event-time-admin',
      },
      target: {
        displayName: '이벤트 시점 대상',
        githubLogin: 'event-time-target',
      },
      before: {
        role: Role.STAFF,
        accountStatus: AccountStatus.ACTIVE,
        requestStatus: null,
      },
      after: {
        role: Role.ADMIN,
        accountStatus: AccountStatus.ACTIVE,
        requestStatus: null,
      },
    });
    const prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'audit-snapshot',
            actor: { nickname: 'renamed-admin' },
            action: 'USER_ROLE_CHANGED',
            targetType: 'USER',
            targetId: 'target-user',
            metadata,
            occurredAt: new Date('2026-07-24T03:00:00.000Z'),
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
    } as unknown as PrismaService;
    const repository = new AuditLogRepository(prisma);

    const result = await repository.list({ page: 1, limit: 20 });

    expect(result.items).toEqual([
      expect.objectContaining({
        actor: '이벤트 시점 관리자',
        actorHandle: 'event-time-admin',
        legacy: false,
        metadata,
        target: '이벤트 시점 대상',
        targetHandle: 'event-time-target',
      }),
    ]);
  });

  it('PROGRAM_ARCHIVED가 schemaVersion 2(이름 스냅샷) metadata면 join 없이 스냅샷 이름을 target으로 쓴다', async () => {
    const metadata = createProgramLifecycleAuditMetadata({
      programName: '스냅샷 프로그램 이름',
      before: { lifecycle: ProgramLifecycle.PUBLISHED },
      after: { lifecycle: ProgramLifecycle.ARCHIVED },
    });
    const programFindMany = jest.fn();
    const prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'audit-program-v2',
            actor: { nickname: 'synthetic-staff' },
            action: 'PROGRAM_ARCHIVED',
            targetType: 'PROGRAM',
            targetId: 'program-1',
            metadata,
            occurredAt: new Date('2026-07-24T03:00:00.000Z'),
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      program: { findMany: programFindMany },
    } as unknown as PrismaService;
    const repository = new AuditLogRepository(prisma);

    const result = await repository.list({ page: 1, limit: 20 });

    expect(programFindMany).not.toHaveBeenCalled();
    expect(result.items).toEqual([
      expect.objectContaining({ target: '스냅샷 프로그램 이름' }),
    ]);
  });

  it('PROGRAM_ARCHIVED가 이름 스냅샷 없는(v1) metadata면 targetId를 join해 현재 이름을 target으로 쓴다', async () => {
    const legacyV1Metadata = {
      schemaVersion: 1,
      before: { lifecycle: ProgramLifecycle.PUBLISHED },
      after: { lifecycle: ProgramLifecycle.ARCHIVED },
    } as const;
    const programFindMany = jest
      .fn()
      .mockResolvedValue([{ id: 'program-2', name: '현재 프로그램 이름' }]);
    const prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'audit-program-v1',
            actor: { nickname: 'synthetic-staff' },
            action: 'PROGRAM_ARCHIVED',
            targetType: 'PROGRAM',
            targetId: 'program-2',
            metadata: legacyV1Metadata,
            occurredAt: new Date('2026-07-24T03:00:00.000Z'),
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      program: { findMany: programFindMany },
    } as unknown as PrismaService;
    const repository = new AuditLogRepository(prisma);

    const result = await repository.list({ page: 1, limit: 20 });

    expect(programFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['program-2'] } },
      select: { id: true, name: true },
    });
    expect(result.items).toEqual([
      expect.objectContaining({ target: '현재 프로그램 이름' }),
    ]);
  });

  it('join으로도 프로그램을 찾지 못하면 cuid 폴백을 유지한다', async () => {
    const legacyV1Metadata = {
      schemaVersion: 1,
      before: { lifecycle: ProgramLifecycle.PUBLISHED },
      after: { lifecycle: ProgramLifecycle.ARCHIVED },
    } as const;
    const programFindMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'audit-program-missing',
            actor: { nickname: 'synthetic-staff' },
            action: 'PROGRAM_ARCHIVED',
            targetType: 'PROGRAM',
            targetId: 'program-deleted-somehow',
            metadata: legacyV1Metadata,
            occurredAt: new Date('2026-07-24T03:00:00.000Z'),
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      program: { findMany: programFindMany },
    } as unknown as PrismaService;
    const repository = new AuditLogRepository(prisma);

    const result = await repository.list({ page: 1, limit: 20 });

    expect(result.items).toEqual([
      expect.objectContaining({
        target: 'PROGRAM / program-deleted-somehow',
      }),
    ]);
  });

  it('한 페이지에서 이름이 필요한 PROGRAM 행이 여럿이어도 program.findMany를 한 번만 호출한다(N+1 방지)', async () => {
    const legacyV1Metadata = {
      schemaVersion: 1,
      before: { lifecycle: ProgramLifecycle.PUBLISHED },
      after: { lifecycle: ProgramLifecycle.ARCHIVED },
    } as const;
    const programFindMany = jest.fn().mockResolvedValue([
      { id: 'program-a', name: '이름 A' },
      { id: 'program-b', name: '이름 B' },
    ]);
    const prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'audit-a',
            actor: { nickname: 'synthetic-staff' },
            action: 'PROGRAM_ARCHIVED',
            targetType: 'PROGRAM',
            targetId: 'program-a',
            metadata: legacyV1Metadata,
            occurredAt: new Date('2026-07-24T03:00:00.000Z'),
          },
          {
            id: 'audit-b',
            actor: { nickname: 'synthetic-staff' },
            action: 'PROGRAM_RESTORED',
            targetType: 'PROGRAM',
            targetId: 'program-b',
            metadata: legacyV1Metadata,
            occurredAt: new Date('2026-07-24T03:01:00.000Z'),
          },
        ]),
        count: jest.fn().mockResolvedValue(2),
      },
      program: { findMany: programFindMany },
    } as unknown as PrismaService;
    const repository = new AuditLogRepository(prisma);

    const result = await repository.list({ page: 1, limit: 20 });

    expect(programFindMany).toHaveBeenCalledTimes(1);
    expect(programFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['program-a', 'program-b'] } },
      select: { id: true, name: true },
    });
    expect(result.items).toEqual([
      expect.objectContaining({ target: '이름 A' }),
      expect.objectContaining({ target: '이름 B' }),
    ]);
  });

  it('REPOSITORY_PUBLISHED가 schemaVersion 2(전체 이름 스냅샷) metadata면 join 없이 스냅샷 이름을 target으로 쓴다', async () => {
    const metadata = {
      schemaVersion: 2,
      repositoryId: 'repository-1',
      repositoryFullName: 'synthetic-org/synthetic-repo',
      before: { visibility: 'PRIVATE' },
      after: { visibility: 'PUBLIC', publishedAt: '2026-07-24T04:00:00.000Z' },
    } as const;
    const repositoryFindMany = jest.fn();
    const prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'audit-repository-v2',
            actor: { nickname: 'synthetic-staff' },
            action: 'REPOSITORY_PUBLISHED',
            targetType: 'REPOSITORY',
            targetId: 'repository-1',
            metadata,
            occurredAt: new Date('2026-07-24T03:00:00.000Z'),
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      githubRepository: { findMany: repositoryFindMany },
    } as unknown as PrismaService;
    const repository = new AuditLogRepository(prisma);

    const result = await repository.list({ page: 1, limit: 20 });

    expect(repositoryFindMany).not.toHaveBeenCalled();
    expect(result.items).toEqual([
      expect.objectContaining({ target: 'synthetic-org/synthetic-repo' }),
    ]);
  });

  it('REPOSITORY_PUBLISHED가 전체 이름 스냅샷 없는(v1) metadata면 targetId를 join해 owner/name을 target으로 쓴다', async () => {
    const repositoryFindMany = jest.fn().mockResolvedValue([
      {
        id: 'repository-legacy',
        nameWithOwner: 'synthetic-org/synthetic-repo',
      },
    ]);
    const prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'audit-repository-v1',
            actor: { nickname: 'synthetic-staff' },
            action: 'REPOSITORY_PUBLISHED',
            targetType: 'REPOSITORY',
            targetId: 'repository-legacy',
            metadata: LEGACY_REPOSITORY_PUBLISH_V1_METADATA,
            occurredAt: new Date('2026-07-24T03:00:00.000Z'),
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      githubRepository: { findMany: repositoryFindMany },
    } as unknown as PrismaService;
    const repository = new AuditLogRepository(prisma);

    const result = await repository.list({ page: 1, limit: 20 });

    expect(repositoryFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['repository-legacy'] } },
      select: { id: true, nameWithOwner: true },
    });
    expect(result.items).toEqual([
      expect.objectContaining({ target: 'synthetic-org/synthetic-repo' }),
    ]);
  });

  it('join으로도 저장소를 찾지 못하면 cuid 폴백을 유지한다(REPOSITORY)', async () => {
    const repositoryFindMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'audit-repository-missing',
            actor: { nickname: 'synthetic-staff' },
            action: 'REPOSITORY_PUBLISHED',
            targetType: 'REPOSITORY',
            targetId: 'repository-deleted-somehow',
            metadata: LEGACY_REPOSITORY_PUBLISH_V1_METADATA,
            occurredAt: new Date('2026-07-24T03:00:00.000Z'),
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      githubRepository: { findMany: repositoryFindMany },
    } as unknown as PrismaService;
    const repository = new AuditLogRepository(prisma);

    const result = await repository.list({ page: 1, limit: 20 });

    expect(result.items).toEqual([
      expect.objectContaining({
        target: 'REPOSITORY / repository-deleted-somehow',
      }),
    ]);
  });

  it('APPLICATION_APPROVED가 schemaVersion 2(프로그램·신청자 스냅샷) metadata면 join 없이 합성 라벨을 target으로 쓴다', async () => {
    const metadata = {
      schemaVersion: 2,
      programName: '스냅샷 프로그램',
      applicantGithubLogin: 'snapshot-applicant',
      before: { status: 'SUBMITTED' },
      after: { status: 'APPROVED' },
    } as const;
    const applicationFindMany = jest.fn();
    const prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'audit-application-v2',
            actor: { nickname: 'synthetic-staff' },
            action: 'APPLICATION_APPROVED',
            targetType: 'APPLICATION',
            targetId: 'application-1',
            metadata,
            occurredAt: new Date('2026-07-24T03:00:00.000Z'),
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      application: { findMany: applicationFindMany },
    } as unknown as PrismaService;
    const repository = new AuditLogRepository(prisma);

    const result = await repository.list({ page: 1, limit: 20 });

    expect(applicationFindMany).not.toHaveBeenCalled();
    expect(result.items).toEqual([
      expect.objectContaining({
        target: '스냅샷 프로그램 · @snapshot-applicant',
      }),
    ]);
  });

  it('APPLICATION_APPROVED가 스냅샷 없는(v1) metadata면 targetId를 join해 프로그램 이름만 target으로 쓴다', async () => {
    const applicationFindMany = jest.fn().mockResolvedValue([
      {
        id: 'application-legacy',
        program: { name: '현재 프로그램 이름' },
      },
    ]);
    const prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'audit-application-v1',
            actor: { nickname: 'synthetic-staff' },
            action: 'APPLICATION_APPROVED',
            targetType: 'APPLICATION',
            targetId: 'application-legacy',
            metadata: LEGACY_APPLICATION_DECISION_V1_METADATA,
            occurredAt: new Date('2026-07-24T03:00:00.000Z'),
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      application: { findMany: applicationFindMany },
    } as unknown as PrismaService;
    const repository = new AuditLogRepository(prisma);

    const result = await repository.list({ page: 1, limit: 20 });

    expect(applicationFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['application-legacy'] } },
      select: {
        id: true,
        program: { select: { name: true } },
      },
    });
    expect(result.items).toEqual([
      expect.objectContaining({
        target: '현재 프로그램 이름',
      }),
    ]);
  });

  it('v1 APPLICATION join select는 applicant를 절대 요청하지 않고, 신청자 로그인이 있어도 라벨에 새지 않는다(ADR-007)', async () => {
    // applicant를 select에 넣지 않았는데도 Prisma mock이 실수로 돌려주는 상황을 가정해
    // resolveApplicationLabels가 그 값을 라벨 합성에 쓰지 않는다는 것까지 확인한다.
    const applicationFindMany = jest
      .fn<Promise<unknown>, [Prisma.ApplicationFindManyArgs]>()
      .mockResolvedValue([
        {
          id: 'application-legacy',
          program: { name: '현재 프로그램 이름' },
          applicant: { nickname: 'should-never-appear-in-label' },
        },
      ]);
    const prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'audit-application-v1',
            actor: { nickname: 'synthetic-staff' },
            action: 'APPLICATION_APPROVED',
            targetType: 'APPLICATION',
            targetId: 'application-legacy',
            metadata: LEGACY_APPLICATION_DECISION_V1_METADATA,
            occurredAt: new Date('2026-07-24T03:00:00.000Z'),
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      application: { findMany: applicationFindMany },
    } as unknown as PrismaService;
    const repository = new AuditLogRepository(prisma);

    const result = await repository.list({ page: 1, limit: 20 });

    expect(applicationFindMany.mock.calls[0]?.[0].select).not.toHaveProperty(
      'applicant',
    );
    expect(result.items).toEqual([
      expect.objectContaining({ target: '현재 프로그램 이름' }),
    ]);
    expect(
      result.items.some((item) =>
        item.target.includes('should-never-appear-in-label'),
      ),
    ).toBe(false);
  });

  it('join으로도 신청을 찾지 못하면 cuid 폴백을 유지한다(APPLICATION)', async () => {
    const applicationFindMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'audit-application-missing',
            actor: { nickname: 'synthetic-staff' },
            action: 'APPLICATION_APPROVED',
            targetType: 'APPLICATION',
            targetId: 'application-deleted-somehow',
            metadata: LEGACY_APPLICATION_DECISION_V1_METADATA,
            occurredAt: new Date('2026-07-24T03:00:00.000Z'),
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      application: { findMany: applicationFindMany },
    } as unknown as PrismaService;
    const repository = new AuditLogRepository(prisma);

    const result = await repository.list({ page: 1, limit: 20 });

    expect(result.items).toEqual([
      expect.objectContaining({
        target: 'APPLICATION / application-deleted-somehow',
      }),
    ]);
  });

  it('한 페이지에서 이름이 필요한 REPOSITORY/APPLICATION 행이 섞여 있어도 각각 findMany를 한 번만 호출한다(N+1 방지)', async () => {
    const repositoryFindMany = jest.fn().mockResolvedValue([
      {
        id: 'repository-a',
        nameWithOwner: 'org/repo-a',
      },
    ]);
    const applicationFindMany = jest.fn().mockResolvedValue([
      {
        id: 'application-a',
        program: { name: '프로그램 A' },
      },
    ]);
    const prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'audit-repo-a',
            actor: { nickname: 'synthetic-staff' },
            action: 'REPOSITORY_PUBLISHED',
            targetType: 'REPOSITORY',
            targetId: 'repository-a',
            metadata: LEGACY_REPOSITORY_PUBLISH_V1_METADATA,
            occurredAt: new Date('2026-07-24T03:00:00.000Z'),
          },
          {
            id: 'audit-app-a',
            actor: { nickname: 'synthetic-staff' },
            action: 'APPLICATION_APPROVED',
            targetType: 'APPLICATION',
            targetId: 'application-a',
            metadata: LEGACY_APPLICATION_DECISION_V1_METADATA,
            occurredAt: new Date('2026-07-24T03:01:00.000Z'),
          },
        ]),
        count: jest.fn().mockResolvedValue(2),
      },
      githubRepository: { findMany: repositoryFindMany },
      application: { findMany: applicationFindMany },
    } as unknown as PrismaService;
    const repository = new AuditLogRepository(prisma);

    const result = await repository.list({ page: 1, limit: 20 });

    expect(repositoryFindMany).toHaveBeenCalledTimes(1);
    expect(applicationFindMany).toHaveBeenCalledTimes(1);
    expect(result.items).toEqual([
      expect.objectContaining({ target: 'org/repo-a' }),
      expect.objectContaining({ target: '프로그램 A' }),
    ]);
  });

  it('teamName+programName compose wins over programName-only', async () => {
    const metadata = createTeamCreatedAuditMetadata({
      programName: '스냅샷 프로그램',
      teamName: '스냅샷 팀',
    });
    const teamFindMany = jest.fn();
    const prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'audit-team-created',
            actor: { nickname: 'synthetic-student' },
            action: 'TEAM_CREATED',
            targetType: 'TEAM',
            targetId: 'team-1',
            metadata,
            occurredAt: new Date('2026-07-24T03:00:00.000Z'),
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      team: { findMany: teamFindMany },
    } as unknown as PrismaService;
    const repository = new AuditLogRepository(prisma);

    const result = await repository.list({ page: 1, limit: 20 });

    expect(teamFindMany).not.toHaveBeenCalled();
    expect(result.items).toEqual([
      expect.objectContaining({ target: '스냅샷 프로그램 · 스냅샷 팀' }),
    ]);
  });

  it('APPLICATION_APPROVED v2 still composes @login', async () => {
    const metadata = {
      schemaVersion: 2,
      programName: '스냅샷 프로그램',
      applicantGithubLogin: 'snapshot-applicant',
      before: { status: 'SUBMITTED' },
      after: { status: 'APPROVED' },
    } as const;
    const applicationFindMany = jest.fn();
    const prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'audit-application-v2-compose',
            actor: { nickname: 'synthetic-staff' },
            action: 'APPLICATION_APPROVED',
            targetType: 'APPLICATION',
            targetId: 'application-1',
            metadata,
            occurredAt: new Date('2026-07-24T03:00:00.000Z'),
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      application: { findMany: applicationFindMany },
    } as unknown as PrismaService;
    const repository = new AuditLogRepository(prisma);

    const result = await repository.list({ page: 1, limit: 20 });

    expect(applicationFindMany).not.toHaveBeenCalled();
    expect(result.items).toEqual([
      expect.objectContaining({
        target: '스냅샷 프로그램 · @snapshot-applicant',
      }),
    ]);
  });

  it('if View drops teamName, compose fails (program name only)', async () => {
    const metadata = createProgramCreatedAuditMetadata({
      programName: '스냅샷 프로그램',
    });
    const prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'audit-program-created',
            actor: { nickname: 'synthetic-staff' },
            action: 'PROGRAM_CREATED',
            targetType: 'PROGRAM',
            targetId: 'program-1',
            metadata,
            occurredAt: new Date('2026-07-24T03:00:00.000Z'),
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
    } as unknown as PrismaService;
    const repository = new AuditLogRepository(prisma);

    const result = await repository.list({ page: 1, limit: 20 });

    expect(result.items).toEqual([
      expect.objectContaining({ target: '스냅샷 프로그램' }),
    ]);
  });

  it('page와 limit으로 결정한 구간과 동일한 필터의 total을 반환한다', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(21);
    const prisma = {
      auditLog: { findMany, count },
    } as unknown as PrismaService;
    const repository = new AuditLogRepository(prisma);

    const result = await repository.list({
      actor: 'synthetic-admin',
      page: 2,
      limit: 10,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(count).toHaveBeenCalledWith({
      where: {
        actor: {
          nickname: { contains: 'synthetic-admin', mode: 'insensitive' },
        },
        action: undefined,
        occurredAt: undefined,
      },
    });
    expect(result).toEqual({ items: [], total: 21 });
  });
});
