import type { PrismaClient } from '@prisma/client';
import { at } from './query-growth';

const DAY_MS = 24 * 60 * 60 * 1000;
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const GITHUB_ID_BASE = 9_710_000_000_000_000n;
const REPO_ID_BASE = 9_720_000_000_000_000n;
const STUDENT_ID_BASE = 9_900_000_000;
const ID_PREFIX = 'query-growth-';
const SEEDED_GITHUB_IDS = {
  gte: GITHUB_ID_BASE,
  lt: GITHUB_ID_BASE + 1_000_000n,
};
const SEEDED_REPO_IDS = { gte: REPO_ID_BASE, lt: REPO_ID_BASE + 1_000_000n };
const SEEDED = { startsWith: ID_PREFIX };

export interface QueryGrowthWorld {
  readonly scale: number;
  readonly year: number;
  readonly staffGithubId: bigint;
  readonly studentGithubId: bigint;
  readonly targetProgramId: string;
  readonly targetTeamId: string;
  readonly targetProjectId: string;
  readonly profileUserId: string;
}

const id = (suffix: string) => `${ID_PREFIX}${suffix}`;
const githubIdOf = (index: number) => GITHUB_ID_BASE + BigInt(index);

function seoulYear(instant: Date): number {
  return new Date(instant.getTime() + SEOUL_OFFSET_MS).getUTCFullYear();
}

