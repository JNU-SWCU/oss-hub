import { Prisma, ProgramLifecycle } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PROGRAM_LIST_QUERY_STATUSES } from './program-list-query';
import {
  programListPrismaWhere,
  programListSqlStatusPredicate,
} from './program-list-status-filter';
import { ProgramsRepository } from './programs.repository';
import type { ProgramListRecord } from './programs.repository';
import { ProgramsService } from './programs.service';

describe('ProgramsRepository list', () => {
  const count = jest.fn();
  const transaction = jest.fn();
  const queryRaw = jest.fn<
    Promise<readonly ProgramListRecord[]>,
    [Prisma.Sql]
  >();
  const prisma = {
    $transaction: transaction,
    $queryRaw: queryRaw,
    program: { count },
  } as unknown as PrismaService;
  const repository = new ProgramsRepository(prisma);

  beforeEach(() => {
    count.mockReset();
    transaction.mockReset();
    queryRaw.mockReset();
  });

  it('applies search and recruiting filters before the page boundary', async () => {
    queryRaw.mockResolvedValue([]);
    count.mockResolvedValue(0);
    transaction.mockResolvedValue([[], 0]);
    const now = new Date('2026-07-22T00:00:00.000Z');

    await repository.listPrograms(
      { page: 2, pageSize: 10, search: 'contest', status: 'recruiting' },
      now,
    );

    const where = {
      lifecycle: ProgramLifecycle.PUBLISHED,
      applicationStartAt: { lte: now },
      applicationEndAt: { gte: now },
      name: { contains: 'contest', mode: 'insensitive' },
    };
    const rawQuery = queryRaw.mock.calls[0]?.[0];
    expect(rawQuery?.strings.join(' ')).toContain('p."applicationEndAt"');
    expect(rawQuery?.values).toContain(now);
    expect(rawQuery?.values).toContain('%contest%');
    expect(rawQuery?.values).toContain(10);
    expect(count).toHaveBeenCalledWith({ where });
  });

  it('orders deadline priority in the database before pagination', async () => {
    queryRaw.mockResolvedValue([]);
    count.mockResolvedValue(21);
    transaction.mockResolvedValue([[], 21]);

    await repository.listPrograms(
      { page: 1, pageSize: 20, search: '', status: 'all' },
      new Date('2026-08-01T00:00:00.000Z'),
    );

    const rawQuery = queryRaw.mock.calls[0]?.[0];
    const sql = rawQuery?.strings.join(' ') ?? '';
    expect(sql).toContain('ORDER BY');
    expect(sql).toContain('p."applicationEndAt" ASC');
    expect(rawQuery?.values).toContain(20);
    expect(rawQuery?.values).toContain(0);
  });

  it('uses the same in_progress filter for count and page rows', async () => {
    queryRaw.mockResolvedValue([]);
    count.mockResolvedValue(21);
    transaction.mockResolvedValue([[], 21]);
    const now = new Date('2026-07-22T00:00:00.000Z');

    await repository.listPrograms(
      { page: 1, pageSize: 20, search: '', status: 'in_progress' },
      now,
    );

    const rawQuery = queryRaw.mock.calls[0]?.[0];
    expect(rawQuery?.values).toContain(now);
    expect(count).toHaveBeenCalledWith({
      where: {
        lifecycle: ProgramLifecycle.PUBLISHED,
        applicationEndAt: { lt: now },
        OR: [{ endAt: null }, { endAt: { gte: now } }],
      },
    });
  });

  it('uses the same upcoming filter for count and page rows', async () => {
    queryRaw.mockResolvedValue([]);
    count.mockResolvedValue(3);
    transaction.mockResolvedValue([[], 3]);
    const now = new Date('2026-07-22T00:00:00.000Z');

    await repository.listPrograms(
      { page: 1, pageSize: 20, search: '', status: 'upcoming' },
      now,
    );

    expect(count).toHaveBeenCalledWith({
      where: {
        lifecycle: ProgramLifecycle.PUBLISHED,
        applicationStartAt: { gt: now },
      },
    });
  });

  it('uses the same ended filter for count and page rows', async () => {
    queryRaw.mockResolvedValue([]);
    count.mockResolvedValue(9);
    transaction.mockResolvedValue([[], 9]);
    const now = new Date('2026-07-22T00:00:00.000Z');

    await repository.listPrograms(
      { page: 1, pageSize: 20, search: '', status: 'ended' },
      now,
    );

    expect(count).toHaveBeenCalledWith({
      where: {
        OR: [
          { lifecycle: ProgramLifecycle.ARCHIVED },
          {
            lifecycle: ProgramLifecycle.PUBLISHED,
            endAt: { not: null, lt: now },
          },
        ],
      },
    });
  });
});

