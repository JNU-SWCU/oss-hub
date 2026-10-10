import {
  ApplicationStatus,
  MemberKind,
  ProgramCategory,
  RepositoryConnectionMode,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  RepositorySource,
  RepositoryVisibility,
  ProgramTrackType,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import { PrismaService } from '../../prisma/prisma.service';
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

describe('RepositoriesRepository.listOwnedProvisionJobs integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({
      data: [
        {
          id: CURRENT_USER_ID,
          githubId: 8_300_000_000_001n,
          nickname: `${PREFIX}-Current`,
          selectedMemberKind: MemberKind.STUDENT,
        },
        {
          id: OTHER_USER_ID,
          githubId: 8_300_000_000_002n,
          nickname: `${PREFIX}-other`,
          selectedMemberKind: MemberKind.STUDENT,
        },
      ],
    });
    await prisma.program.create({
      data: {
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
          joinCodeDigest: `${PREFIX}-personal-team-digest`,
          leaderId: CURRENT_USER_ID,
        },
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
        where: { applicationId: { in: [...APPLICATION_IDS] } },
      });
      await prisma.githubRepository.deleteMany({
        where: { id: { in: [...REPOSITORY_IDS] } },
      });
      await prisma.application.deleteMany({
        where: { id: { in: [...APPLICATION_IDS] } },
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
    const byApplication = new Map(jobs.map((job) => [job.application.id, job]));

    expect([...byApplication.keys()]).toEqual([MEMBER_APPLICATION_ID]);
    expect(byApplication.has(PERSONAL_APPLICATION_ID)).toBe(false);
    expect(byApplication.has(LEADER_APPLICATION_ID)).toBe(false);
    expect(byApplication.get(MEMBER_APPLICATION_ID)).toEqual({
      application: {
        id: MEMBER_APPLICATION_ID,
        teamId: MEMBER_TEAM_ID,
        repositoryConnectionMode: RepositoryConnectionMode.NEW,
        applicant: { nickname: `${PREFIX}-other` },
        program: { name: `${PREFIX}-program` },
        team: {
          name: `${PREFIX}-member-team`,
          _count: { members: 2 },
        },
        repository: {
          id: REPOSITORY_IDS[1],
          name: REPOSITORY_IDS[1],
          url: `https://github.com/synthetic/${REPOSITORY_IDS[1]}`,
          visibility: RepositoryVisibility.PRIVATE,
          source: RepositorySource.ORG_PROVISIONED,
          invitations: [{ status: RepositoryInvitationStatus.PENDING }],
        },
      },
      status: RepositoryProvisionJobStatus.SUCCEEDED,
      lastErrorCode: 'SYNTHETIC_ERROR',
      updatedAt: FIXED_UPDATED_AT,
    });
  });

  it('follows the application to the current repository, not the job history', async () => {
    const replacementId = `${PREFIX}-replacement-repository`;
    try {
      await prisma.githubRepository.update({
        where: { id: REPOSITORY_IDS[1] },
        data: { applicationId: null, programId: null, teamId: null },
      });

      const pendingJobs =
        await repository.listOwnedProvisionJobs(8_300_000_000_001n);
      expect(
        pendingJobs.find(
          (candidate) => candidate.application.id === MEMBER_APPLICATION_ID,
        )?.application.repository,
      ).toBeNull();
      await prisma.githubRepository.create({
        data: {
          id: replacementId,
          githubRepositoryId: 8_300_000_000_777n,
          nameWithOwner: `synthetic/${replacementId}`,
          visibility: RepositoryVisibility.PRIVATE,
          source: RepositorySource.ORG_PROVISIONED,
          applicationId: MEMBER_APPLICATION_ID,
          programId: PROGRAM_ID,
          teamId: MEMBER_TEAM_ID,
        },
      });
      await prisma.repositoryInvitation.createMany({
        data: [
          {
            repositoryId: replacementId,
            githubLogin: `${PREFIX}-current`,
            status: RepositoryInvitationStatus.SUCCEEDED,
          },
          {
            repositoryId: replacementId,
            githubLogin: `${PREFIX}-other`,
            status: RepositoryInvitationStatus.FAILED_FINAL,
          },
        ],
      });

      const jobs = await repository.listOwnedProvisionJobs(8_300_000_000_001n);
      const job = jobs.find(
        (candidate) => candidate.application.id === MEMBER_APPLICATION_ID,
      );

      expect(job?.application.repository?.id).toBe(replacementId);
      expect(job?.application.repository?.id).not.toBe(REPOSITORY_IDS[1]);
      expect(job?.application.repository?.invitations).toEqual([
        { status: RepositoryInvitationStatus.SUCCEEDED },
      ]);
    } finally {
      await prisma.repositoryInvitation.deleteMany({
        where: { repositoryId: replacementId },
      });
      await prisma.githubRepository.deleteMany({
        where: { id: replacementId },
      });
      await prisma.githubRepository.update({
        where: { id: REPOSITORY_IDS[1] },
        data: {
          applicationId: MEMBER_APPLICATION_ID,
          programId: PROGRAM_ID,
          teamId: MEMBER_TEAM_ID,
        },
      });
    }
  });

  it('retains approved jobs without a repository when updatedAt ties', async () => {
    const tiedApplicationId = `${PREFIX}-tied-pending-application`;
    const tiedProgramId = `${PREFIX}-tied-program`;
    const tiedTeamId = `${PREFIX}-tied-team`;
    try {
      await prisma.program.create({
        data: {
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
          joinCodeDigest: `${PREFIX}-tied-team-digest`,
          leaderId: CURRENT_USER_ID,
        },
      });
      await prisma.teamMember.create({
        data: {
          teamId: tiedTeamId,
          programId: tiedProgramId,
          userId: CURRENT_USER_ID,
        },
      });
      await prisma.application.create({
        data: {
          ...application(
            tiedApplicationId,
            CURRENT_USER_ID,
            tiedTeamId,
            ApplicationStatus.APPROVED,
          ),
          programId: tiedProgramId,
        },
      });
      await prisma.repositoryProvisionJob.create({
        data: provisionJob(
          tiedApplicationId,
          null,
          RepositoryProvisionJobStatus.PENDING,
        ),
      });

      const jobs = await repository.listOwnedProvisionJobs(8_300_000_000_001n);
      const tiedJobs = jobs.filter(
        (candidate) =>
          candidate.application.id === MEMBER_APPLICATION_ID ||
          candidate.application.id === tiedApplicationId,
      );

      expect(tiedJobs).toHaveLength(2);
      expect(tiedJobs.map((candidate) => candidate.application.id)).toEqual(
        expect.arrayContaining([MEMBER_APPLICATION_ID, tiedApplicationId]),
      );
      expect(tiedJobs.map((candidate) => candidate.updatedAt)).toEqual([
        FIXED_UPDATED_AT,
        FIXED_UPDATED_AT,
      ]);
      expect(
        tiedJobs.find(
          (candidate) => candidate.application.id === tiedApplicationId,
        )?.application.repository,
      ).toBeNull();
    } finally {
      await prisma.repositoryProvisionJob.deleteMany({
        where: { applicationId: tiedApplicationId },
      });
      await prisma.application.deleteMany({ where: { id: tiedApplicationId } });
      await prisma.teamMember.deleteMany({ where: { teamId: tiedTeamId } });
      await prisma.team.deleteMany({ where: { id: tiedTeamId } });
      await prisma.program.deleteMany({ where: { id: tiedProgramId } });
    }
  });

  it.each([
    [PERSONAL_TEAM_ID, PERSONAL_APPLICATION_ID],
    [LEADER_TEAM_ID, LEADER_APPLICATION_ID],
  ])(
    'grants access to %s only while membership exists',
    async (teamId, applicationId) => {
      const membership = { userId: CURRENT_USER_ID, programId: PROGRAM_ID };
      try {
        await prisma.teamMember.updateMany({
          where: membership,
          data: { teamId },
        });
        const jobs =
          await repository.listOwnedProvisionJobs(8_300_000_000_001n);
        expect(jobs.map((job) => job.application.id)).toEqual([applicationId]);
        expect(jobs[0]?.application.team?._count.members).toBe(1);
      } finally {
        await prisma.teamMember.updateMany({
          where: membership,
          data: { teamId: MEMBER_TEAM_ID },
        });
      }
      const restored =
        await repository.listOwnedProvisionJobs(8_300_000_000_001n);
      expect(restored.map((job) => job.application.id)).toEqual([
        MEMBER_APPLICATION_ID,
      ]);
    },
  );
});

async function createFixtures(): Promise<void> {
  await prisma.application.createMany({
    data: [
      application(
        PERSONAL_APPLICATION_ID,
        CURRENT_USER_ID,
        PERSONAL_TEAM_ID,
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
  await prisma.githubRepository.createMany({
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
        githubLogin: `${PREFIX}-Current`,
        status: RepositoryInvitationStatus.PENDING,
      },
    ],
  });
}

function application(
  id: string,
  applicantId: string,
  teamId: string,
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

    nameWithOwner: `synthetic/${id}`,
    source: RepositorySource.ORG_PROVISIONED,
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
    updatedAt: FIXED_UPDATED_AT,
  };
}
