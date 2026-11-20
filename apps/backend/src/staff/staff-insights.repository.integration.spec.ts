import { ValidationPipe } from '@nestjs/common';
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
import { StaffInsightsFinderRequestDto } from './dto/staff-insights-request.dto';
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
const WINDOW = {
  cutoff: CUTOFF,
  now: new Date('2117-07-01T00:00:00.000Z'),
  cutoffYear: YEAR,
  nowYear: YEAR,
};
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
        WINDOW,
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
        studentId: null,
        recentTotal: null,
        previousOverallRank: null,
        previousCohortRank: null,
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

    const rows = await repository.listPeriodLeaderCandidates({}, [], WINDOW);

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

    const rows = await repository.listRecentLeaderCandidates(WINDOW, []);

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
      {
        ...WINDOW,
        now: new Date('2118-01-01T00:00:00.000Z'),
        nowYear: YEAR + 1,
      },
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

  it('filters the student finder by approved published participation', async () => {
    await prisma.teamMember.create({
      data: {
        teamId: APPROVED_TEAM,
        programId: SCORED_PROGRAM_ID,
        userId: STUDENT_A,
      },
    });
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

    const page = await service.findStudents(
      { programId: SCORED_PROGRAM_ID, sort: 'name', direction: 'asc' },
      SCORECARD_NOW,
    );

    expect(page.total).toBe(2);
    expect(
      page.rows.map(({ githubLogin, programIds }) => [githubLogin, programIds]),
    ).toEqual([
      [STUDENT_A, [SCORED_PROGRAM_ID, SECOND_PROGRAM_ID]],
      [STUDENT_B, [SCORED_PROGRAM_ID]],
    ]);
    await expect(
      service.findStudents({ programId: DELETED_PROGRAM_ID }, SCORECARD_NOW),
    ).resolves.toMatchObject({ rows: [], total: 0 });
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
  const TIE_WINDOW = {
    cutoff: new Date('2112-03-01T00:00:00.000Z'),
    now: new Date('2112-03-31T00:00:00.000Z'),
    cutoffYear: TIE_YEAR,
    nowYear: TIE_YEAR,
  };
  const dept = '소프트웨어공학과';
  const tied = Array.from({ length: 14 }, (_, index) => ({
    id: `staff-insights-it-tie-${String(index).padStart(2, '0')}`,
    githubId: TIE_BASE + BigInt(index),
    login: `insights-tie-${String(index).padStart(2, '0')}`,
  }));
  const priorOnly = {
    id: 'staff-insights-it-tie-prior',
    githubId: TIE_BASE + 100n,
    login: 'insights-tie-prior',
  };

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [...tied, priorOnly].map((student) => ({
        id: student.id,
        githubId: student.githubId,
        nickname: student.login,
        type: 'STUDENT' as const,
        name: '합성 동점',
        department: student === priorOnly ? '합성 비SW 학과' : dept,
        departmentType: 'DEPARTMENT' as const,
        profileCreatedAt: CUTOFF,
        profileUpdatedAt: CUTOFF,
      })),
    });
    await prisma.githubUserActivityObservation.createMany({
      data: [...tied, priorOnly].flatMap((student, index) => {
        const current = {
          githubId: student.githubId,
          visibility: ActivityVisibility.PUBLIC,
          year: TIE_YEAR,
          commitCount: 3,
          observedAt: new Date('2112-03-04T00:00:00.000Z'),
        };
        const prior = {
          ...current,
          year: TIE_YEAR - 1,
          commitCount: student === priorOnly ? 5 : index === 0 ? 1 : 3,
          observedAt: new Date('2111-12-31T00:00:00.000Z'),
        };
        return student === priorOnly
          ? [prior]
          : [
              current,
              prior,
              {
                ...current,
                commitCount: 0,
                observedAt: new Date('2112-02-01T00:00:00.000Z'),
              },
            ];
      }),
    });
  });

  afterAll(async () => {
    const githubIds = [...tied, priorOnly].map((student) => student.githubId);
    await prisma.githubUserActivityObservation.deleteMany({
      where: { githubId: { in: githubIds } },
    });
    await prisma.user.deleteMany({ where: { githubId: { in: githubIds } } });
  });

  it('caps period and recent leaders at 10 but compares the full prior standings', async () => {
    const [period, recent] = await Promise.all([
      repository.listPeriodLeaderCandidates(
        { currentYear: TIE_YEAR },
        [dept],
        TIE_WINDOW,
      ),
      repository.listRecentLeaderCandidates(TIE_WINDOW, [dept]),
    ]);

    expect(period.map((row) => row.githubLogin)).toEqual(
      tied.slice(0, 10).map((student) => student.login),
    );
    expect(recent.map((row) => row.githubLogin)).toEqual(
      tied.slice(0, 10).map((student) => student.login),
    );
    expect(period[0]).toMatchObject({
      recentTotal: 3,
      previousOverallRank: 15,
      previousCohortRank: 14,
    });
  });
});

