import {
  ActivityVisibility,
  ApplicationStatus,
  ContributionKind,
  ProgramCategory,
  ProgramLifecycle,
  SubmissionStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { RankingYearService } from '../ranking/ranking-year.service';
import { canonicalUserCreateFromLabel } from '../users/canonical-user-fixture';
import { StaffInsightsQueryService } from './staff-insights-query.service';
import { StaffInsightsRepository } from './staff-insights.repository';
import { StaffInsightsService } from './staff-insights.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new StaffInsightsRepository(prisma);
const GITHUB_ID = 8_962_000_000_001n;
const YEAR = 2117;
const PUBLIC_ROW = {
  githubId: GITHUB_ID,
  year: YEAR,
  visibility: ActivityVisibility.PUBLIC,
  commitCount: 10,
  pullRequestCount: 2,
  issueCount: 1,
  repositoryCount: 1,
  starCount: 9,
  observedAt: new Date('2117-03-04T00:00:00.000Z'),
};
const PRIVATE_ROW = {
  ...PUBLIC_ROW,
  visibility: ActivityVisibility.PRIVATE,
  commitCount: 3,
  pullRequestCount: 4,
  issueCount: 5,
  repositoryCount: 6,
  starCount: 0,
  observedAt: new Date('2118-03-04T00:00:00.000Z'),
};

const BASELINE_GITHUB_ID = 8_962_000_000_002n;
const ACTIVE_STUDENT_ID = 'staff-insights-it-active-student';
const DEACTIVATED_STUDENT_ID = 'staff-insights-it-deactivated-student';
const CUTOFF = new Date('2117-06-01T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

async function purge(): Promise<void> {
  await prisma.githubUserActivityObservation.deleteMany({
    where: { githubId: { in: [GITHUB_ID, BASELINE_GITHUB_ID] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [ACTIVE_STUDENT_ID, DEACTIVATED_STUDENT_ID] } },
  });
}

function baselineObservation(
  visibility: ActivityVisibility,
  observedAt: Date,
  commitCount: number,
) {
  return {
    githubId: BASELINE_GITHUB_ID,
    year: YEAR,
    visibility,
    commitCount,
    pullRequestCount: commitCount + 1,
    issueCount: commitCount + 2,
    repositoryCount: commitCount + 3,
    starCount: 0,
    observedAt,
  };
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await purge();
  await prisma.githubUserActivityObservation.create({ data: PUBLIC_ROW });
});

afterEach(async () => {
  await purge();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('StaffInsightsRepository PUBLIC activity scope', () => {
  it.each([{ currentYear: YEAR }, { currentYear: undefined }] as const)(
    'preserves public counts and nine stars with year $currentYear',
    async ({ currentYear }) => {
      await prisma.githubUserActivityObservation.create({ data: PRIVATE_ROW });
      await prisma.user.create({
        data: {
          id: ACTIVE_STUDENT_ID,
          githubId: GITHUB_ID,
          nickname: 'insights-active',
          type: 'STUDENT',
          name: '홍길동',
          department: '소프트웨어공학과',
          departmentType: 'DEPARTMENT',
          profileCreatedAt: CUTOFF,
          profileUpdatedAt: CUTOFF,
        },
      });

      const rows = await repository.listPeriodLeaderCandidates(
        { currentYear },
        [],
      );

      expect(rows.find((row) => row.githubId === GITHUB_ID)).toEqual({
        githubId: GITHUB_ID,
        githubLogin: 'insights-active',
        name: '홍길동',
        department: '소프트웨어공학과',
        total: 23,
        commitCount: 10,
        pullRequestCount: 2,
        issueCount: 1,
        repositoryCount: 1,
        starCount: 9,
      });
    },
  );

  it('does not expose a private-only year in staff filters', async () => {
    const before = await repository.listActivityYears();
    await prisma.githubUserActivityObservation.create({
      data: { ...PRIVATE_ROW, year: YEAR + 1 },
    });

    const years = await repository.listActivityYears();

    expect(years).toEqual(before);
    expect(years).toContain(YEAR);
    expect(years).not.toContain(YEAR + 1);
  });

  it('does not advance staff freshness on a private observation', async () => {
    const before = await repository.findActivityDataAsOf();
    await prisma.githubUserActivityObservation.create({ data: PRIVATE_ROW });

    const dataAsOf = await repository.findActivityDataAsOf();

    expect(dataAsOf).toEqual(before);
    expect(dataAsOf).toEqual(PUBLIC_ROW.observedAt);
  });
});

describe('StaffInsightsRepository student identity and baselines', () => {
  it('ranks active students only and drops an empty login', async () => {
    await prisma.githubUserActivityObservation.create({
      data: { ...PUBLIC_ROW, githubId: BASELINE_GITHUB_ID },
    });
    await prisma.user.createMany({
      data: [
        {
          id: ACTIVE_STUDENT_ID,
          githubId: GITHUB_ID,
          nickname: 'insights-active',
          type: 'STUDENT',
          name: '홍길동',
          department: '소프트웨어공학과',
          departmentType: 'DEPARTMENT',
          profileCreatedAt: CUTOFF,
          profileUpdatedAt: CUTOFF,
        },
        {
          id: DEACTIVATED_STUDENT_ID,
          githubId: BASELINE_GITHUB_ID,
          nickname: 'insights-deactivated',
          type: 'STUDENT',
          name: '홍길동',
          department: '소프트웨어공학과',
          departmentType: 'DEPARTMENT',
          profileCreatedAt: CUTOFF,
          profileUpdatedAt: CUTOFF,
          accountStatus: 'DEACTIVATED',
        },
      ],
    });

    const rows = await repository.listPeriodLeaderCandidates({}, []);

    expect(rows.map((row) => row.githubLogin)).toContain('insights-active');
    expect(rows.map((row) => row.githubLogin)).not.toContain(
      'insights-deactivated',
    );
  });

  it('subtracts the baseline strictly before the cutoff from the latest standing', async () => {
    await prisma.user.create({
      data: {
        id: ACTIVE_STUDENT_ID,
        githubId: BASELINE_GITHUB_ID,
        nickname: 'insights-recent',
        type: 'STUDENT',
        name: '홍길동',
        department: '소프트웨어공학과',
        departmentType: 'DEPARTMENT',
        profileCreatedAt: CUTOFF,
        profileUpdatedAt: CUTOFF,
      },
    });
    await prisma.githubUserActivityObservation.createMany({
      data: [
        baselineObservation(
          ActivityVisibility.PUBLIC,
          new Date(CUTOFF.getTime() - 2 * DAY_MS),
          10,
        ),
        baselineObservation(ActivityVisibility.PUBLIC, CUTOFF, 20),
        baselineObservation(
          ActivityVisibility.PUBLIC,
          new Date(CUTOFF.getTime() + 5 * DAY_MS),
          30,
        ),
        baselineObservation(
          ActivityVisibility.PRIVATE,
          new Date(CUTOFF.getTime() - DAY_MS),
          99,
        ),
      ],
    });

    const rows = await repository.listRecentLeaderCandidates(
      { cutoff: CUTOFF, cutoffYear: YEAR, nowYear: YEAR },
      [],
    );

    expect(rows.find((row) => row.githubId === BASELINE_GITHUB_ID)).toEqual(
      expect.objectContaining({
        commitCount: 20,
        pullRequestCount: 20,
        issueCount: 20,
        repositoryCount: 20,
        starCount: 0,
        total: 80,
      }),
    );
  });

  it('excludes a student whose cutoff-year standing has no baseline', async () => {
    await prisma.user.create({
      data: {
        id: ACTIVE_STUDENT_ID,
        githubId: BASELINE_GITHUB_ID,
        nickname: 'insights-recent',
        type: 'STUDENT',
        name: '홍길동',
        department: '소프트웨어공학과',
        departmentType: 'DEPARTMENT',
        profileCreatedAt: CUTOFF,
        profileUpdatedAt: CUTOFF,
      },
    });
    await prisma.githubUserActivityObservation.create({
      data: baselineObservation(
        ActivityVisibility.PUBLIC,
        new Date(CUTOFF.getTime() + DAY_MS),
        30,
      ),
    });

    const rows = await repository.listRecentLeaderCandidates(
      { cutoff: CUTOFF, cutoffYear: YEAR, nowYear: YEAR + 1 },
      [],
    );

    expect(rows.some((row) => row.githubId === BASELINE_GITHUB_ID)).toBe(false);
  });
});

const SCORECARD = 'staff-insights-it-scorecard:';
const SCORECARD_NOW = new Date('2117-05-01T00:00:00.000Z');
const SCORED_PROGRAM_ID = `${SCORECARD}program`;
const SECOND_PROGRAM_ID = `${SCORECARD}second-program`;
const DELETED_PROGRAM_ID = `${SCORECARD}deleted-program`;
const SCORECARD_PROGRAM_IDS = [
  SCORED_PROGRAM_ID,
  SECOND_PROGRAM_ID,
  DELETED_PROGRAM_ID,
];
const STUDENT_A = `${SCORECARD}student-a`;
const STUDENT_B = `${SCORECARD}student-b`;
const STUDENT_C = `${SCORECARD}student-c`;
const STUDENT_D = `${SCORECARD}student-d`;
const SCORECARD_USERS = [STUDENT_A, STUDENT_B, STUDENT_C, STUDENT_D];
const APPROVED_TEAM = `${SCORECARD}approved-team`;
const ARCHIVED_TEAM = `${SCORECARD}archived-team`;
const EARLY_REPO_ID = 8_962_000_100_001n;
const LATER_REPO_ID = 8_962_000_100_002n;
const ARCHIVED_REPO_ID = 8_962_000_100_003n;
const SCORECARD_REPOS = [EARLY_REPO_ID, LATER_REPO_ID, ARCHIVED_REPO_ID];

async function purgeScorecard(): Promise<void> {
  await prisma.contributionEvent.deleteMany({
    where: { repoId: { in: SCORECARD_REPOS } },
  });
  await prisma.teamRepo.deleteMany({
    where: { repoId: { in: SCORECARD_REPOS } },
  });
  await prisma.repo.deleteMany({
    where: { githubRepoId: { in: SCORECARD_REPOS } },
  });
  await prisma.submission.deleteMany({
    where: { team: { programId: { in: SCORECARD_PROGRAM_IDS } } },
  });
  await prisma.teamMember.deleteMany({
    where: { programId: { in: SCORECARD_PROGRAM_IDS } },
  });
  await prisma.team.deleteMany({
    where: { programId: { in: SCORECARD_PROGRAM_IDS } },
  });
  await prisma.requirement.deleteMany({
    where: { milestone: { programId: { in: SCORECARD_PROGRAM_IDS } } },
  });
  await prisma.milestone.deleteMany({
    where: { programId: { in: SCORECARD_PROGRAM_IDS } },
  });
  await prisma.program.deleteMany({
    where: { id: { in: SCORECARD_PROGRAM_IDS } },
  });
  await prisma.user.deleteMany({ where: { id: { in: SCORECARD_USERS } } });
}

async function seedProgram(
  id: string,
  overrides: {
    readonly lifecycle?: ProgramLifecycle;
    readonly applicationStartAt?: Date;
    readonly applicationEndAt?: Date;
  } = {},
): Promise<void> {
  await prisma.program.create({
    data: {
      id,
      name: id,
      category: ProgramCategory.CAPSTONE,
      applicationTemplateKey: 'capstone-v1',
      applicationTemplateVersion: 1,
      applicationStartAt:
        overrides.applicationStartAt ?? new Date('2117-01-01T00:00:00.000Z'),
      applicationEndAt:
        overrides.applicationEndAt ?? new Date('2117-02-01T00:00:00.000Z'),
      startAt: new Date('2117-03-01T00:00:00.000Z'),
      endAt: new Date('2117-06-30T00:00:00.000Z'),
      description: 'Synthetic scorecard fixture',
      lifecycle: overrides.lifecycle ?? ProgramLifecycle.PUBLISHED,
    },
  });
}

async function seedTeam(
  id: string,
  programId: string,
  applicantId: string,
  status: ApplicationStatus,
  archivedAt: Date | null = null,
): Promise<void> {
  await prisma.team.create({
    data: {
      id,
      programId,
      name: id,
      leaderId: applicantId,
      applicantId,
      answers: {},
      applicationTemplateVersion: 1,
      status,
      archivedAt,
    },
  });
}

async function seedRequirement(
  id: string,
  milestoneId: string,
  required: boolean,
): Promise<void> {
  await prisma.requirement.create({
    data: { id, milestoneId, name: id, required, sortOrder: 1 },
  });
}

async function seedSubmission(
  teamId: string,
  requirementId: string,
  status: SubmissionStatus,
): Promise<void> {
  await prisma.submission.create({
    data: { teamId, requirementId, status, submittedById: STUDENT_A },
  });
}

function event(
  repoId: bigint,
  kind: ContributionKind,
  occurredAt: string,
): {
  repoId: bigint;
  kind: ContributionKind;
  githubKey: string;
  occurredAt: Date;
  firstSeenAt: Date;
} {
  return {
    repoId,
    kind,
    githubKey: `${kind}-${occurredAt}`,
    occurredAt: new Date(occurredAt),
    firstSeenAt: new Date(occurredAt),
  };
}

async function seedScorecard(): Promise<void> {
  for (const [index, id] of SCORECARD_USERS.entries()) {
    await prisma.user.create({
      data: canonicalUserCreateFromLabel('STUDENT', {
        id,
        githubId: 8_962_000_200_001n + BigInt(index),
        nickname: id,
        name: id,
      }),
    });
  }
  await seedProgram(SCORED_PROGRAM_ID);
  await seedProgram(SECOND_PROGRAM_ID, {
    applicationStartAt: new Date('2117-04-01T00:00:00.000Z'),
    applicationEndAt: new Date('2117-06-01T00:00:00.000Z'),
  });
  await seedProgram(DELETED_PROGRAM_ID, {
    lifecycle: ProgramLifecycle.DELETED,
  });

  await seedTeam(
    APPROVED_TEAM,
    SCORED_PROGRAM_ID,
    STUDENT_A,
    ApplicationStatus.APPROVED,
  );
  await prisma.teamMember.create({
    data: {
      teamId: APPROVED_TEAM,
      programId: SCORED_PROGRAM_ID,
      userId: STUDENT_B,
    },
  });
  await seedTeam(
    `${SCORECARD}submitted-team`,
    SCORED_PROGRAM_ID,
    STUDENT_C,
    ApplicationStatus.SUBMITTED,
  );
  await seedTeam(
    ARCHIVED_TEAM,
    SCORED_PROGRAM_ID,
    STUDENT_D,
    ApplicationStatus.APPROVED,
    new Date('2117-04-10T00:00:00.000Z'),
  );

  const dueMilestone = `${SCORECARD}due-milestone`;
  const futureMilestone = `${SCORECARD}future-milestone`;
  await prisma.milestone.createMany({
    data: [
      {
        id: dueMilestone,
        programId: SCORED_PROGRAM_ID,
        name: 'due',
        startAt: new Date('2117-03-01T00:00:00.000Z'),
        dueAt: new Date('2117-04-01T00:00:00.000Z'),
      },
      {
        id: futureMilestone,
        programId: SCORED_PROGRAM_ID,
        name: 'future',
        startAt: new Date('2117-03-01T00:00:00.000Z'),
        dueAt: new Date('2117-06-01T00:00:00.000Z'),
      },
    ],
  });
  const submitted = `${SCORECARD}req-submitted`;
  const rejected = `${SCORECARD}req-rejected`;
  const optional = `${SCORECARD}req-optional`;
  const notDue = `${SCORECARD}req-not-due`;
  await seedRequirement(submitted, dueMilestone, true);
  await seedRequirement(rejected, dueMilestone, true);
  await seedRequirement(optional, dueMilestone, false);
  await seedRequirement(notDue, futureMilestone, true);
  await seedSubmission(APPROVED_TEAM, submitted, SubmissionStatus.SUBMITTED);
  await seedSubmission(APPROVED_TEAM, rejected, SubmissionStatus.REJECTED);
  await seedSubmission(APPROVED_TEAM, optional, SubmissionStatus.SUBMITTED);
  await seedSubmission(APPROVED_TEAM, notDue, SubmissionStatus.SUBMITTED);
  await seedSubmission(ARCHIVED_TEAM, submitted, SubmissionStatus.SUBMITTED);

  await prisma.repo.createMany({
    data: SCORECARD_REPOS.map((githubRepoId) => ({
      githubRepoId,
      ownerName: 'synthetic',
      source: 'EXTERNAL_PUBLIC' as const,
    })),
  });
  await prisma.teamRepo.createMany({
    data: [
      {
        teamId: APPROVED_TEAM,
        repoId: EARLY_REPO_ID,
        validFrom: new Date('2117-01-01T00:00:00.000Z'),
        validTo: new Date('2117-03-15T00:00:00.000Z'),
      },
      {
        teamId: APPROVED_TEAM,
        repoId: LATER_REPO_ID,
        validFrom: new Date('2117-03-15T00:00:00.000Z'),
      },
      {
        teamId: ARCHIVED_TEAM,
        repoId: ARCHIVED_REPO_ID,
        validFrom: new Date('2117-01-01T00:00:00.000Z'),
      },
    ],
  });
  await prisma.contributionEvent.createMany({
    data: [
      event(EARLY_REPO_ID, ContributionKind.COMMIT, '2117-02-15T00:00:00Z'),
      event(EARLY_REPO_ID, ContributionKind.ISSUE, '2117-03-05T00:00:00Z'),
      event(EARLY_REPO_ID, ContributionKind.COMMIT, '2117-03-20T00:00:00Z'),
      event(LATER_REPO_ID, ContributionKind.ISSUE, '2117-03-10T00:00:00Z'),
      event(LATER_REPO_ID, ContributionKind.COMMIT, '2117-03-20T00:00:00Z'),
      event(
        LATER_REPO_ID,
        ContributionKind.PULL_REQUEST,
        '2117-04-01T00:00:00Z',
      ),
      event(LATER_REPO_ID, ContributionKind.COMMIT, '2117-04-20T00:00:00Z'),
      event(LATER_REPO_ID, ContributionKind.RELEASE, '2117-03-25T00:00:00Z'),
      event(LATER_REPO_ID, ContributionKind.COMMIT, '2117-05-10T00:00:00Z'),
      event(ARCHIVED_REPO_ID, ContributionKind.COMMIT, '2117-03-20T00:00:00Z'),
    ],
  });
}

describe('StaffInsightsRepository program scorecard', () => {
  const service = new StaffInsightsService(
    repository,
    new RankingYearService(),
    new StaffInsightsQueryService(),
  );

  beforeEach(async () => {
    await purgeScorecard();
    await seedScorecard();
  });

  afterEach(async () => {
    await purgeScorecard();
  });

  it('lists only published programs and counts non-archived teams', async () => {
    const programs = await repository.listPublishedPrograms();
    const counts = await repository.listProgramApplicationCounts();

    const ids = programs.map((row) => row.id);
    expect(ids).toEqual(
      expect.arrayContaining([SCORED_PROGRAM_ID, SECOND_PROGRAM_ID]),
    );
    expect(ids).not.toContain(DELETED_PROGRAM_ID);
    expect(counts.find((row) => row.programId === SCORED_PROGRAM_ID)).toEqual({
      programId: SCORED_PROGRAM_ID,
      appliedCount: 2,
      approvedCount: 1,
    });
  });

  it('counts only due required pairs and excludes rejected submissions', async () => {
    const rows = await repository.listProgramCompletion(SCORECARD_NOW);

    expect(rows.find((row) => row.programId === SCORED_PROGRAM_ID)).toEqual({
      programId: SCORED_PROGRAM_ID,
      dueRequirementCount: 2,
      submittedRequirementCount: 1,
    });
  });

  it('counts contributions inside both the program and team repo windows', async () => {
    const rows = await repository.listProgramOutcomes(SCORECARD_NOW);

    expect(rows.find((row) => row.programId === SCORED_PROGRAM_ID)).toEqual({
      programId: SCORED_PROGRAM_ID,
      repoTeamCount: 1,
      activeTeamCount: 1,
      contributionCount: 4,
    });
  });

  it('scores the program row and counts repeat students across published programs only', async () => {
    const before = await service.summarize({ kind: 'all' }, SCORECARD_NOW);
    await seedTeam(
      `${SCORECARD}second-team`,
      SECOND_PROGRAM_ID,
      STUDENT_A,
      ApplicationStatus.APPROVED,
    );
    await seedTeam(
      `${SCORECARD}deleted-team`,
      DELETED_PROGRAM_ID,
      STUDENT_B,
      ApplicationStatus.APPROVED,
    );

    const after = await service.summarize({ kind: 'all' }, SCORECARD_NOW);

    expect(
      after.programs.find((row) => row.programId === SCORED_PROGRAM_ID),
    ).toMatchObject({
      recruiting: false,
      participantCount: 2,
      appliedCount: 2,
      approvedCount: 1,
      competitionRatio: 2,
      completionRate: 50,
      contributionsPerParticipant: 2,
    });
    expect(
      after.programs.find((row) => row.programId === SECOND_PROGRAM_ID),
    ).toMatchObject({ recruiting: true, approvedCount: 1 });
    expect(
      after.programs.some((row) => row.programId === DELETED_PROGRAM_ID),
    ).toBe(false);
    expect(after.programSummary.programCount).toBe(
      before.programSummary.programCount,
    );
    expect(after.programSummary.uniqueParticipantCount).toBe(
      before.programSummary.uniqueParticipantCount,
    );
    expect(after.programSummary.repeatParticipantCount).toBe(
      before.programSummary.repeatParticipantCount + 1,
    );
  });
});

describe('StaffInsightsRepository leader candidates bound', () => {
  const TIE_YEAR = 2112;
  const TIE_BASE = 8_962_100_000_000n;
  const tied = Array.from({ length: 12 }, (_, index) => ({
    id: `staff-insights-it-tie-${String(index).padStart(2, '0')}`,
    githubId: TIE_BASE + BigInt(index),
    login: `insights-tie-${String(index).padStart(2, '0')}`,
  }));

  beforeAll(async () => {
    await prisma.user.createMany({
      data: tied.map((student) => ({
        id: student.id,
        githubId: student.githubId,
        nickname: student.login,
        type: 'STUDENT' as const,
        name: '합성 동점',
        department: '소프트웨어공학과',
        departmentType: 'DEPARTMENT' as const,
        profileCreatedAt: CUTOFF,
        profileUpdatedAt: CUTOFF,
      })),
    });
    await prisma.githubUserActivityObservation.createMany({
      data: tied.map((student) => ({
        githubId: student.githubId,
        year: TIE_YEAR,
        visibility: ActivityVisibility.PUBLIC,
        commitCount: 3,
        pullRequestCount: 0,
        issueCount: 0,
        repositoryCount: 0,
        starCount: 0,
        observedAt: new Date('2112-03-04T00:00:00.000Z'),
      })),
    });
  });

  afterAll(async () => {
    const githubIds = tied.map((student) => student.githubId);
    await prisma.githubUserActivityObservation.deleteMany({
      where: { githubId: { in: githubIds } },
    });
    await prisma.user.deleteMany({ where: { githubId: { in: githubIds } } });
  });

  it('returns at most ten tied leaders per list, ordered by login', async () => {
    const rows = await repository.listPeriodLeaderCandidates(
      { currentYear: TIE_YEAR },
      ['소프트웨어공학과'],
    );

    expect(rows.map((row) => row.githubLogin)).toEqual(
      tied.slice(0, 10).map((student) => student.login),
    );
  });
});
