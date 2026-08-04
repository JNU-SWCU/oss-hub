import { Prisma, ProgramLifecycle } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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
});
