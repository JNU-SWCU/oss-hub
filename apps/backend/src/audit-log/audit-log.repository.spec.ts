import { AccountStatus, Role } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { AuditLogRepository } from './audit-log.repository';

describe('AuditLogRepository', () => {
  it('필터를 AND로 적용하고 발생 시각 최신순으로 조회한다', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      auditLog: { findMany },
    } as unknown as PrismaService;
    const repository = new AuditLogRepository(prisma);

    await repository.list({
      actor: 'synthetic-admin',
      action: 'STAFF_ROLE_REQUEST_APPROVED',
      from: '2026-07-24',
      to: '2026-07-24',
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          actor: {
            login: { contains: 'synthetic-admin', mode: 'insensitive' },
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

  it('행위자 githubId로 감사 레코드를 생성한다', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'audit-1',
      actorId: 'admin-id',
      actor: { login: 'synthetic-admin' },
      action: 'STAFF_ROLE_REQUEST_REJECTED',
      targetType: 'ROLE_REQUEST',
      targetId: 'request-1',
      metadata: {},
      occurredAt: new Date('2026-07-24T03:00:00.000Z'),
    });
    const prisma = {
      auditLog: { create },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'admin-id',
          role: Role.ADMIN,
          accountStatus: AccountStatus.ACTIVE,
        }),
      },
    } as unknown as PrismaService;
    const repository = new AuditLogRepository(prisma);

    await repository.record({
      actorGithubId: 1001n,
      action: 'STAFF_ROLE_REQUEST_REJECTED',
      targetType: 'ROLE_REQUEST',
      targetId: 'request-1',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        actor: { connect: { githubId: 1001n } },
        action: 'STAFF_ROLE_REQUEST_REJECTED',
        targetType: 'ROLE_REQUEST',
        targetId: 'request-1',
        metadata: {},
      },
      select: {
        id: true,
        actor: { select: { login: true } },
        action: true,
        targetType: true,
        targetId: true,
        occurredAt: true,
      },
    });
  });
});