export async function seedQueryGrowthWorld(
  prisma: PrismaClient,
  scale: number,
  now: Date,
): Promise<QueryGrowthWorld> {
  const year = seoulYear(now);
  const studentCount = 4 * scale;
  const programCount = 2 * scale;
  const teamsPerProgram = 2 * scale;
  const milestonesPerProgram = 2 * scale;
  const programStart = new Date(now.getTime() - 30 * DAY_MS);
  const profile = { profileCreatedAt: now, profileUpdatedAt: now };

  const staffGithubId = githubIdOf(0);
  const studentIds = Array.from({ length: studentCount }, (_, index) =>
    id(`student-${index}`),
  );
  const studentGithubIds = studentIds.map((_, index) => githubIdOf(index + 1));
  await prisma.user.createMany({
    data: [
      {
        id: id('staff-viewer'),
        githubId: staffGithubId,
        nickname: 'query-growth-staff',
        name: 'Query Growth Staff',
        type: 'STAFF',
        department: 'Synthetic office',
        departmentType: 'DEPARTMENT',
        approvalStatus: 'APPROVED',
        ...profile,
      },
      ...studentIds.map((userId, index) => ({
        id: userId,
        githubId: at(studentGithubIds, index),
        nickname: `query-growth-student-${index}`,
        name: `Student ${index}`,
        type: 'STUDENT' as const,
        studentId: String(STUDENT_ID_BASE + index),
        department: `Synthetic department ${index % 3}`,
        departmentType: 'DEPARTMENT' as const,
        ...profile,
      })),
    ],
  });

  const observedEarly = new Date(Date.UTC(year, 0, 15));
  const observedLate = new Date(now.getTime() - 60 * 60 * 1000);
  const previousYearObserved = new Date(Date.UTC(year - 1, 11, 1));
  await prisma.githubUserActivityObservation.createMany({
    data: studentGithubIds.flatMap((githubId, index) => [
      {
        githubId,
        year,
        visibility: 'PUBLIC' as const,
        commitCount: index + 1,
        pullRequestCount: 1,
        issueCount: 1,
        repositoryCount: 1,
        starCount: 1,
        observedAt: observedEarly,
      },
      {
        githubId,
        year,
        visibility: 'PUBLIC' as const,
        commitCount: index + 10,
        pullRequestCount: 2,
        issueCount: 2,
        repositoryCount: 2,
        starCount: 2,
        observedAt: observedLate,
      },
      {
        githubId,
        year,
        visibility: 'PRIVATE' as const,
        commitCount: 3,
        pullRequestCount: 1,
        issueCount: 0,
        repositoryCount: 1,
        observedAt: observedLate,
      },
      {
        githubId,
        year: year - 1,
        visibility: 'PUBLIC' as const,
        commitCount: index + 5,
        pullRequestCount: 1,
        issueCount: 1,
        repositoryCount: 1,
        starCount: 1,
        observedAt: previousYearObserved,
      },
    ]),
  });

  const programIds = Array.from({ length: programCount }, (_, index) =>
    id(`program-${index}`),
  );
  await prisma.program.createMany({
    data: programIds.map((programId, index) => ({
      id: programId,
      name: `Query growth program ${index}`,
      organizers: ['Synthetic integration fixture'],
      category: 'BASIC' as const,
      trackType: 'CURRICULAR' as const,
      applicationTemplateKey: 'capstone-v1',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date(now.getTime() - 60 * DAY_MS),
      applicationEndAt: new Date(now.getTime() - 31 * DAY_MS),
      startAt: programStart,
      endAt: new Date(now.getTime() + 60 * DAY_MS),
      teamMinSize: 1,
      teamMaxSize: 3,
      description: 'Synthetic query growth fixture',
    })),
  });

  const milestones = programIds.flatMap((programId, programIndex) =>
    Array.from({ length: milestonesPerProgram }, (_, index) => ({
      id: id(`milestone-${programIndex}-${index}`),
      programId,
      name: `Milestone ${index}`,
      startAt: programStart,
      dueAt: new Date(
        now.getTime() + (index % 2 === 0 ? -10 : 10) * DAY_MS + index * 1000,
      ),
      requirementId: id(`requirement-${programIndex}-${index}`),
    })),
  );
  await prisma.milestone.createMany({
    data: milestones.map((milestone) => ({
      id: milestone.id,
      programId: milestone.programId,
      name: milestone.name,
      startAt: milestone.startAt,
      dueAt: milestone.dueAt,
    })),
  });
  await prisma.requirement.createMany({
    data: milestones.map((milestone) => ({
      id: milestone.requirementId,
      milestoneId: milestone.id,
      name: `Document for ${milestone.name}`,
      required: true,
      sortOrder: 1,
    })),
  });

  const teams = programIds.flatMap((programId, programIndex) =>
    Array.from({ length: teamsPerProgram }, (_, index) => ({
      id: id(`team-${programIndex}-${index}`),
      programId,
      approved: index % 2 === 0,
      memberIds: [at(studentIds, index * 2), at(studentIds, index * 2 + 1)],
      memberGithubIds: [
        at(studentGithubIds, index * 2),
        at(studentGithubIds, index * 2 + 1),
      ],
    })),
  );
  await prisma.team.createMany({
    data: teams.map((team, index) => ({
      id: team.id,
      programId: team.programId,
      name: `Team ${index}`,
      leaderId: at(team.memberIds, 0),
      applicantId: at(team.memberIds, 0),
      answers: {},
      applicationTemplateVersion: 1,
      status: team.approved ? ('APPROVED' as const) : ('SUBMITTED' as const),
      submittedAt: new Date(programStart.getTime() - index * 1000),
      processedAt: team.approved ? programStart : null,
    })),
  });
  await prisma.teamMember.createMany({
    data: teams.flatMap((team) =>
      team.memberIds.map((userId) => ({
        teamId: team.id,
        programId: team.programId,
        userId,
      })),
    ),
  });

  const approvedTeams = teams.filter((team) => team.approved);
  const repos = approvedTeams.map((team, index) => ({
    team,
    githubRepoId: REPO_ID_BASE + BigInt(index),
    publishedAt: new Date(now.getTime() - (index + 1) * 60 * 1000),
  }));
  await prisma.repo.createMany({
    data: repos.map((repo, index) => ({
      githubRepoId: repo.githubRepoId,
      ownerName: `query-growth-org/repo-${index}`,
      source: 'EXTERNAL_PUBLIC' as const,
      visibility: 'PUBLIC' as const,
      presence: 'PRESENT' as const,
      publishedAt: repo.publishedAt,
      lastSuccessAt: now,
    })),
  });
  await prisma.teamRepo.createMany({
    data: repos.map((repo) => ({
      teamId: repo.team.id,
      repoId: repo.githubRepoId,
      validFrom: programStart,
    })),
  });
  await prisma.contributionEvent.createMany({
    data: repos.flatMap((repo) =>
      repo.team.memberGithubIds.flatMap((authorGithubId, member) =>
        Array.from({ length: scale }, (_, index) =>
          (['COMMIT', 'PULL_REQUEST'] as const).map((kind) => ({
            repoId: repo.githubRepoId,
            kind,
            githubKey: `${member}-${index}`,
            authorGithubId,
            occurredAt: new Date(now.getTime() - (index + 1) * DAY_MS),
            firstSeenAt: now,
          })),
        ).flat(),
      ),
    ),
  });

  const targetProgramId = at(programIds, 0);
  const dueRequirements = milestones.filter(
    (milestone) =>
      milestone.programId === targetProgramId &&
      milestone.dueAt.getTime() < now.getTime(),
  );
  const targetSubmissions = approvedTeams
    .filter((team) => team.programId === targetProgramId)
    .flatMap((team) =>
      dueRequirements.map((milestone) => ({
        id: id(`submission-${team.id}-${milestone.requirementId}`),
        requirementId: milestone.requirementId,
        teamId: team.id,
        submittedById: at(team.memberIds, 0),
      })),
    );
  await prisma.submission.createMany({
    data: targetSubmissions.map((submission) => ({
      ...submission,
      status: 'SUBMITTED' as const,
      submittedAt: now,
    })),
  });
  await prisma.submissionHistory.createMany({
    data: targetSubmissions.map((submission) => ({
      id: `${submission.id}-history`,
      submissionId: submission.id,
      event: 'SUBMITTED' as const,
      revision: 1,
      actorId: submission.submittedById,
      createdAt: now,
    })),
  });

  return {
    scale,
    year,
    staffGithubId,
    studentGithubId: at(studentGithubIds, 0),
    targetProgramId,
    targetTeamId: at(teams, 0).id,
    targetProjectId: at(repos, 0).githubRepoId.toString(),
    profileUserId: at(studentIds, 0),
  };
}

