import { ActivityVisibility, Prisma } from '@prisma/client';
import type { PrismaService } from '../platform/prisma.service';
import { STUDENT_MEMBER_WHERE } from '../platform/user-profile-read.config';
import { StaffInsightsRepository } from './staff-insights.repository';

describe('StaffInsightsRepository standing read', () => {
  it('lists active students and reads public standing for the year', async () => {
    const userFindMany = jest.fn().mockResolvedValue([]);
    const queryRaw = jest.fn().mockResolvedValue([]);
    const repository = new StaffInsightsRepository({
      user: { findMany: userFindMany },
      $queryRaw: queryRaw,
    } as unknown as PrismaService);

    await repository.listStudents();
    await repository.listActivityTotals({ currentYear: 2026 });

    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ...STUDENT_MEMBER_WHERE, accountStatus: 'ACTIVE' },
      }),
    );
    const call =
      (queryRaw.mock.calls as readonly (readonly unknown[])[])[0] ?? [];
    const strings = call[0];
    if (!Array.isArray(strings)) {
      throw new Error('Standing query was not recorded');
    }
    const query = Prisma.sql(strings, ...(call.slice(1) as Prisma.Sql[]));
    expect(query.values).toEqual(
      expect.arrayContaining([2026, ActivityVisibility.PUBLIC]),
    );
    const sql = query.sql;
    expect(sql).toContain('DISTINCT ON');
    expect(sql).toContain('github_user_activity_history');
  });
});
