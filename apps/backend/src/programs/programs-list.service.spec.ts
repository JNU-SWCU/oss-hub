import { PrismaService } from '../prisma/prisma.service';
import { ProgramsRepository } from './programs.repository';
import { ProgramsService } from './programs.service';

describe('ProgramsRepository list', () => {
  const findMany = jest.fn();
  const count = jest.fn();
  const transaction = jest.fn();
  const prisma = {
    $transaction: transaction,
    program: { count, findMany },
  } as unknown as PrismaService;
  const repository = new ProgramsRepository(prisma);

  beforeEach(() => {
    findMany.mockReset();
    count.mockReset();
    transaction.mockReset();
  });

  it('applies search and recruiting filters before the page boundary', async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);
    transaction.mockResolvedValue([[], 0]);
    const now = new Date('2026-07-22T00:00:00.000Z');

    await repository.listPrograms(
      { page: 2, pageSize: 10, search: 'contest', status: 'recruiting' },
      now,
    );

    const where = {
      applicationStartAt: { lte: now },
      applicationEndAt: { gte: now },
      name: { contains: 'contest', mode: 'insensitive' },
    };
    expect(findMany).toHaveBeenCalledWith({
      orderBy: [{ applicationStartAt: 'desc' }, { name: 'asc' }, { id: 'asc' }],
      skip: 10,
      take: 10,
      where,
      select: {
        id: true,
        name: true,
        organizer: true,
        category: true,
        applicationStartAt: true,
        applicationEndAt: true,
        description: true,
      },
    });
    expect(count).toHaveBeenCalledWith({ where });
  });

  it('uses the same closed filter for count and page rows', async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(21);
    transaction.mockResolvedValue([[], 21]);
    const now = new Date('2026-07-22T00:00:00.000Z');

    await repository.listPrograms(
      { page: 1, pageSize: 20, search: '', status: 'closed' },
      now,
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { applicationEndAt: { lt: now } } }),
    );
    expect(count).toHaveBeenCalledWith({
      where: { applicationEndAt: { lt: now } },
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