describe('ProgramsRepository countProgramsByStatus', () => {
  const queryRaw = jest.fn();
  const prisma = {
    $queryRaw: queryRaw,
  } as unknown as PrismaService;
  const repository = new ProgramsRepository(prisma);

  beforeEach(() => {
    queryRaw.mockReset();
  });

  it('returns all five status keys including zeros', async () => {
    queryRaw.mockResolvedValue([
      {
        all: 15,
        recruiting: 3,
        in_progress: 3,
        upcoming: 0,
        ended: 9,
      },
    ]);
    const now = new Date('2026-07-22T00:00:00.000Z');

    await expect(repository.countProgramsByStatus(now)).resolves.toEqual({
      all: 15,
      recruiting: 3,
      in_progress: 3,
      upcoming: 0,
      ended: 9,
    });

    const rawQuery = queryRaw.mock.calls[0]?.[0] as Prisma.Sql | undefined;
    const sql = rawQuery?.strings.join(' ') ?? '';
    expect(sql).toContain('COUNT(*) FILTER');
    expect(sql).toContain('FROM "Program"');
    expect(rawQuery?.values).toContain(now);
  });

  it('defaults missing row to zeros', async () => {
    queryRaw.mockResolvedValue([]);
    await expect(
      repository.countProgramsByStatus(new Date('2026-07-22T00:00:00.000Z')),
    ).resolves.toEqual({
      all: 0,
      recruiting: 0,
      in_progress: 0,
      upcoming: 0,
      ended: 0,
    });
  });
});

describe('status filter single source', () => {
  it('exposes the same predicate keys as list query statuses', () => {
    const now = new Date('2026-07-22T00:00:00.000Z');
    for (const status of PROGRAM_LIST_QUERY_STATUSES) {
      expect(programListPrismaWhere(status, now)).toBeDefined();
      const sql = programListSqlStatusPredicate(status, now);
      expect(sql.strings.join(' ')).toMatch(/lifecycle|ARCHIVED|PUBLISHED/);
    }
  });
});

describe('ProgramsService list', () => {
  it('returns page metadata from the repository count', async () => {
    const repository = {
      listPrograms: jest.fn().mockResolvedValue([[], 21]),
    };
    const service = new ProgramsService(
      repository as unknown as ProgramsRepository,
    );

    await expect(
      service.list({ page: 1, pageSize: 20, search: '', status: 'all' }),
    ).resolves.toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      totalItems: 21,
      totalPages: 2,
    });
  });

  it('returns status counts from the repository', async () => {
    const counts = {
      all: 10,
      recruiting: 2,
      in_progress: 4,
      upcoming: 1,
      ended: 3,
    };
    const repository = {
      countProgramsByStatus: jest.fn().mockResolvedValue(counts),
    };
    const service = new ProgramsService(
      repository as unknown as ProgramsRepository,
    );

    await expect(service.statusCounts()).resolves.toEqual(counts);
    expect(repository.countProgramsByStatus).toHaveBeenCalled();
  });
});

/**
 * status-counts 각 키의 Prisma where 는 목록 count where 와 동일해야 한다.
 * (raw FILTER 식은 programListSqlStatusPredicate 단일 원본을 쓴다.)
 */
describe('status-counts consistency with list totalItems filters', () => {
  it('maps every list status to the shared prisma where used by list count', () => {
    const now = new Date('2026-07-22T00:00:00.000Z');
    expect(programListPrismaWhere('all', now)).toEqual({
      lifecycle: ProgramLifecycle.PUBLISHED,
    });
    expect(programListPrismaWhere('recruiting', now)).toEqual({
      lifecycle: ProgramLifecycle.PUBLISHED,
      applicationStartAt: { lte: now },
      applicationEndAt: { gte: now },
    });
    expect(programListPrismaWhere('in_progress', now)).toEqual({
      lifecycle: ProgramLifecycle.PUBLISHED,
      applicationEndAt: { lt: now },
      OR: [{ endAt: null }, { endAt: { gte: now } }],
    });
    expect(programListPrismaWhere('upcoming', now)).toEqual({
      lifecycle: ProgramLifecycle.PUBLISHED,
      applicationStartAt: { gt: now },
    });
    expect(programListPrismaWhere('ended', now)).toEqual({
      OR: [
        { lifecycle: ProgramLifecycle.ARCHIVED },
        {
          lifecycle: ProgramLifecycle.PUBLISHED,
          endAt: { not: null, lt: now },
        },
      ],
    });
  });
});
