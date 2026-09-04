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
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { RepositoriesRepository } from './repository/repositories.repository';

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
    // CURRENT_USER_ID는 MEMBER_TEAM_ID의 팀원으로 들어가 "리더가 아니라 팀원으로 소유"
    // 분기(members some)를 검증한다. OTHER_USER_ID는 MEMBER_TEAM_ID의 리더인데,
    // 실제 D5 생성 흐름(createTeamWithLeader)은 리더도 항상 TeamMember 행을 갖는다
    // (프로그램당 한 팀에만 소속 가능한 unique 제약상 CURRENT_USER_ID는 이미 이 프로그램의
    // 유일한 소속 슬롯을 MEMBER_TEAM_ID에 쓰고 있어 PERSONAL_TEAM_ID/LEADER_TEAM_ID에는
    // 추가할 수 없다 — 이 두 팀은 리더 전용 소유(leader 분기)만 검증한다).
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
    expect(byApplication.get(PERSONAL_APPLICATION_ID)).toEqual({
      application: {
        id: PERSONAL_APPLICATION_ID,
        teamId: PERSONAL_TEAM_ID,
        repositoryConnectionMode: RepositoryConnectionMode.NEW,
        applicant: { nickname: `${PREFIX}-Current` },
        program: { name: `${PREFIX}-program` },
        team: {
          name: `${PREFIX}-personal-team`,
          _count: { members: 0 },
        },
      },
      status: RepositoryProvisionJobStatus.PENDING,
      lastErrorCode: 'SYNTHETIC_ERROR',
      updatedAt: FIXED_UPDATED_AT,
      repository: null,
    });
    expect(byApplication.get(LEADER_APPLICATION_ID)).toEqual({
      application: {
        id: LEADER_APPLICATION_ID,
        teamId: LEADER_TEAM_ID,
        repositoryConnectionMode: RepositoryConnectionMode.NEW,
        applicant: { nickname: `${PREFIX}-other` },
        program: { name: `${PREFIX}-program` },
        team: {
          name: `${PREFIX}-leader-team`,
          _count: { members: 0 },
        },
      },
      status: RepositoryProvisionJobStatus.SUCCEEDED,
      lastErrorCode: 'SYNTHETIC_ERROR',
      updatedAt: FIXED_UPDATED_AT,
      repository: {
        id: REPOSITORY_IDS[0],
        applicationId: LEADER_APPLICATION_ID,
        name: REPOSITORY_IDS[0],
        url: `https://github.com/synthetic/${REPOSITORY_IDS[0]}`,
        visibility: RepositoryVisibility.PRIVATE,
        invitations: [{ status: RepositoryInvitationStatus.SUCCEEDED }],
      },
    });
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
      },
      status: RepositoryProvisionJobStatus.SUCCEEDED,
      lastErrorCode: 'SYNTHETIC_ERROR',
      updatedAt: FIXED_UPDATED_AT,
      repository: {
        id: REPOSITORY_IDS[1],
        applicationId: MEMBER_APPLICATION_ID,
        name: REPOSITORY_IDS[1],
        url: `https://github.com/synthetic/${REPOSITORY_IDS[1]}`,
        visibility: RepositoryVisibility.PRIVATE,
        invitations: [{ status: RepositoryInvitationStatus.PENDING }],
      },
    });
  });
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
        githubLogin: `${PREFIX}-current`,
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
    // #617 단계 D 이후 name/url 컬럼이 없다 — nameWithOwner("synthetic/<id>")에서
    // repository-identity.ts 헬퍼로 유도되므로, 아래 name/url 기댓값과 그대로 맞아떨어진다.
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