describe('StaffInsightsRepository summary recent coverage', () => {
  const prefix = 'staff-insights-it-coverage';
  const complete = '합성 최근 관측 완료';
  const incomplete = '합성 최근 관측 일부';
  const empty = '합성 최근 관측 0건';
  const before = new Date(CUTOFF.getTime() - DAY_MS);
  const after = new Date(CUTOFF.getTime() + DAY_MS);
  const students = [
    ['0-stale', incomplete],
    ['1-missing-baseline', incomplete],
    ['2-active', complete],
    ['3-no-activity', empty],
    ['4-inactive', complete],
    ...Array.from({ length: 4 }, (_, i) => [`${i + 5}-inactive`, incomplete]),
  ].map(([key, department], index) => ({
    id: `${prefix}-${key}`,
    nickname: `${prefix}-${key}`,
    githubId: 8_962_300_000_000n + BigInt(index),
    department,
  }));

  beforeAll(async () => {
    await prisma.user.createMany({
      data: students.map((student) =>
        canonicalUserCreateFromLabel('STUDENT', student),
      ),
    });
    await prisma.githubUserActivityObservation.createMany({
      data: students.flatMap((student, index) => {
        const baseline = {
          githubId: student.githubId,
          year: YEAR,
          visibility: ActivityVisibility.PUBLIC,
          observedAt: before,
          commitCount: index === 3 ? 0 : 3,
        };
        if (index === 0) return [baseline];
        if (index === 1) return [{ ...baseline, observedAt: after }];
        if (index === 2) {
          return [baseline, { ...baseline, commitCount: 6, observedAt: after }];
        }
        return [{ ...baseline, clockAt: after }];
      }),
    });
  });

  afterAll(async () => {
    const githubIds = students.map((student) => student.githubId);
    await prisma.githubUserActivityObservation.deleteMany({
      where: { githubId: { in: githubIds } },
    });
    await prisma.user.deleteMany({ where: { githubId: { in: githubIds } } });
  });

  it('distinguishes stale samples from unchanged reobservations in every recent summary', async () => {
    const year = { currentYear: YEAR };
    const [period, departments, attention, finder] = await Promise.all([
      repository.listPeriodLeaderCandidates(year, [], WINDOW),
      repository.listDepartmentMetrics(year, WINDOW),
      repository.listAttentionStudents(year, WINDOW),
      repository.findStudents(
        new StaffInsightsQueryService().finderQuery({
          search: prefix,
          recentActivity: 'inactive',
          sort: 'recentTotal',
        }),
        WINDOW,
      ),
    ]);

    const recentByLogin = new Map(
      period.map((row) => [row.githubLogin, row.recentTotal]),
    );
    expect(
      students
        .slice(0, 5)
        .map((student) => recentByLogin.get(student.nickname)),
    ).toEqual([null, null, 3, undefined, 0]);
    const byDepartment = new Map(
      departments.map((row) => [row.department, row.recentTotal]),
    );
    expect(
      [complete, incomplete, empty].map((department) =>
        byDepartment.get(department),
      ),
    ).toEqual([3, null, 0]);
    expect(attention.map((row) => row.githubLogin)).toEqual(
      students.slice(4, 8).map((student) => student.nickname),
    );
    expect(finder.rows.map((row) => row.githubLogin)).toEqual(
      students.slice(3).map((student) => student.nickname),
    );
    expect(finder.rows.every((row) => row.recentTotal === 0)).toBe(true);
  });
});

