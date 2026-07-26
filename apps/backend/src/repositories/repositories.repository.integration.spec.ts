import {
  ApplicationStatus,
  ProgramCategory,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
  Role,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { RepositoriesRepository } from './repositories.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new RepositoriesRepository(prisma);
const PREFIX = 'synthetic-owned-provision-jobs';
const CURRENT_USER_ID = `${PREFIX}-current-user`;
const OTHER_USER_ID = `${PREFIX}-other-user`;
const PROGRAM_ID = `${PREFIX}-program`;
const PERSONAL_APPLICATION_ID = `${PREFIX}-personal-application`;
const LEADER_APPLICATION_ID = `${PREFIX}-leader-application`;
const MEMBER_APPLICATION_ID = `${PREFIX}-member-application`;
const UNRELATED_APPLICATION_ID = `${PREFIX}-unrelated-application`;
const UNAPPROVED_APPLICATION_ID = `${PREFIX}-unapproved-application`;
const LEADER_TEAM_ID = `${PREFIX}-leader-team`;
const MEMBER_TEAM_ID = `${PREFIX}-member-team`;
const UNRELATED_TEAM_ID = `${PREFIX}-unrelated-team`;
const UNAPPROVED_TEAM_ID = `${PREFIX}-unapproved-team`;
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

describe('RepositoriesRepository.listOwnedProvisionJobs integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({
      data: [
        {
          id: CURRENT_USER_ID,
          githubId: 8_300_000_000_001n,
          nickname: `${PREFIX}-current`,
          role: Role.STUDENT,
        },
        {
          id: OTHER_USER_ID,
          githubId: 8_300_000_000_002n,
          nickname: `${PREFIX}-other`,
          role: Role.STUDENT,
        },
      ],
    });
    await prisma.program.create({
      data: {
        id: PROGRAM_ID,
        name: `${PREFIX}-program`,
        organizer: 'synthetic-organizer',
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
          id: LEADER_TEAM_ID,
          programId: PROGRAM_ID,
          name: `${PREFIX}-leader-team`,
          joinCodeDigest: `${PREFIX}-leader-team-digest`,
          leaderId: CURRENT_USER_ID,
        },
        {
          id: MEMBER_TEAM_ID,
          programId: PROGRAM_ID,
          name: `${PREFIX}-member-team`,
          joinCodeDigest: `${PREFIX}-member-team-digest`,
          leaderId: OTHER_USER_ID,
        },
        {
          id: UNRELATED_TEAM_ID,
          programId: PROGRAM_ID,
          name: `${PREFIX}-unrelated-team`,
          joinCodeDigest: `${PREFIX}-unrelated-team-digest`,
          leaderId: OTHER_USER_ID,
        },
        {
          id: UNAPPROVED_TEAM_ID,
          programId: PROGRAM_ID,
          name: `${PREFIX}-unapproved-team`,
          joinCodeDigest: `${PREFIX}-unapproved-team-digest`,
          leaderId: CURRENT_USER_ID,
        },
      ],
    });
    await prisma.teamMember.create({
      data: {
        teamId: MEMBER_TEAM_ID,
        programId: PROGRAM_ID,
        userId: CURRENT_USER_ID,
      },
    });
    await createFixtures();
  });

  afterAll(async () => {
    await prisma.repositoryInvitation.deleteMany({
      where: { repositoryId: { in: [...REPOSITORY_IDS] } },
    });
    await prisma.repositoryProvisionJob.deleteMany({
      where: { applicationId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.repository.deleteMany({
      where: { id: { in: [...REPOSITORY_IDS] } },
    });
    await prisma.application.deleteMany({
      where: { id: { in: [...APPLICATION_IDS] } },
    });
    await prisma.teamMember.deleteMany({
      where: {
        teamId: {
          in: [
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
            LEADER_TEAM_ID,
            MEMBER_TEAM_ID,
            UNRELATED_TEAM_ID,
            UNAPPROVED_TEAM_ID,
          ],
        },
      },
    });
    await prisma.program.delete({ where: { id: PROGRAM_ID } });
    await prisma.user.deleteMany({
      where: { id: { in: [CURRENT_USER_ID, OTHER_USER_ID] } },
    });
    await prisma.$disconnect();
  });

  it('returns only current-user approved personal and team jobs with safe selected fields', async () => {
    const jobs = await repository.listOwnedProvisionJobs(8_300_000_000_001n);
    const byApplication = new Map(jobs.map((job) => [job.application.id, job]));

    expect([...byApplication.keys()].sort()).toEqual(
      [
        PERSONAL_APPLICATION_ID,
        LEADER_APPLICATION_ID,
        MEMBER_APPLICATION_ID,
      ].sort(),
    );
    expect(byApplication.get(PERSONAL_APPLICATION_ID)).toMatchObject({
      status: RepositoryProvisionJobStatus.PENDING,
      repository: null,
    });
    expect(byApplication.get(LEADER_APPLICATION_ID)?.repository).toMatchObject({
      id: REPOSITORY_IDS[0],
      invitations: [{ status: RepositoryInvitationStatus.SUCCEEDED }],
    });
    expect(byApplication.get(MEMBER_APPLICATION_ID)?.repository).toMatchObject({
      id: REPOSITORY_IDS[1],
      invitations: [{ status: RepositoryInvitationStatus.PENDING }],
    });
    expect(JSON.stringify(jobs)).not.toContain('lastErrorMessage');
    expect(JSON.stringify(jobs)).not.toContain('synthetic-raw-upstream-detail');
  });
});

async function createFixtures(): Promise<void> {
  await prisma.application.createMany({
    data: [
      application(
        PERSONAL_APPLICATION_ID,
        CURRENT_USER_ID,
        null,
        ApplicationStatus.APPROVED,
      ),
      application(
        LEADER_APPLICATION_ID,
        OTHER_USER_ID,
        LEADER_TEAM_ID,
        ApplicationStatus.APPROVED,
      ),
      application(
        MEMBER_APPLICATION_ID,
        OTHER_USER_ID,
        MEMBER_TEAM_ID,
        ApplicationStatus.APPROVED,
      ),
      application(
        UNRELATED_APPLICATION_ID,
        OTHER_USER_ID,
        UNRELATED_TEAM_ID,
        ApplicationStatus.APPROVED,
      ),
      application(
        UNAPPROVED_APPLICATION_ID,
        OTHER_USER_ID,
        UNAPPROVED_TEAM_ID,
        ApplicationStatus.SUBMITTED,
      ),
    ],
  });
  await prisma.repository.createMany({
    data: [
      storedRepository(
        REPOSITORY_IDS[0],
        LEADER_APPLICATION_ID,
        LEADER_TEAM_ID,
        8_300_000_001n,
      ),
      storedRepository(
        REPOSITORY_IDS[1],
        MEMBER_APPLICATION_ID,
        MEMBER_TEAM_ID,
        8_300_000_002n,
      ),
      storedRepository(
        REPOSITORY_IDS[2],
        UNRELATED_APPLICATION_ID,
        UNRELATED_TEAM_ID,
        8_300_000_003n,
      ),
      storedRepository(
        REPOSITORY_IDS[3],
        UNAPPROVED_APPLICATION_ID,
        UNAPPROVED_TEAM_ID,
        8_300_000_004n,
      ),
    ],
  });
  await prisma.repositoryProvisionJob.createMany({
    data: [
      provisionJob(
        PERSONAL_APPLICATION_ID,
        null,
        RepositoryProvisionJobStatus.PENDING,
      ),
      provisionJob(
        LEADER_APPLICATION_ID,
        REPOSITORY_IDS[0],
        RepositoryProvisionJobStatus.SUCCEEDED,
      ),
      provisionJob(
        MEMBER_APPLICATION_ID,
        REPOSITORY_IDS[1],
        RepositoryProvisionJobStatus.SUCCEEDED,
      ),
      provisionJob(
        UNRELATED_APPLICATION_ID,
        REPOSITORY_IDS[2],
        RepositoryProvisionJobStatus.SUCCEEDED,
      ),
      provisionJob(
        UNAPPROVED_APPLICATION_ID,
        REPOSITORY_IDS[3],
        RepositoryProvisionJobStatus.SUCCEEDED,
      ),
    ],
  });
  await prisma.repositoryInvitation.createMany({
    data: [
      {
        repositoryId: REPOSITORY_IDS[0],
        githubLogin: `${PREFIX}-current`,
        status: RepositoryInvitationStatus.SUCCEEDED,
      },
      {
        repositoryId: REPOSITORY_IDS[0],
        githubLogin: `${PREFIX}-other`,
        status: RepositoryInvitationStatus.FAILED_FINAL,
        lastErrorMessage: 'synthetic-raw-upstream-detail',
      },
      {
        repositoryId: REPOSITORY_IDS[1],
        githubLogin: `${PREFIX}-current`,
        status: RepositoryInvitationStatus.PENDING,
      },
    ],
  });
}

function application(
  id: string,
  applicantId: string,
  teamId: string | null,
  status: ApplicationStatus,
) {
  return {
    id,
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
  applicationId: string,
  teamId: string | null,
  githubRepositoryId: bigint,
) {
  return {
    id,
    applicationId,
    programId: PROGRAM_ID,
    teamId,
    githubRepositoryId,
    name: id,
    url: `https://github.com/synthetic/${id}`,
    visibility: RepositoryVisibility.PRIVATE,
  };
}

function provisionJob(
  applicationId: string,
  repositoryId: string | null,
  status: RepositoryProvisionJobStatus,
) {
  return {
    applicationId,
    repositoryId,
    status,
    nextAttemptAt: new Date('2026-07-22T00:00:00.000Z'),
    lastErrorCode: 'SYNTHETIC_ERROR',
    lastErrorMessage: 'synthetic-raw-upstream-detail',
  };
}
