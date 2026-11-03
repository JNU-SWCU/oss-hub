import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../platform/prisma.service';

@Injectable()
export class AdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  async lockActiveRows(transaction: Prisma.TransactionClient): Promise<number> {
    await transaction.$queryRaw(Prisma.sql`
      SELECT u."id" FROM "User" u
      INNER JOIN "Admin" a ON a."userId" = u."id"
      ORDER BY u."id" FOR UPDATE OF u, a
    `);
    return transaction.admin.count({
      where: { user: { accountStatus: 'ACTIVE' } },
    });
  }

  async setAuthority(
    transaction: Prisma.TransactionClient,
    input: {
      readonly userId: string;
      readonly actorId: string;
      readonly enabled: boolean;
    },
  ): Promise<void> {
    if (input.enabled) {
      await transaction.admin.create({
        data: {
          userId: input.userId,
          grantedById: input.actorId,
          origin: 'ADMIN',
        },
      });
    } else {
      await transaction.admin.delete({ where: { userId: input.userId } });
    }
  }

  bootstrap(input: {
    readonly githubId: bigint;
    readonly operatorReceipt: string;
  }) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw(
        Prisma.sql`LOCK TABLE "Admin" IN SHARE ROW EXCLUSIVE MODE`,
      );
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "User" ORDER BY "id" FOR UPDATE`,
      );
      const [admins, history] = await Promise.all([
        transaction.admin.count(),
        transaction.adminHistory.count(),
      ]);
      if (admins !== 0 || history !== 0) {
        throw new Error(
          'Bootstrap requires no administrator or administrator history; use an authorized recovery procedure.',
        );
      }
      const user = await transaction.user.findUniqueOrThrow({
        where: { githubId: input.githubId },
        select: { id: true, accountStatus: true },
      });
      if (user.accountStatus !== 'ACTIVE')
        throw new Error('Bootstrap requires an active account.');
      const now = new Date();
      await transaction.admin.create({
        data: { userId: user.id, origin: 'BOOTSTRAP', grantedAt: now },
      });
      const historyId = `admin:${randomUUID()}`;
      await transaction.adminHistory.create({
        data: {
          id: historyId,
          userId: user.id,
          event: 'GRANTED',
          source: 'BOOTSTRAP',
          occurredAt: now,
          data: {
            schemaVersion: 1,
            recordKind: 'BOOTSTRAP',
            operatorReceipt: input.operatorReceipt,
          },
        },
      });
      return { userId: user.id, historyId, grantedAt: now.toISOString() };
    });
  }
}
