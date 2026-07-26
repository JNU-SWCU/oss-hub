import 'reflect-metadata';
import { ProgramCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PublicProfileService } from './public-profile.service';

const contributorRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'contributor-1',
  userId: 'user-1',
  githubNickname: 'synthetic-user',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1',
  repositoryId: 'repository-1',
  repository: {
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
    githubRepositoryId: BigInt(1),
    programEndAt: new Date('2026-12-31T00:00:00.000Z'),
    projectedAt: new Date('2026-07-25T00:00:00.000Z'),
  },
  ...overrides,
});

function harness() {
  const publicShowcaseContributor = { findMany: jest.fn() };
  const prisma = { publicShowcaseContributor } as unknown as PrismaService;
  return {
    publicShowcaseContributor,
    service: new PublicProfileService(prisma),
  };
}

describe('PublicProfileService', () => {
  it('maps ordered projection contributors and repositories without private fields', async () => {
    const { publicShowcaseContributor, service } = harness();
    publicShowcaseContributor.findMany.mockResolvedValue([
      contributorRow({
        repository: {
          ...contributorRow().repository,
          repositoryId: 'repository-2',
          repositoryName: 'Synthetic Team Repository',
          repositoryUrl: 'https://github.com/JNU-SWCU/synthetic-team',
          teamName: 'Synthetic Team',
          displayName: 'Synthetic Team',
        },
        repositoryId: 'repository-2',
      }),
      contributorRow(),
    ]);

    const response = await service.findPublicProfile('user-1');

    expect(response).toEqual({
      userId: 'user-1',
      githubNickname: 'synthetic-user',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
      repositories: [
        {
          repositoryId: 'repository-2',
          programId: 'program-1',
          programName: 'Synthetic Program',
          category: ProgramCategory.BASIC,
          applicationMode: 'TEAM',
          displayName: 'Synthetic Team',
          repositoryName: 'Synthetic Team Repository',
          githubUrl: 'https://github.com/JNU-SWCU/synthetic-team',
          publishedAt: '2026-07-25T00:00:00.000Z',
          detailUrl: '/archive/repository-2',
        },
        {
          repositoryId: 'repository-1',
          programId: 'program-1',
          programName: 'Synthetic Program',
          category: ProgramCategory.BASIC,
          applicationMode: 'PERSONAL',
          displayName: 'synthetic-user',
          repositoryName: 'Synthetic Repository',
          githubUrl: 'https://github.com/JNU-SWCU/synthetic',
          publishedAt: '2026-07-25T00:00:00.000Z',
          detailUrl: '/archive/repository-1',
        },
      ],
    });
    expect(publicShowcaseContributor.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      include: { repository: true },
      orderBy: [
        { repository: { publishedAt: 'desc' } },
        { repositoryId: 'asc' },
      ],
    });
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain('studentId');
    expect(serialized).not.toContain('department');
    expect(serialized).not.toContain('phone');
    expect(serialized).not.toContain('email');
    expect(serialized).not.toContain('activeProgram');
    expect(serialized).not.toContain('"name"');
  });

  it('returns the same public 404 for unknown users and users with no public contributions', async () => {
    const { publicShowcaseContributor, service } = harness();
    publicShowcaseContributor.findMany.mockResolvedValueOnce([]);
    publicShowcaseContributor.findMany.mockResolvedValueOnce([]);

    const unknown = await service
      .findPublicProfile('unknown-user')
      .catch((error: unknown) => error);
    const noPublicContributions = await service
      .findPublicProfile('private-user')
      .catch((error: unknown) => error);

    expect(unknown).toMatchObject({
      errorCode: {
        code: 'PRF_001',
        status: 404,
        message: '공개 프로필을 찾을 수 없습니다.',
      },
    });
    expect(noPublicContributions).toMatchObject({
      errorCode: {
        code: 'PRF_001',
        status: 404,
        message: '공개 프로필을 찾을 수 없습니다.',
      },
    });
    expect(publicShowcaseContributor.findMany.mock.calls).toEqual([
      [
        {
          where: { userId: 'unknown-user' },
          include: { repository: true },
          orderBy: [
            { repository: { publishedAt: 'desc' } },
            { repositoryId: 'asc' },
          ],
        },
      ],
      [
        {
          where: { userId: 'private-user' },
          include: { repository: true },
          orderBy: [
            { repository: { publishedAt: 'desc' } },
            { repositoryId: 'asc' },
          ],
        },
      ],
    ]);
  });
});
