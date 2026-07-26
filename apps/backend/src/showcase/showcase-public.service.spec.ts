import 'reflect-metadata';
import { ProgramCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  PublicArchiveApplicationMode,
  PublicArchiveQueryRequestDto,
} from './dto/public-archive-response.dto';
import { ShowcasePublicService } from './showcase-public.service';

const row = (overrides: Record<string, unknown> = {}) => ({
  repositoryId: 'repository-1',
  repositoryName: 'Synthetic Repository',
  repositoryUrl: 'https://github.com/JNU-SWCU/synthetic',
  publishedAt: new Date('2026-07-25T00:00:00.000Z'),
  programId: 'program-1',
  programName: 'Synthetic Program',
  programCategory: ProgramCategory.BASIC,
  teamName: null,
  displayName: 'synthetic-user',
  approvedSubmissionCount: 3,
  ...overrides,
});

function harness() {
  const publicShowcaseRepository = {
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
  };
  const prisma = {
    publicShowcaseRepository,
  } as unknown as PrismaService;
  return {
    publicShowcaseRepository,
    service: new ShowcasePublicService(prisma),
  };
}

describe('ShowcasePublicService', () => {
  it('searches and filters only projection rows with stable pagination order', async () => {
    const { publicShowcaseRepository, service } = harness();
    const query = Object.assign(new PublicArchiveQueryRequestDto(), {
      q: ' Synthetic ',
      category: ProgramCategory.BASIC,
      applicationMode: PublicArchiveApplicationMode.PERSONAL,
      page: 2,
      pageSize: 10,
    });
    publicShowcaseRepository.findMany.mockResolvedValue([row()]);
    publicShowcaseRepository.count.mockResolvedValue(11);

    await expect(service.findPage(query)).resolves.toEqual({
      items: [
        {
          repositoryId: 'repository-1',
          programId: 'program-1',
          programName: 'Synthetic Program',
          category: ProgramCategory.BASIC,
          applicationMode: PublicArchiveApplicationMode.PERSONAL,
          displayName: 'synthetic-user',
          githubUrl: 'https://github.com/JNU-SWCU/synthetic',
          publishedAt: '2026-07-25T00:00:00.000Z',
          detailUrl: '/archive/repository-1',
        },
      ],
      page: 2,
      pageSize: 10,
      total: 11,
    });
    expect(publicShowcaseRepository.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { programName: { contains: 'Synthetic', mode: 'insensitive' } },
          { displayName: { contains: 'Synthetic', mode: 'insensitive' } },
          { repositoryName: { contains: 'Synthetic', mode: 'insensitive' } },
        ],
        programCategory: ProgramCategory.BASIC,
        teamName: null,
      },
      orderBy: [{ publishedAt: 'desc' }, { repositoryId: 'asc' }],
      skip: 10,
      take: 10,
    });
    expect(publicShowcaseRepository.count).toHaveBeenCalledWith({
      where: expect.any(Object) as Record<string, unknown>,
    });
  });

  it('maps team detail and contributors from projection data only', async () => {
    const { publicShowcaseRepository, service } = harness();
    publicShowcaseRepository.findUnique.mockResolvedValue({
      ...row({ teamName: 'Synthetic Team', displayName: 'Synthetic Team' }),
      contributors: [
        {
          userId: 'user-1',
          githubNickname: 'synthetic-user',
          avatarUrl: null,
        },
      ],
    });

    await expect(service.findDetail('repository-1')).resolves.toEqual({
      repositoryId: 'repository-1',
      programId: 'program-1',
      programName: 'Synthetic Program',
      category: ProgramCategory.BASIC,
      applicationMode: PublicArchiveApplicationMode.TEAM,
      displayName: 'Synthetic Team',
      repositoryName: 'Synthetic Repository',
      githubUrl: 'https://github.com/JNU-SWCU/synthetic',
      publishedAt: '2026-07-25T00:00:00.000Z',
      approvedSubmissionCount: 3,
      contributors: [
        {
          userId: 'user-1',
          githubNickname: 'synthetic-user',
          avatarUrl: null,
        },
      ],
    });
    expect(publicShowcaseRepository.findUnique).toHaveBeenCalledWith({
      where: { repositoryId: 'repository-1' },
      include: {
        contributors: {
          select: { userId: true, githubNickname: true, avatarUrl: true },
          orderBy: { userId: 'asc' },
        },
      },
    });
  });

  it('makes private and nonexistent repository IDs the same public 404', async () => {
    const { publicShowcaseRepository, service } = harness();
    publicShowcaseRepository.findUnique.mockResolvedValue(null);

    await expect(
      service.findDetail('private-repository'),
    ).rejects.toMatchObject({
      errorCode: {
        code: 'SHW_001',
        status: 404,
        message: expect.any(String) as string,
      },
    });
  });
});
