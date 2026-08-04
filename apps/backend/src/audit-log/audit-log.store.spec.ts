import {
  AccountStatus,
  Role,
  RoleRequestStatus,
  type Prisma,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import {
  ACCESS_AUDIT_EVENT_KINDS,
  createAccessAuditMetadata,
} from './audit-log-metadata';
import { AuditLogStore } from './audit-log.store';

describe('AuditLogStore', () => {
  it('필터를 AND로 적용하고 발생 시각 최신순으로 조회한다', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      auditLog: { findMany, count: jest.fn().mockResolvedValue(0) },
    } as unknown as PrismaService;
    const repository = new AuditLogStore(prisma);

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
    const repository = new AuditLogStore(prisma);
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
    const repository = new AuditLogStore(prisma);

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
    const repository = new AuditLogStore(prisma);

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
    const repository = new AuditLogStore(prisma);

    const result = await repository.list({ page: 1, limit: 20 });

    expect(result.items).toEqual([
      expect.objectContaining({
        actor: 'event-time-admin',
        legacy: false,
        metadata,
        target: 'event-time-target',
      }),
    ]);
  });

  it('page와 limit으로 결정한 구간과 동일한 필터의 total을 반환한다', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(21);
    const prisma = {
      auditLog: { findMany, count },
    } as unknown as PrismaService;
    const repository = new AuditLogStore(prisma);

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
