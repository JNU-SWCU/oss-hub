import { PrismaService } from '../prisma/prisma.service';
import { ProgramsService } from './programs.service';

describe('ProgramsService list', () => {
  const findMany = jest.fn();
  const prisma = { program: { findMany } } as unknown as PrismaService;
  const service = new ProgramsService(prisma);

  beforeEach(() => {
    findMany.mockReset();
  });

  it('returns public programs ordered by newest application year first', async () => {
    findMany.mockResolvedValue([]);

    await service.list();

    expect(findMany).toHaveBeenCalledWith({
      orderBy: [{ applicationStartAt: 'desc' }, { name: 'asc' }],
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
  });
});