describe('StaffInsightsRepository student finder', () => {
  const prefix = 'staff-insights-it-finder';
  const year = 2088;
  const now = new Date('2088-07-01T00:00:00Z');
  const dept = '합성 탐색 학과';
  const githubId = (i: number) => 8_962_200_000_000n + BigInt(i);
  const login = (i: number) => `${prefix}${i === 22 ? '_' : '-'}${99 - i}`;
  const name = (i: number) => `${prefix} ${String(i).padStart(2, '0')}`;
  const studentId = (i: number) => String(980_000 + i);
  const service = new StaffInsightsService(
    repository,
    new RankingYearService(),
    new StaffInsightsQueryService(),
  );
  const findStudents = (request: StaffInsightsFinderRequestDto = {}) =>
    service.findStudents(
      { year: String(year), search: prefix, ...request },
      now,
    );

  beforeAll(async () => {
    await prisma.user.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        id: name(i),
        githubId: githubId(i),
        nickname: login(i),
        type: i === 24 ? 'UNSELECTED' : 'STUDENT',
        accountStatus: i === 23 ? 'DEACTIVATED' : 'ACTIVE',
        ...(i === 22 || i === 24
          ? {}
          : {
              name: name(i),
              studentId: studentId(i),
              department: dept,
              departmentType: 'DEPARTMENT' as const,
              profileCreatedAt: now,
              profileUpdatedAt: now,
            }),
      })),
    });
    const before = new Date('2088-05-31T00:00:00Z');
    const recent = {
      year,
      visibility: ActivityVisibility.PUBLIC,
      observedAt: new Date('2088-06-29T00:00:00Z'),
    };
    const inactive = {
      ...recent,
      githubId: githubId(0),
      commitCount: 5,
      issueCount: 1,
      starCount: 2,
    };
    const collaborative = {
      ...recent,
      githubId: githubId(20),
      commitCount: 10,
      pullRequestCount: 4,
      issueCount: 2,
      repositoryCount: 3,
      starCount: 8,
    };
    const high = {
      ...recent,
      githubId: githubId(21),
      commitCount: 40,
      repositoryCount: 2,
      starCount: 5,
    };
    await prisma.githubUserActivityObservation.createMany({
      data: [
        inactive,
        { ...inactive, observedAt: before },
        collaborative,
        {
          ...collaborative,
          observedAt: before,
          commitCount: 1,
          pullRequestCount: 0,
          starCount: 100,
        },
        high,
        { ...high, observedAt: before, commitCount: 39 },
        { ...recent, githubId: githubId(22), commitCount: 22 },
        {
          ...recent,
          githubId: githubId(1),
          commitCount: 200,
          visibility: ActivityVisibility.PRIVATE,
        },
        {
          ...recent,
          githubId: githubId(20),
          commitCount: 1,
          starCount: 50,
          year: year - 1,
          observedAt: new Date('2087-06-29T00:00:00Z'),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.githubUserActivityObservation.deleteMany({
      where: { githubId: { gte: githubId(0), lte: githubId(24) } },
    });
    await prisma.user.deleteMany({
      where: { id: { startsWith: `${prefix} ` } },
    });
  });

  it('paginates global activity order with stable ties and retains totals on an empty page', async () => {
    const [first, second, empty] = await Promise.all([
      findStudents(),
      findStudents({ page: 2 }),
      findStudents({ page: 3 }),
    ]);
    expect(first.rows).toHaveLength(20);
    expect(second.rows).toHaveLength(3);
    expect(
      [...first.rows, ...second.rows].map((row) => row.githubLogin),
    ).toEqual(
      [21, 20, 22, 0, ...Array.from({ length: 19 }, (_, i) => i + 1)].map(
        login,
      ),
    );
    expect(first.rows[1]).toEqual({
      name: name(20),
      githubLogin: login(20),
      studentId: studentId(20),
      major: null,
      total: 27,
      recentTotal: 13,
      collaborationRatio: 6 / 27,
      programIds: [],
    });
    expect(first.rows[4]).toMatchObject({
      total: 0,
      recentTotal: null,
      collaborationRatio: null,
    });
    expect(empty).toEqual({ rows: [], page: 3, pageSize: 20, total: 23 });
  });

  it('combines filters and compares only known recent activity', async () => {
    const active = await findStudents({
      department: dept,
      minActivity: 20,
      recentActivity: 'active',
      sort: 'recentTotal',
    });
    expect(active.rows.map((row) => row.githubLogin)).toEqual([
      login(20),
      login(21),
    ]);
    expect(active.total).toBe(2);
    await expect(
      findStudents({ recentActivity: 'inactive' }),
    ).resolves.toMatchObject({
      rows: [{ githubLogin: login(0), recentTotal: 0 }],
      total: 1,
    });
    await expect(findStudents({ department: '미등록' })).resolves.toMatchObject(
      {
        rows: [{ githubLogin: login(22), recentTotal: null }],
        total: 1,
      },
    );
  });

  it('scopes period totals without changing recent activity', async () => {
    const search = login(20);
    await expect(
      findStudents({ year: String(year - 1), search }),
    ).resolves.toMatchObject({
      rows: [{ total: 51, recentTotal: 13, collaborationRatio: 0 }],
    });
    await expect(findStudents({ year: 'all', search })).resolves.toMatchObject({
      rows: [{ total: 28, recentTotal: 13, collaborationRatio: 6 / 28 }],
    });
  });

  it('handles Seoul year rollover without treating a missing baseline as activity', async () => {
    const rollover = {
      year: 2096,
      visibility: ActivityVisibility.PUBLIC,
      observedAt: new Date('2095-12-31T15:30:00Z'),
    };
    const prior = {
      ...rollover,
      year: 2095,
      observedAt: new Date('2095-12-15T00:00:00Z'),
    };
    await prisma.githubUserActivityObservation.createMany({
      data: [
        { ...prior, githubId: githubId(2), commitCount: 10 },
        { ...rollover, githubId: githubId(2), commitCount: 12 },
        { ...rollover, githubId: githubId(3), commitCount: 7 },
        { ...rollover, githubId: githubId(4), commitCount: 3 },
        { ...prior, githubId: githubId(4), commitCount: 3 },
        {
          ...prior,
          githubId: githubId(4),
          commitCount: 1,
          observedAt: new Date('2095-11-20T00:00:00Z'),
        },
      ],
    });

    const page = await service.findStudents(
      { search: prefix, recentActivity: 'active', sort: 'recentTotal' },
      new Date('2095-12-31T16:00:00Z'),
    );

    expect(page.rows).toMatchObject([
      { githubLogin: login(3), recentTotal: 7 },
      { githubLogin: login(4), recentTotal: 5 },
    ]);
  });

  it('distinguishes a measured zero from stale-only data across the Seoul year boundary', async () => {
    const stale = {
      year: 2095,
      visibility: ActivityVisibility.PUBLIC,
      observedAt: new Date('2095-11-20T00:00:00Z'),
      commitCount: 5,
    };
    await prisma.githubUserActivityObservation.createMany({
      data: [
        { ...stale, githubId: githubId(5) },
        { ...stale, githubId: githubId(6) },
        {
          ...stale,
          githubId: githubId(5),
          year: 2096,
          observedAt: new Date('2095-12-31T15:30:00Z'),
          commitCount: 0,
        },
      ],
    });

    const now = new Date('2095-12-31T16:00:00Z');
    const query = { year: '2095', search: prefix, minActivity: 1 };
    const page = await service.findStudents(query, now);
    expect(page.rows.find((row) => row.githubLogin === login(5))).toMatchObject(
      {
        recentTotal: 0,
      },
    );
    expect(page.rows.find((row) => row.githubLogin === login(6))).toMatchObject(
      {
        recentTotal: null,
      },
    );

    const inactive = await service.findStudents(
      { ...query, recentActivity: 'inactive' },
      now,
    );
    expect(inactive.rows.map((row) => row.githubLogin)).toEqual([login(5)]);
  });

  it.each([
    [login(20).toUpperCase(), 20],
    [` ${name(0).toUpperCase()} `, 0],
    [studentId(1), 1],
    [`${prefix}_`, 22],
  ] as const)(
    'searches literal identity substring %s',
    async (search, index) => {
      await expect(findStudents({ search })).resolves.toMatchObject({
        rows: [{ githubLogin: login(index) }],
        total: 1,
      });
    },
  );

  it.each([
    ['name', 'asc', [20, 21, 22]],
    ['studentId', 'desc', [1, 0, 22]],
    ['collaborationRatio', 'desc', [17, 18, 19]],
  ] as const)(
    'orders by %s %s before the page cut',
    async (sort, direction, indices) => {
      const page = await findStudents({ sort, direction, page: 2 });
      expect(page.rows.map((row) => row.githubLogin)).toEqual(
        indices.map(login),
      );
    },
  );

  it('transforms numeric query parameters and rejects invalid selectors', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const metadata = {
      type: 'query' as const,
      metatype: StaffInsightsFinderRequestDto,
    };
    const query: unknown = await pipe.transform(
      { search: prefix, year: String(year), page: '2', minActivity: '20' },
      metadata,
    );
    if (!(query instanceof StaffInsightsFinderRequestDto)) {
      throw new Error('Expected a validated finder request');
    }

    await expect(service.findStudents(query, now)).resolves.toMatchObject({
      rows: [],
      page: 2,
      total: 3,
    });
    for (const invalid of [
      { sort: 'major' },
      { recentActivity: 'unknown' },
      { direction: 'up' },
      { page: '0' },
      { minActivity: '-1' },
      { pageSize: '5000' },
    ]) {
      await expect(pipe.transform(invalid, metadata)).rejects.toMatchObject({
        status: 400,
      });
    }
    expect(() => findStudents({ year: '1999' })).toThrow(
      'year must be omitted',
    );
  });
});
