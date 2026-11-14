import { RepositoryProvisionGenerationRepository } from '../platform/repository-provision-generation.repository';
import {
  ApplicationStatus,
  ProgramCategory,
  RepositoryConnectionMode,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  RepositorySource,
  RepositoryVisibility,
  ProgramTrackType,
} from '@prisma/client';
import { MemberKind } from '../users/user-contract.config';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import {
  deleteGithubRepositories,
  syncGithubRepositoryLedger,
  syncGithubRepositoryLedgers,
} from '../../test/repo-ledger.fixture';
import { RepositoriesRepository } from './repositories.repository';
import { RepositoriesReadService } from './repositories-read.service';
import { RepositoryUrlService } from './repository-url.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new RepositoriesRepository(
  prisma,
  new RepositoryProvisionGenerationRepository(),
);
const readService = new RepositoriesReadService(
  repository,
  { requireOrganization: () => 'synthetic' },
  new RepositoryUrlService(),
);
const PREFIX = 'synthetic-owned-provision-jobs';
const CURRENT_USER_ID = `${PREFIX}-current-user`;
const OTHER_USER_ID = `${PREFIX}-other-user`;
const PROGRAM_ID = `${PREFIX}-program`;
const PERSONAL_APPLICATION_ID = `${PREFIX}-personal-team`;
const LEADER_APPLICATION_ID = `${PREFIX}-leader-team`;
const MEMBER_APPLICATION_ID = `${PREFIX}-member-team`;
const UNRELATED_APPLICATION_ID = `${PREFIX}-unrelated-team`;
const UNAPPROVED_APPLICATION_ID = `${PREFIX}-unapproved-team`;
const PERSONAL_TEAM_ID = `${PREFIX}-personal-team`;
const LEADER_TEAM_ID = `${PREFIX}-leader-team`;
const MEMBER_TEAM_ID = `${PREFIX}-member-team`;
const UNRELATED_TEAM_ID = `${PREFIX}-unrelated-team`;
const UNAPPROVED_TEAM_ID = `${PREFIX}-unapproved-team`;
const FIXED_UPDATED_AT = new Date('2026-07-22T01:00:00.000Z');
const APPLICATION_IDS = [
  PERSONAL_APPLICATION_ID,
  LEADER_APPLICATION_ID,
  MEMBER_APPLICATION_ID,
  UNRELATED_APPLICATION_ID,
  UNAPPROVED_APPLICATION_ID,
] as const;
const REPOSITORY_IDS = [
  `${PREFIX}-leader-repository`,
  `${PREFIX}-member-repository`,
  `${PREFIX}-unrelated-repository`,
  `${PREFIX}-unapproved-repository`,
] as const;
const REPOSITORY_GITHUB_IDS = [
  8300000001n,
  8300000002n,
  8300000003n,
  8300000004n,
] as const;
const REPLACEMENT_GITHUB_ID = 8300000000777n;

