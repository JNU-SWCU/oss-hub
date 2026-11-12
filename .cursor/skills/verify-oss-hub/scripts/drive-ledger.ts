import {
  PrismaClient,
  ProgramCategory,
  RepositorySource,
} from '@prisma/client';
import type { CollectionAppConfigValues } from '../../../../apps/backend/src/github/collection-app.config';
import {
  CollectionAppClient,
  type CollectionCommit,
  type CollectionPullRequest,
  type RequestFingerprint,
} from '../../../../apps/backend/src/github/collection-app.client';
import type { CollectionAppTokenClient } from '../../../../apps/backend/src/github/collection-app-token.client';
import { CollectionIncrementalRepository } from '../../../../apps/backend/src/github/collection-incremental.repository';
import { CollectionSyncService } from '../../../../apps/backend/src/github/collection-sync.service';
import { ProviderRequestQueueClient } from '../../../../apps/backend/src/github/provider-request-queue.client';
import { RepositoryUrlService } from '../../../../apps/backend/src/github/repository-url.service';
import { PlatformRepository } from '../../../../apps/backend/src/platform/platform.repository';
import { PrismaService } from '../../../../apps/backend/src/platform/prisma.service';

const APP_ID = 981200000001n;
const GITHUB_REPOSITORY_ID = 981200100001n;
const MEMBER_GITHUB_ID = 981200200001n;
const ORG_LOGIN = 'verify-ledger-org';
const PROGRAM_ID = 'verify-ledger-program';
const TEAM_ID = 'verify-ledger-team';
const USER_ID = 'verify-ledger-user';
const REPOSITORY_ID = 'verify-ledger-repository';
const OWNER_ID = 'verify-ledger-owner';
const REPO_NAME = 'verify-ledger-repo';

