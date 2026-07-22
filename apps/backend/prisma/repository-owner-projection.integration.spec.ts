import { PrismaClient } from '@prisma/client';

import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = 'test:197:';
const PROGRAM_ID = `${TEST_PREFIX}program`;
const APPLICATION_ID = `${TEST_PREFIX}application`;
const REPOSITORY_ID = `${TEST_PREFIX}repository`;
const FIRST_USER_ID = `${TEST_PREFIX}owner:first`;
const SECOND_USER_ID = `${TEST_PREFIX}owner:second`;
const FIRST_GITHUB_ID = 9_197_000_001n;
const SECOND_GITHUB_ID = 9_197_000_002n;
const FIRST_REPOSITORY_ID = 9_197_100_001n;
const SECOND_REPOSITORY_ID = 9_197_100_002n;

const prisma = new PrismaClient();

async function cleanFixtures(): Promise<void> {
  await prisma.repository.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
  await prisma.application.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
  await prisma.program.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
}

async function createFixtures(): Promise<void> {
  await prisma.user.createMany({
    data: [
      {
        id: FIRST_USER_ID,
        githubId: FIRST_GITHUB_ID,
        login: 'synthetic-owner-first',
      },
      {
        id: SECOND_USER_ID,
        githubId: SECOND_GITHUB_ID,
        login: 'synthetic-owner-second',
      },
    ],
  });
  await prisma.program.create({
    data: {
      id: PROGRAM_ID,
      name: 'Synthetic projection program',
      organizer: 'Synthetic organizer',
      category: 'BASIC',
      applicationTemplateKey: 'basic',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-07-01T00:00:00Z'),
      applicationEndAt: new Date('2026-07-31T00:00:00Z'),
      description: 'Synthetic repository owner projection fixture',
    },
  });
  await prisma.application.create({
    data: {
      id: APPLICATION_ID,
      programId: PROGRAM_ID,
      applicantId: FIRST_USER_ID,
      answers: { synthetic: true },
      applicationTemplateVersion: 1,
    },
  });
}

describe('RepositoryOwnerProjection integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(async () => {
    await cleanFixtures();
    await createFixtures();
  });

  afterEach(cleanFixtures);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('projects a newly connected repository to its applicant once', async () => {
    await prisma.repository.create({
      data: {
        id: REPOSITORY_ID,
        applicationId: APPLICATION_ID,
        programId: PROGRAM_ID,
        githubRepositoryId: FIRST_REPOSITORY_ID,
        name: 'synthetic-owner-repository',
        url: 'https://example.invalid/synthetic-owner-repository',
      },
    });

    await expect(
      prisma.repositoryOwnerProjection.findUniqueOrThrow({
        where: { githubRepositoryId: FIRST_REPOSITORY_ID },
      }),
    ).resolves.toMatchObject({
      ownerGithubId: FIRST_GITHUB_ID,
      ownerGithubLogin: 'synthetic-owner-first',
    });
    await expect(
      prisma.repositoryOwnerProjection.count({
        where: { githubRepositoryId: FIRST_REPOSITORY_ID },
      }),
    ).resolves.toBe(1);
  });

  it('keeps login and applicant identity changes synchronized', async () => {
    await prisma.repository.create({
      data: {
        id: REPOSITORY_ID,
        applicationId: APPLICATION_ID,
        programId: PROGRAM_ID,
        githubRepositoryId: FIRST_REPOSITORY_ID,
        name: 'synthetic-owner-repository',
        url: 'https://example.invalid/synthetic-owner-repository',
      },
    });

    await prisma.user.update({
      where: { id: FIRST_USER_ID },
      data: { login: 'synthetic-owner-renamed' },
    });
    await expect(
      prisma.repositoryOwnerProjection.findUniqueOrThrow({
        where: { githubRepositoryId: FIRST_REPOSITORY_ID },
      }),
    ).resolves.toMatchObject({
      ownerGithubId: FIRST_GITHUB_ID,
      ownerGithubLogin: 'synthetic-owner-renamed',
    });

    await prisma.application.update({
      where: { id: APPLICATION_ID },
      data: { applicantId: SECOND_USER_ID },
    });
    await expect(
      prisma.repositoryOwnerProjection.findUniqueOrThrow({
        where: { githubRepositoryId: FIRST_REPOSITORY_ID },
      }),
    ).resolves.toMatchObject({
      ownerGithubId: SECOND_GITHUB_ID,
      ownerGithubLogin: 'synthetic-owner-second',
    });
  });

  it('moves and removes the projection with repository identity lifecycle', async () => {
    await prisma.repository.create({
      data: {
        id: REPOSITORY_ID,
        applicationId: APPLICATION_ID,
        programId: PROGRAM_ID,
        githubRepositoryId: FIRST_REPOSITORY_ID,
        name: 'synthetic-owner-repository',
        url: 'https://example.invalid/synthetic-owner-repository',
      },
    });

    await prisma.repository.update({
      where: { id: REPOSITORY_ID },
      data: { githubRepositoryId: SECOND_REPOSITORY_ID },
    });
    await expect(
      prisma.repositoryOwnerProjection.findUnique({
        where: { githubRepositoryId: FIRST_REPOSITORY_ID },
      }),
    ).resolves.toBeNull();
    await expect(
      prisma.repositoryOwnerProjection.findUnique({
        where: { githubRepositoryId: SECOND_REPOSITORY_ID },
      }),
    ).resolves.toMatchObject({ ownerGithubId: FIRST_GITHUB_ID });

    await prisma.repository.delete({ where: { id: REPOSITORY_ID } });
    await expect(
      prisma.repositoryOwnerProjection.findUnique({
        where: { githubRepositoryId: SECOND_REPOSITORY_ID },
      }),
    ).resolves.toBeNull();
  });
});