describe('RepositoriesRepository.listOwnedProvisionJobs integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({
      data: [
        {
          id: CURRENT_USER_ID,
          githubId: 8300000000001n,
          nickname: `${PREFIX}-Current`,
          type: MemberKind.STUDENT,
          approvalStatus: 'NOT_REQUIRED',
        },
        {
          id: OTHER_USER_ID,
          githubId: 8300000000002n,
          nickname: `${PREFIX}-other`,
          type: MemberKind.STUDENT,
          approvalStatus: 'NOT_REQUIRED',
        },
      ],
    });
    await prisma.program.create({
      data: {
        startAt: new Date('2026-01-01T00:00:00.000Z'),
        endAt: new Date(
          new Date('2026-12-31T00:00:00.000Z').getTime() + 365 * 86400000,
        ),
        id: PROGRAM_ID,
        name: `${PREFIX}-program`,
        organizer: 'synthetic-organizer',
        trackType: ProgramTrackType.EXTRACURRICULAR,
        category: ProgramCategory.BASIC,
        applicationTemplateKey: 'synthetic-template',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
        description: 'synthetic-description',
        repositoryProvisioningEnabled: true,
      },
    });
    await prisma.team.createMany({
      data: [
        {
          id: PERSONAL_TEAM_ID,
          programId: PROGRAM_ID,
          name: `${PREFIX}-personal-team`,
          leaderId: CURRENT_USER_ID,
          applicantId: CURRENT_USER_ID,
          answers: { title: `${PREFIX}-personal-team` },
          applicationTemplateVersion: 1,
        },
        {
          id: LEADER_TEAM_ID,
          programId: PROGRAM_ID,
          name: `${PREFIX}-leader-team`,
          leaderId: CURRENT_USER_ID,
          applicantId: CURRENT_USER_ID,
          answers: { title: `${PREFIX}-leader-team` },
          applicationTemplateVersion: 1,
        },
        {
          id: MEMBER_TEAM_ID,
          programId: PROGRAM_ID,
          name: `${PREFIX}-member-team`,
          leaderId: OTHER_USER_ID,
          applicantId: OTHER_USER_ID,
          answers: { title: `${PREFIX}-member-team` },
          applicationTemplateVersion: 1,
        },
        {
          id: UNRELATED_TEAM_ID,
          programId: PROGRAM_ID,
          name: `${PREFIX}-unrelated-team`,
          leaderId: OTHER_USER_ID,
          applicantId: OTHER_USER_ID,
          answers: { title: `${PREFIX}-unrelated-team` },
          applicationTemplateVersion: 1,
        },
        {
          id: UNAPPROVED_TEAM_ID,
          programId: PROGRAM_ID,
          name: `${PREFIX}-unapproved-team`,
          leaderId: CURRENT_USER_ID,
          applicantId: CURRENT_USER_ID,
          answers: { title: `${PREFIX}-unapproved-team` },
          applicationTemplateVersion: 1,
        },
      ],
    });

    await prisma.teamMember.createMany({
      data: [
        {
          teamId: MEMBER_TEAM_ID,
          programId: PROGRAM_ID,
          userId: CURRENT_USER_ID,
        },
        {
          teamId: MEMBER_TEAM_ID,
          programId: PROGRAM_ID,
          userId: OTHER_USER_ID,
        },
      ],
    });
    await createFixtures();
  });

  afterAll(async () => {
    try {
      await prisma.repositoryInvitation.deleteMany({
        where: { repositoryId: { in: [...REPOSITORY_IDS] } },
      });
      await prisma.repositoryProvisionJob.deleteMany({
        where: { teamId: { in: [...APPLICATION_IDS] } },
      });
      await deleteGithubRepositories(prisma, {
        id: { in: [...REPOSITORY_IDS] },
      });
      await prisma.teamMember.deleteMany({
        where: {
          teamId: {
            in: [
              PERSONAL_TEAM_ID,
              LEADER_TEAM_ID,
              MEMBER_TEAM_ID,
              UNRELATED_TEAM_ID,
              UNAPPROVED_TEAM_ID,
            ],
          },
        },
      });
      await prisma.team.deleteMany({
        where: {
          id: {
            in: [
              PERSONAL_TEAM_ID,
              LEADER_TEAM_ID,
              MEMBER_TEAM_ID,
              UNRELATED_TEAM_ID,
              UNAPPROVED_TEAM_ID,
            ],
          },
        },
      });
      await prisma.program.deleteMany({ where: { id: PROGRAM_ID } });
      await prisma.user.deleteMany({
        where: { id: { in: [CURRENT_USER_ID, OTHER_USER_ID] } },
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  it('returns current-member jobs, excluding historical applicants and bare leaders', async () => {
    const jobs = await repository.listOwnedProvisionJobs(8_300_000_000_001n);
    const byApplication = new Map(jobs.map((job) => [job.team.id, job]));

    expect([...byApplication.keys()]).toEqual([MEMBER_APPLICATION_ID]);
    expect(byApplication.has(PERSONAL_APPLICATION_ID)).toBe(false);
    expect(byApplication.has(LEADER_APPLICATION_ID)).toBe(false);
    expect(byApplication.get(MEMBER_APPLICATION_ID)).toEqual({
      team: {
        id: MEMBER_APPLICATION_ID,
        repositoryConnectionMode: RepositoryConnectionMode.NEW,
        applicant: { nickname: `${PREFIX}-other` },
        program: { name: `${PREFIX}-program` },
        name: `${PREFIX}-member-team`,
        _count: { members: 2 },
        repository: {
          id: REPOSITORY_GITHUB_IDS[1].toString(),
          nameWithOwner: `synthetic/${REPOSITORY_IDS[1]}`,
          visibility: RepositoryVisibility.PRIVATE,
          source: RepositorySource.ORG_PROVISIONED,
          invitations: [{ status: RepositoryInvitationStatus.PENDING }],
        },
      },
      status: RepositoryProvisionJobStatus.SUCCEEDED,
      lastErrorCode: 'SYNTHETIC_ERROR',
      updatedAt: FIXED_UPDATED_AT,
    });
    const [mine] = await readService.getMyRepositories(8_300_000_000_001n);
    expect(mine).toMatchObject({
      repositoryId: REPOSITORY_GITHUB_IDS[1].toString(),
      repositoryName: REPOSITORY_IDS[1],
      githubUrl: `https://github.com/synthetic/${REPOSITORY_IDS[1]}`,
    });
  });

  it('follows the application to the current repository, not the job history', async () => {
    const replacementId = `${PREFIX}-replacement-repository`;
    try {
      await prisma.githubRepository.update({
        where: { id: REPOSITORY_IDS[1] },
        data: { teamId: null },
      });
      await syncGithubRepositoryLedger(prisma, REPOSITORY_GITHUB_IDS[1]);

      const pendingJobs =
        await repository.listOwnedProvisionJobs(8_300_000_000_001n);
      expect(
        pendingJobs.find(
          (candidate) => candidate.team.id === MEMBER_APPLICATION_ID,
        )?.team.repository,
      ).toBeNull();
      await prisma.githubRepository.create({
        data: {
          id: replacementId,
          githubRepositoryId: REPLACEMENT_GITHUB_ID,
          nameWithOwner: `synthetic/${replacementId}`,
          visibility: RepositoryVisibility.PRIVATE,
          source: RepositorySource.ORG_PROVISIONED,
          teamId: MEMBER_APPLICATION_ID,
        },
      });
      await syncGithubRepositoryLedger(prisma, REPLACEMENT_GITHUB_ID);
      await prisma.repositoryInvitation.createMany({
        data: [
          {
            repositoryId: replacementId,
            repoId: REPLACEMENT_GITHUB_ID,
            githubLogin: `${PREFIX}-current`,
            status: RepositoryInvitationStatus.SUCCEEDED,
          },
          {
            repositoryId: replacementId,
            repoId: REPLACEMENT_GITHUB_ID,
            githubLogin: `${PREFIX}-other`,
            status: RepositoryInvitationStatus.FAILED_FINAL,
          },
        ],
      });

      const jobs = await repository.listOwnedProvisionJobs(8_300_000_000_001n);
      const job = jobs.find(
        (candidate) => candidate.team.id === MEMBER_APPLICATION_ID,
      );

      expect(job?.team.repository?.id).toBe(REPLACEMENT_GITHUB_ID.toString());
      expect(job?.team.repository?.id).not.toBe(
        REPOSITORY_GITHUB_IDS[1].toString(),
      );
      expect(job?.team.repository?.invitations).toEqual([
        { status: RepositoryInvitationStatus.SUCCEEDED },
      ]);
    } finally {
      await prisma.repositoryInvitation.deleteMany({
        where: { repositoryId: replacementId },
      });
      await deleteGithubRepositories(prisma, { id: replacementId });
      await prisma.githubRepository.update({
        where: { id: REPOSITORY_IDS[1] },
        data: {
          teamId: MEMBER_APPLICATION_ID,
        },
      });
      await syncGithubRepositoryLedger(prisma, REPOSITORY_GITHUB_IDS[1]);
    }
  });

  it('retains approved jobs without a repository when updatedAt ties', async () => {
    const tiedProgramId = `${PREFIX}-tied-program`;
    const tiedTeamId = `${PREFIX}-tied-team`;
    try {
      await prisma.program.create({
        data: {
          startAt: new Date('2026-01-01T00:00:00.000Z'),
          endAt: new Date(
            new Date('2026-12-31T00:00:00.000Z').getTime() + 365 * 86400000,
          ),
          id: tiedProgramId,
          name: `${PREFIX}-tied-program`,
          organizer: 'synthetic-organizer',
          trackType: ProgramTrackType.EXTRACURRICULAR,
          category: ProgramCategory.BASIC,
          applicationTemplateKey: 'synthetic-template',
          applicationTemplateVersion: 1,
          applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
          applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
          description: 'synthetic-description',
          repositoryProvisioningEnabled: true,
        },
      });
      await prisma.team.create({
        data: {
          id: tiedTeamId,
          programId: tiedProgramId,
          name: `${PREFIX}-tied-team`,
          leaderId: CURRENT_USER_ID,
          applicantId: CURRENT_USER_ID,
          answers: { title: `${PREFIX}-tied-team` },
          applicationTemplateVersion: 1,
        },
      });
      await prisma.teamMember.create({
        data: {
          teamId: tiedTeamId,
          programId: tiedProgramId,
          userId: CURRENT_USER_ID,
        },
      });
      await prisma.team.update({
        where: { id: tiedTeamId },
        data: { status: ApplicationStatus.APPROVED },
      });
      await prisma.repositoryProvisionJob.create({
        data: provisionJob(
          tiedTeamId,
          null,
          null,
          RepositoryProvisionJobStatus.PENDING,
        ),
      });

      const jobs = await repository.listOwnedProvisionJobs(8_300_000_000_001n);
      const tiedJobs = jobs.filter(
        (candidate) =>
          candidate.team.id === MEMBER_APPLICATION_ID ||
          candidate.team.id === tiedTeamId,
      );

      expect(tiedJobs).toHaveLength(2);
      expect(tiedJobs.map((candidate) => candidate.team.id)).toEqual(
        expect.arrayContaining([MEMBER_APPLICATION_ID, tiedTeamId]),
      );
      expect(tiedJobs.map((candidate) => candidate.updatedAt)).toEqual([
        FIXED_UPDATED_AT,
        FIXED_UPDATED_AT,
      ]);
      expect(
        tiedJobs.find((candidate) => candidate.team.id === tiedTeamId)?.team
          .repository,
      ).toBeNull();
    } finally {
      await prisma.repositoryProvisionJob.deleteMany({
        where: { teamId: tiedTeamId },
      });
      await prisma.teamMember.deleteMany({ where: { teamId: tiedTeamId } });
      await prisma.team.deleteMany({ where: { id: tiedTeamId } });
      await prisma.program.deleteMany({ where: { id: tiedProgramId } });
    }
  });

  it('fills repo_id from the repository for writes that omit it', async () => {
    const requestId = `${PREFIX}-legacy-history`;
    const keptRepoId = 8300000000999n;
    const repoIdOf = async (table: string, id: string) =>
      (
        await prisma.$queryRawUnsafe<{ repo_id: bigint | null }[]>(
          `SELECT "repo_id" FROM "${table}" WHERE "id" = $1`,
          id,
        )
      )[0]?.repo_id;
    try {
      await prisma.repositoryProvisionJob.deleteMany({
        where: { teamId: UNAPPROVED_APPLICATION_ID },
      });
      await prisma.$executeRaw`
        INSERT INTO "RepositoryProvisionJob" ("id", "teamId", "repositoryId", "updatedAt")
        VALUES (${requestId}, ${UNAPPROVED_APPLICATION_ID}, ${REPOSITORY_IDS[3]}, now())
      `;
      await prisma.$executeRaw`
        INSERT INTO "RepositoryInvitation" (
          "id", "repositoryId", "repo_id", "githubLogin", "updatedAt"
        )
        VALUES
          (${requestId}, ${REPOSITORY_IDS[2]}, NULL, ${`${PREFIX}-legacy`}, now()),
          (${`${requestId}-kept`}, ${REPOSITORY_IDS[2]}, ${keptRepoId},
            ${`${PREFIX}-kept`}, now())
      `;
      await prisma.$executeRaw`
        INSERT INTO "RepositoryIssuanceHistory" (
          "id", "requestId", "teamId", "repositoryId", "repo_id",
          "connectionMode", "outcome", "requestedAt", "closedAt"
        )
        VALUES
          (${requestId}, ${requestId}, ${UNRELATED_TEAM_ID}, ${REPOSITORY_IDS[2]}, NULL,
            'NEW', 'SUCCEEDED', now(), now()),
          (${`${requestId}-kept`}, ${`${requestId}-kept`}, ${UNRELATED_TEAM_ID},
            ${REPOSITORY_IDS[2]}, ${keptRepoId}, 'NEW', 'SUCCEEDED', now(), now())
      `;

      await expect(repoIdOf('RepositoryProvisionJob', requestId)).resolves.toBe(
        REPOSITORY_GITHUB_IDS[3],
      );
      await expect(repoIdOf('RepositoryInvitation', requestId)).resolves.toBe(
        REPOSITORY_GITHUB_IDS[2],
      );
      await expect(
        repoIdOf('RepositoryInvitation', `${requestId}-kept`),
      ).resolves.toBe(keptRepoId);
      await expect(
        repoIdOf('RepositoryIssuanceHistory', requestId),
      ).resolves.toBe(REPOSITORY_GITHUB_IDS[2]);
      await expect(
        repoIdOf('RepositoryIssuanceHistory', `${requestId}-kept`),
      ).resolves.toBe(keptRepoId);

      await prisma.$executeRaw`
        UPDATE "RepositoryProvisionJob" SET "repositoryId" = ${REPOSITORY_IDS[2]}
        WHERE "id" = ${requestId}
      `;
      await expect(repoIdOf('RepositoryProvisionJob', requestId)).resolves.toBe(
        REPOSITORY_GITHUB_IDS[2],
      );
      await prisma.$executeRaw`
        UPDATE "RepositoryProvisionJob" SET "repositoryId" = NULL
        WHERE "id" = ${requestId}
      `;
      await expect(
        repoIdOf('RepositoryProvisionJob', requestId),
      ).resolves.toBeNull();
    } finally {
      await prisma.repositoryIssuanceHistory.deleteMany({
        where: { id: { in: [requestId, `${requestId}-kept`] } },
      });
      await prisma.repositoryInvitation.deleteMany({
        where: { id: { in: [requestId, `${requestId}-kept`] } },
      });
      await prisma.repositoryProvisionJob.deleteMany({
        where: { teamId: UNAPPROVED_APPLICATION_ID },
      });
      await prisma.repositoryProvisionJob.create({
        data: provisionJob(
          UNAPPROVED_APPLICATION_ID,
          REPOSITORY_IDS[3],
          REPOSITORY_GITHUB_IDS[3],
          RepositoryProvisionJobStatus.SUCCEEDED,
        ),
      });
    }
  });

  it.each([PERSONAL_TEAM_ID, LEADER_TEAM_ID])(
    'grants access to %s only while membership exists',
    async (teamId) => {
      const membership = { userId: CURRENT_USER_ID, programId: PROGRAM_ID };
      try {
        await prisma.teamMember.updateMany({
          where: membership,
          data: { teamId },
        });
        const jobs =
          await repository.listOwnedProvisionJobs(8_300_000_000_001n);
        expect(jobs.map((job) => job.team.id)).toEqual([teamId]);
        expect(jobs[0]?.team._count.members).toBe(1);
      } finally {
        await prisma.teamMember.updateMany({
          where: membership,
          data: { teamId: MEMBER_TEAM_ID },
        });
      }
      const restored =
        await repository.listOwnedProvisionJobs(8_300_000_000_001n);
      expect(restored.map((job) => job.team.id)).toEqual([
        MEMBER_APPLICATION_ID,
      ]);
    },
  );
});

async function createFixtures(): Promise<void> {
  for (const row of [
    application(CURRENT_USER_ID, PERSONAL_TEAM_ID, ApplicationStatus.APPROVED),
    application(OTHER_USER_ID, LEADER_TEAM_ID, ApplicationStatus.APPROVED),
    application(OTHER_USER_ID, MEMBER_TEAM_ID, ApplicationStatus.APPROVED),
    application(OTHER_USER_ID, UNRELATED_TEAM_ID, ApplicationStatus.APPROVED),
    application(OTHER_USER_ID, UNAPPROVED_TEAM_ID, ApplicationStatus.SUBMITTED),
  ]) {
    const { teamId, ...data } = row;
    await prisma.team.update({ where: { id: teamId }, data });
  }
  await prisma.githubRepository.createMany({
    data: [
      storedRepository(REPOSITORY_IDS[0], LEADER_TEAM_ID, 8300000001n),
      storedRepository(REPOSITORY_IDS[1], MEMBER_TEAM_ID, 8300000002n),
      storedRepository(REPOSITORY_IDS[2], UNRELATED_TEAM_ID, 8300000003n),
      storedRepository(REPOSITORY_IDS[3], UNAPPROVED_TEAM_ID, 8300000004n),
    ],
  });
  await syncGithubRepositoryLedgers(prisma, {
    id: { in: [...REPOSITORY_IDS] },
  });
  await prisma.repositoryProvisionJob.createMany({
    data: [
      provisionJob(
        PERSONAL_APPLICATION_ID,
        null,
        null,
        RepositoryProvisionJobStatus.PENDING,
      ),
      provisionJob(
        LEADER_APPLICATION_ID,
        REPOSITORY_IDS[0],
        REPOSITORY_GITHUB_IDS[0],
        RepositoryProvisionJobStatus.SUCCEEDED,
      ),
      provisionJob(
        MEMBER_APPLICATION_ID,
        REPOSITORY_IDS[1],
        REPOSITORY_GITHUB_IDS[1],
        RepositoryProvisionJobStatus.SUCCEEDED,
      ),
      provisionJob(
        UNRELATED_APPLICATION_ID,
        REPOSITORY_IDS[2],
        REPOSITORY_GITHUB_IDS[2],
        RepositoryProvisionJobStatus.SUCCEEDED,
      ),
      provisionJob(
        UNAPPROVED_APPLICATION_ID,
        REPOSITORY_IDS[3],
        REPOSITORY_GITHUB_IDS[3],
        RepositoryProvisionJobStatus.SUCCEEDED,
      ),
    ],
  });
  await prisma.repositoryInvitation.createMany({
    data: [
      {
        repositoryId: REPOSITORY_IDS[0],
        repoId: REPOSITORY_GITHUB_IDS[0],
        githubLogin: `${PREFIX}-current`,
        status: RepositoryInvitationStatus.SUCCEEDED,
      },
      {
        repositoryId: REPOSITORY_IDS[0],
        repoId: REPOSITORY_GITHUB_IDS[0],
        githubLogin: `${PREFIX}-other`,
        status: RepositoryInvitationStatus.FAILED_FINAL,
        lastErrorMessage: 'synthetic-raw-upstream-detail',
      },
      {
        repositoryId: REPOSITORY_IDS[1],
        repoId: REPOSITORY_GITHUB_IDS[1],
        githubLogin: `${PREFIX}-Current`,
        status: RepositoryInvitationStatus.PENDING,
      },
    ],
  });
}

function application(
  applicantId: string,
  teamId: string,
  status: ApplicationStatus,
) {
  return {
    programId: PROGRAM_ID,
    applicantId,
    teamId,
    answers: { synthetic: true },
    applicationTemplateVersion: 1,
    status,
  };
}

function storedRepository(
  id: string,
  teamId: string | null,
  githubRepositoryId: bigint,
) {
  return {
    id,
    teamId,
    githubRepositoryId,
    nameWithOwner: `synthetic/${id}`,
    source: RepositorySource.ORG_PROVISIONED,
    visibility: RepositoryVisibility.PRIVATE,
  };
}

function provisionJob(
  teamId: string,
  repositoryId: string | null,
  repoId: bigint | null,
  status: RepositoryProvisionJobStatus,
) {
  return {
    teamId,
    repositoryId,
    repoId,
    status,
    nextAttemptAt: new Date('2026-07-22T00:00:00.000Z'),
    lastErrorCode: 'SYNTHETIC_ERROR',
    lastErrorMessage: 'synthetic-raw-upstream-detail',
    updatedAt: FIXED_UPDATED_AT,
  };
}