function assertLocalVerificationDatabase(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (
    (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') ||
    (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') ||
    database !== 'oss_hub_verify'
  ) {
    throw new Error(
      'drive-ledger refuses this DATABASE_URL. It must be postgresql on 127.0.0.1 or localhost and the database oss_hub_verify.',
    );
  }
}

function fingerprint(endpoint: string): RequestFingerprint {
  return {
    endpoint,
    ref: null,
    query: 'state=all',
    order: null,
    pageSize: 100,
    accept: 'application/vnd.github+json',
    apiVersion: '2022-11-28',
  };
}

function repositoryPayload(): {
  id: string;
  name: string;
  fullName: string;
  private: boolean;
  archived: boolean;
  defaultBranch: string;
  ownerLogin: string;
  htmlUrl: string;
  updatedAt: string;
} {
  return {
    id: GITHUB_REPOSITORY_ID.toString(),
    name: REPO_NAME,
    fullName: `${ORG_LOGIN}/${REPO_NAME}`,
    private: false,
    archived: false,
    defaultBranch: 'main',
    ownerLogin: ORG_LOGIN,
    htmlUrl: `https://example.invalid/${ORG_LOGIN}/${REPO_NAME}`,
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

function syntheticClient(
  fingerprintKeys: CollectionAppClient,
  commit: CollectionCommit,
  pullRequest: CollectionPullRequest,
): CollectionAppClient {
  return {
    listInstallationRepositories: () => Promise.resolve([repositoryPayload()]),
    getRepository: () => Promise.resolve(repositoryPayload()),
    resolveUserNodeId: (login: string) => Promise.resolve(`node:${login}`),
    listDefaultBranchCommitsByAuthor: () => Promise.resolve([commit]),
    countDefaultBranchCommitsBetween: () => Promise.resolve(null),
    probeDefaultBranchHead: () =>
      Promise.resolve({
        changed: true,
        headSha: null,
        fingerprint: fingerprint('/repos/o/r/commits'),
        etag: null,
      }),
    listCommitsUntilKnownSha: () =>
      Promise.resolve({
        commits: [commit],
        disconnectedFullScan: true,
        fingerprint: fingerprint('/repos/o/r/commits'),
      }),
    listNewPullRequests: () =>
      Promise.resolve({
        pullRequests: [pullRequest],
        newFrontier: {
          createdAt: pullRequest.createdAt,
          id: pullRequest.id,
        },
        fingerprint: fingerprint('/repos/o/r/pulls'),
      }),
    probeLatestRelease: () =>
      Promise.resolve({
        changed: true,
        frontier: { probe: 'verify-ledger-release-probe' },
        fingerprint: fingerprint('/repos/o/r/releases'),
        etag: 'verify-ledger-release-etag',
      }),
    listChangedPublishedReleases: () =>
      Promise.resolve({
        releases: [],
        fingerprint: fingerprint('/repos/o/r/releases'),
      }),
    listNewIssues: () =>
      Promise.resolve({
        issues: [],
        newFrontier: null,
        fingerprint: fingerprint('/repos/o/r/issues'),
      }),
    requestFingerprintKey: (value: RequestFingerprint) =>
      fingerprintKeys.requestFingerprintKey(value),
  } as CollectionAppClient;
}

async function removePreviousRun(prisma: PrismaClient): Promise<void> {
  await prisma.contributionEvent.deleteMany({
    where: { repoId: GITHUB_REPOSITORY_ID },
  });
  await prisma.teamRepo.deleteMany({
    where: { repoId: GITHUB_REPOSITORY_ID },
  });
  await prisma.repo.deleteMany({
    where: { githubRepoId: GITHUB_REPOSITORY_ID },
  });
  await prisma.githubRepository.deleteMany({
    where: { githubRepositoryId: GITHUB_REPOSITORY_ID },
  });
  await prisma.collectionSyncCursor.deleteMany({ where: { appId: APP_ID } });
  await prisma.collectionSyncLease.deleteMany({ where: { appId: APP_ID } });
  await prisma.teamMember.deleteMany({ where: { teamId: TEAM_ID } });
  await prisma.team.deleteMany({ where: { id: TEAM_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.program.deleteMany({ where: { id: PROGRAM_ID } });
}

async function seedCollectorTarget(prisma: PrismaClient): Promise<void> {
  const startAt = new Date('2026-01-01T00:00:00.000Z');
  const endAt = new Date('2026-12-31T00:00:00.000Z');
  await prisma.program.create({
    data: {
      id: PROGRAM_ID,
      name: 'verify ledger program',
      organizer: 'synthetic',
      trackType: 'EXTRACURRICULAR',
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'synthetic',
      applicationTemplateVersion: 1,
      applicationStartAt: startAt,
      applicationEndAt: endAt,
      startAt,
      endAt,
      description: 'synthetic verification program',
    },
  });
  await prisma.user.create({
    data: {
      id: USER_ID,
      githubId: MEMBER_GITHUB_ID,
      nickname: 'verify-ledger-member',
    },
  });
  await prisma.team.create({
    data: {
      id: TEAM_ID,
      programId: PROGRAM_ID,
      name: 'verify ledger team',
      leaderId: USER_ID,
      applicantId: USER_ID,
      answers: { title: 'verify ledger team' },
      applicationTemplateVersion: 1,
    },
  });
  await prisma.teamMember.create({
    data: {
      teamId: TEAM_ID,
      programId: PROGRAM_ID,
      userId: USER_ID,
    },
  });
  await prisma.team.update({
    where: { id: TEAM_ID },
    data: { status: 'APPROVED' },
  });
  await prisma.githubRepository.create({
    data: {
      id: REPOSITORY_ID,
      teamId: TEAM_ID,
      githubRepositoryId: GITHUB_REPOSITORY_ID,
      nameWithOwner: `${ORG_LOGIN}/${REPO_NAME}`,
      defaultBranch: 'main',
      source: RepositorySource.ORG_PROVISIONED,
    },
  });
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL is required');
  }
  assertLocalVerificationDatabase(databaseUrl);

  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    await removePreviousRun(prisma);
    await seedCollectorTarget(prisma);

    const fingerprintKeys = new CollectionAppClient(
      {} as CollectionAppConfigValues,
      {
        getToken: () => Promise.resolve('synthetic-token'),
        clear: () => undefined,
      } as CollectionAppTokenClient,
    );
    const commit: CollectionCommit = {
      sha: 'verifyledgercommit0000000000000000000000000001',
      authorLogin: 'verify-ledger-member',
      authorGithubId: MEMBER_GITHUB_ID.toString(),
      committedAt: '2026-08-01T00:00:00.000Z',
      htmlUrl: `https://example.invalid/${ORG_LOGIN}/${REPO_NAME}/commit/verify-ledger`,
    };
    const pullRequest: CollectionPullRequest = {
      id: '981200300001',
      number: 1,
      state: 'open',
      draft: false,
      mergedAt: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      authorLogin: 'verify-ledger-member',
      authorGithubId: MEMBER_GITHUB_ID.toString(),
      htmlUrl: `https://example.invalid/${ORG_LOGIN}/${REPO_NAME}/pull/1`,
    };
    const service = new CollectionSyncService(
      new CollectionIncrementalRepository(prisma, new PlatformRepository()),
      () => ({
        appId: APP_ID.toString(),
        organizationLogin: ORG_LOGIN,
        tokens: {
          getToken: () => Promise.resolve('synthetic-token'),
          clear: () => undefined,
        } as CollectionAppTokenClient,
        client: syntheticClient(fingerprintKeys, commit, pullRequest),
        queue: new ProviderRequestQueueClient(),
      }),
      new RepositoryUrlService(),
      () => new Date('2026-08-01T12:00:00.000Z'),
      () => 'verify-ledger-run',
    );
    await service.run(OWNER_ID);

    const commitFacts = await prisma.collectionCommitFact.count({
      where: { repositoryId: REPOSITORY_ID },
    });
    const pullRequestFacts = await prisma.collectionPullRequestFact.count({
      where: { repositoryId: REPOSITORY_ID },
    });
    if (commitFacts < 1 || pullRequestFacts < 1) {
      throw new Error(
        `collector wrote commitFacts=${commitFacts} pullRequestFacts=${pullRequestFacts}`,
      );
    }
    process.stdout.write(
      `${JSON.stringify({
        repositoryId: REPOSITORY_ID,
        githubRepositoryId: GITHUB_REPOSITORY_ID.toString(),
        nameWithOwner: `${ORG_LOGIN}/${REPO_NAME}`,
        commitFacts,
        pullRequestFacts,
      })}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
