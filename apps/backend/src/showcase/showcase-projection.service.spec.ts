import {
  ApplicationStatus,
  ProgramCategory,
  RepositoryVisibility,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ShowcaseProjectionRepository } from './showcase-projection.repository';
import { ShowcaseProjectionService } from './showcase-projection.service';

const NOW = new Date('2026-07-26T00:00:00.000Z');

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'repository-1',
    applicationId: 'application-1',
    githubRepositoryId: 42n,
    name: 'repository-1',
    url: 'https://github.com/JNU-SWCU/repository-1',
    visibility: RepositoryVisibility.PUBLIC,
    publishedAt: new Date('2026-07-01T00:00:00.000Z'),
    programId: 'program-1',
    program: {
      name: 'Synthetic program',
      category: ProgramCategory.BASIC,
      endAt: new Date('2026-07-25T00:00:00.000Z'),
    },
    application: {
      status: ApplicationStatus.APPROVED,
      programId: 'program-1',
      teamId: null,
      applicant: {
        id: 'applicant',
        nickname: 'applicant-login',
        avatarUrl: null,
      },
    },
    team: null,
    ...overrides,
  };
}

function harness(row: ReturnType<typeof fixture> | null) {
  const transaction = {
    publicShowcaseRepository: {
      upsert: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    publicShowcaseContributor: { deleteMany: jest.fn(), createMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((callback: (value: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  } as unknown as PrismaService;
  const repository = {
    findRepositoryForProjection: jest.fn().mockResolvedValue(row),
    countApprovedSubmissions: jest.fn().mockResolvedValue(3),
    listPublicRepositoryIds: jest.fn().mockResolvedValue(['repository-1']),
  } as unknown as jest.Mocked<ShowcaseProjectionRepository>;
  return {
    service: new ShowcaseProjectionService(prisma, repository),
    repository,
    transaction,
  };
}

describe('ShowcaseProjectionService', () => {
  it.each([
    ['private', { visibility: RepositoryVisibility.PRIVATE }],
    [
      'unapproved',
      {
        application: {
          ...fixture().application,
          status: ApplicationStatus.SUBMITTED,
        },
      },
    ],
    ['not ended', { program: { ...fixture().program, endAt: null } }],
    [
      'future end',
      {
        program: {
          ...fixture().program,
          endAt: new Date('2026-07-27T00:00:00.000Z'),
        },
      },
    ],
    ['unpublished', { publishedAt: null }],
    ['non-canonical URL', { url: 'https://github.com/other/repository-1' }],
  ])('revokes %s repositories', async (_label, overrides) => {
    const { service, transaction } = harness(fixture(overrides));

    await expect(service.projectRepository('repository-1', NOW)).resolves.toBe(
      'revoked',
    );
    expect(
      transaction.publicShowcaseRepository.deleteMany,
    ).toHaveBeenCalledWith({
      where: { repositoryId: 'repository-1' },
    });
    expect(transaction.publicShowcaseRepository.upsert).not.toHaveBeenCalled();
  });

  it('projects personal repositories with only allowlisted identity fields', async () => {
    const { service, transaction } = harness(fixture());

    await service.projectRepository('repository-1', NOW);

    expect(transaction.publicShowcaseRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          repositoryId: 'repository-1',
          repositoryName: 'repository-1',
          programName: 'Synthetic program',
          approvedSubmissionCount: 3,
          displayName: 'applicant-login',
        }) as Record<string, unknown>,
      }),
    );
    expect(
      transaction.publicShowcaseContributor.createMany,
    ).toHaveBeenCalledWith({
      data: [
        {
          repositoryId: 'repository-1',
          userId: 'applicant',
          githubNickname: 'applicant-login',
          avatarUrl: null,
        },
      ],
    });
  });

  it('deduplicates team leader and members while replacing stale contributors', async () => {
    const team = {
      name: 'Synthetic team',
      leader: {
        id: 'leader',
        nickname: 'leader-login',
        avatarUrl: 'https://avatar/leader',
      },
      members: [
        {
          user: {
            id: 'leader',
            nickname: 'leader-login',
            avatarUrl: 'https://avatar/leader',
          },
        },
        { user: { id: 'member', nickname: 'member-login', avatarUrl: null } },
      ],
    };
    const { service, transaction } = harness(
      fixture({
        application: { ...fixture().application, teamId: 'team-1' },
        team: { id: 'team-1', ...team },
      }),
    );

    await service.projectRepository('repository-1', NOW);

    expect(
      transaction.publicShowcaseContributor.deleteMany,
    ).toHaveBeenCalledWith({
      where: { repositoryId: 'repository-1' },
    });
    expect(
      transaction.publicShowcaseContributor.createMany,
    ).toHaveBeenCalledWith({
      data: [
        {
          repositoryId: 'repository-1',
          userId: 'leader',
          githubNickname: 'leader-login',
          avatarUrl: 'https://avatar/leader',
        },
        {
          repositoryId: 'repository-1',
          userId: 'member',
          githubNickname: 'member-login',
          avatarUrl: null,
        },
      ],
    });
  });
});
