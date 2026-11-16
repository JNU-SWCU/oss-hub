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

describe('StaffInsightsRepository program scorecard reads', () => {
  function recordedSql(queryRaw: jest.Mock): Prisma.Sql {
    const call = (queryRaw.mock.calls as readonly (readonly unknown[])[])[0];
    const strings = call?.[0];
    if (call === undefined || !Array.isArray(strings)) {
      throw new Error('Scorecard query was not recorded');
    }
    return Prisma.sql(strings, ...(call.slice(1) as Prisma.Sql[]));
  }

  it('folds non-archived published team statuses into applied and approved counts', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      { programId: 'program-a', status: 'SUBMITTED', _count: { _all: 3 } },
      { programId: 'program-a', status: 'APPROVED', _count: { _all: 2 } },
      { programId: 'program-a', status: 'REJECTED', _count: { _all: 1 } },
      { programId: 'program-b', status: 'SUBMITTED', _count: { _all: 4 } },
    ]);
    const repository = new StaffInsightsRepository({
      team: { groupBy },
    } as unknown as PrismaService);

    const rows = await repository.listProgramApplicationCounts();

    expect(groupBy).toHaveBeenCalledWith({
      by: ['programId', 'status'],
      where: { archivedAt: null, program: { lifecycle: 'PUBLISHED' } },
      _count: { _all: true },
    });
    expect(rows).toEqual([
      { programId: 'program-a', appliedCount: 6, approvedCount: 2 },
      { programId: 'program-b', appliedCount: 4, approvedCount: 0 },
    ]);
  });

  it('counts only due required pairs and skips rejected submissions', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const repository = new StaffInsightsRepository({
      $queryRaw: queryRaw,
    } as unknown as PrismaService);
    const now = new Date('2026-11-16T00:00:00.000Z');

    await repository.listProgramCompletion(now);

    const query = recordedSql(queryRaw);
    expect(query.values).toEqual([now.toISOString()]);
    expect(query.sql).toContain('requirement.required = true');
    expect(query.sql).toContain('milestone."dueAt" <=');
    expect(query.sql).toContain("submission.status <> 'REJECTED'");
    expect(query.sql).toContain("team.status = 'APPROVED'");
  });

  it('reads outcome events inside the program and team repo windows without releases', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const repository = new StaffInsightsRepository({
      $queryRaw: queryRaw,
    } as unknown as PrismaService);
    const now = new Date('2026-11-16T00:00:00.000Z');

    await repository.listProgramOutcomes(now);

    const query = recordedSql(queryRaw);
    expect(query.values).toEqual([now.toISOString()]);
    expect(query.sql).toContain('event.occurred_at < linked.window_end');
    expect(query.sql).toContain('event.occurred_at >= linked.valid_from');
    expect(query.sql).not.toContain("'release'");
  });
});