export async function countQueryGrowthRows(
  prisma: PrismaClient,
  world: QueryGrowthWorld,
): Promise<Record<string, number>> {
  const targetRepoId = BigInt(world.targetProjectId);
  const [
    students,
    observations,
    programs,
    targetMilestones,
    targetTeams,
    approvedTeams,
    teamMembers,
    publicRepos,
    targetRepoContributions,
    contributions,
    targetSubmissions,
    profileProjects,
  ] = await Promise.all([
    prisma.user.count({ where: { id: SEEDED, type: 'STUDENT' } }),
    prisma.githubUserActivityObservation.count({
      where: { githubId: SEEDED_GITHUB_IDS },
    }),
    prisma.program.count({ where: { id: SEEDED } }),
    prisma.milestone.count({ where: { programId: world.targetProgramId } }),
    prisma.team.count({ where: { programId: world.targetProgramId } }),
    prisma.team.count({ where: { id: SEEDED, status: 'APPROVED' } }),
    prisma.teamMember.count({ where: { teamId: SEEDED } }),
    prisma.repo.count({
      where: { githubRepoId: SEEDED_REPO_IDS, visibility: 'PUBLIC' },
    }),
    prisma.contributionEvent.count({ where: { repoId: targetRepoId } }),
    prisma.contributionEvent.count({ where: { repoId: SEEDED_REPO_IDS } }),
    prisma.submission.count({
      where: { team: { programId: world.targetProgramId } },
    }),
    prisma.teamRepo.count({
      where: { team: { members: { some: { userId: world.profileUserId } } } },
    }),
  ]);
  return {
    students,
    observations,
    programs,
    targetMilestones,
    targetTeams,
    approvedTeams,
    teamMembers,
    publicRepos,
    targetRepoContributions,
    contributions,
    targetSubmissions,
    profileProjects,
  };
}

export async function removeQueryGrowthWorld(
  prisma: PrismaClient,
): Promise<void> {
  await prisma.submissionHistory.deleteMany({ where: { id: SEEDED } });
  await prisma.submission.deleteMany({ where: { id: SEEDED } });
  await prisma.contributionEvent.deleteMany({
    where: { repoId: SEEDED_REPO_IDS },
  });
  await prisma.teamRepo.deleteMany({ where: { repoId: SEEDED_REPO_IDS } });
  await prisma.repo.deleteMany({ where: { githubRepoId: SEEDED_REPO_IDS } });
  await prisma.teamMember.deleteMany({ where: { teamId: SEEDED } });
  await prisma.team.deleteMany({ where: { id: SEEDED } });
  await prisma.requirement.deleteMany({ where: { id: SEEDED } });
  await prisma.milestone.deleteMany({ where: { id: SEEDED } });
  await prisma.program.deleteMany({ where: { id: SEEDED } });
  await prisma.githubUserActivityObservation.deleteMany({
    where: { githubId: SEEDED_GITHUB_IDS },
  });
  await prisma.user.deleteMany({ where: { id: SEEDED } });
}
