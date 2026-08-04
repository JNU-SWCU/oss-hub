import type { PrismaService } from '../prisma/prisma.service';
import type {
  AdminAccessLoginHistoryPage,
  AdminAccessRoleRequestHistoryPage,
} from './domain/admin-access';

type HistoryPage = { readonly page: number; readonly limit: number };

export async function listAdminAccessRoleRequestHistory(
  prisma: Pick<PrismaService, 'roleRequest'>,
  userId: string,
  page: HistoryPage,
): Promise<AdminAccessRoleRequestHistoryPage> {
  const where = { userId };
  const [requests, total] = await Promise.all([
    prisma.roleRequest.findMany({
      where,
      select: {
        id: true,
        status: true,
        rejectionReason: true,
        decidedAt: true,
        decidedBy: { select: { nickname: true } },
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page.page - 1) * page.limit,
      take: page.limit,
    }),
    prisma.roleRequest.count({ where }),
  ]);
  return {
    items: requests.map((request) => ({
      id: request.id,
      status: request.status,
      rejectionReason: request.rejectionReason,
      decidedAt: request.decidedAt,
      decidedBy: request.decidedBy?.nickname ?? null,
      createdAt: request.createdAt,
    })),
    page: page.page,
    limit: page.limit,
    total,
  };
}

export async function listAdminAccessLoginHistory(
  prisma: Pick<PrismaService, 'loginHistory'>,
  userId: string,
  page: HistoryPage,
): Promise<AdminAccessLoginHistoryPage> {
  const where = { userId, provider: 'github' };
  const [logins, total] = await Promise.all([
    prisma.loginHistory.findMany({
      where,
      select: {
        id: true,
        event: true,
        success: true,
        loginAt: true,
      },
      orderBy: [{ loginAt: 'desc' }, { id: 'desc' }],
      skip: (page.page - 1) * page.limit,
      take: page.limit,
    }),
    prisma.loginHistory.count({ where }),
  ]);
  return {
    items: logins.map((login) => ({
      id: login.id,
      event: login.event,
      provider: 'github',
      success: login.success,
      loginAt: login.loginAt,
    })),
    page: page.page,
    limit: page.limit,
    total,
  };
}
