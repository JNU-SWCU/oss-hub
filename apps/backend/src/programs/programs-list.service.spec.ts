import { PrismaService } from '../prisma/prisma.service';
import { ProgramsService } from './programs.service';

describe('ProgramsService list', () => {
  const findMany = jest.fn();
  const count = jest.fn();
  const transaction = jest.fn();
  const prisma = {
    $transaction: transaction,
    program: { count, findMany },
  } as unknown as PrismaService;
  const service = new ProgramsService(prisma);

  beforeEach(() => {
    findMany.mockReset();
    count.mockReset();
    transaction.mockReset();
  });

  it('applies search and recruiting filters before the page boundary', async () => {
    // Given
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);
    transaction.mockResolvedValue([[], 0]);
    const now = new Date('2026-07-22T00:00:00.000Z');

    // When
    const page = await service.list(
      { page: 2, pageSize: 10, search: 'contest', status: 'recruiting' },
      now,
    );

    // Then
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
    expect(page).toEqual({
      items: [],
      page: 2,
      pageSize: 10,
      totalItems: 0,
      totalPages: 0,
    });
  });

  it('uses the same closed filter for count and page rows', async () => {
    // Given
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(21);
    transaction.mockResolvedValue([[], 21]);
    const now = new Date('2026-07-22T00:00:00.000Z');

    // When
    const page = await service.list(
      { page: 1, pageSize: 20, search: '', status: 'closed' },
      now,
    );

    // Then
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { applicationEndAt: { lt: now } } }),
    );
    expect(count).toHaveBeenCalledWith({
      where: { applicationEndAt: { lt: now } },
    });
    expect(page.totalPages).toBe(2);
  });
});
