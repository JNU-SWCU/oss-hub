import { StaffInsightsService } from './staff-insights.service';
import type {
  StaffInsightsDepartmentMetricsRecord,
  StaffInsightsLeaderCandidateRecord,
  StaffInsightsPeriodLeaderCandidateRecord,
  StaffInsightsProgramRecord,
  StaffInsightsRepository,
} from './staff-insights.repository';
import { RankingYearService } from '../ranking/ranking-year.service';
import {
  StaffInsightsQueryService,
  DEPARTMENT_COHORTS,
  SW_MAJOR_DEPARTMENTS,
} from './staff-insights-query.service';
import { StaffInsightsResponseDto } from './dto/staff-insights-response.dto';

type Store = Pick<
  StaffInsightsRepository,
  | 'listDepartmentMetrics'
  | 'listPeriodLeaderCandidates'
  | 'listRecentLeaderCandidates'
  | 'listAttentionStudents'
  | 'findActivityDataAsOf'
  | 'listActivityYears'
  | 'listPublishedPrograms'
  | 'listProgramParticipantDepartments'
  | 'countPublishedParticipants'
  | 'listProgramApplicationCounts'
  | 'listProgramCompletion'
  | 'listProgramOutcomes'
>;

const SW = '소프트웨어공학과';
const NON_SW = '국어국문학과';
const NOW_2026 = new Date('2026-11-16T00:00:00+09:00');
const CUTOFF_2026 = new Date('2026-10-17T00:00:00+09:00');
const WINDOW_2026 = {
  cutoff: CUTOFF_2026,
  now: NOW_2026,
  cutoffYear: 2026,
  nowYear: 2026,
};
const NOW_2027 = new Date('2027-01-10T00:00:00+09:00');
const CUTOFF_2027 = new Date('2026-12-11T00:00:00+09:00');
const WINDOW_2027 = {
  cutoff: CUTOFF_2027,
  now: NOW_2027,
  cutoffYear: 2026,
  nowYear: 2027,
};

function metrics(
  department: string | null,
  overrides: Partial<StaffInsightsDepartmentMetricsRecord> = {},
): StaffInsightsDepartmentMetricsRecord {
  return {
    department,
    studentCount: 1,
    activeStudentCount: 0,
    total: 0,
    recentTotal: null,
    participantCount: 0,
    ...overrides,
  };
}

function candidate(
  githubId: bigint,
  department: string | null,
  [commitCount, pullRequestCount, issueCount, repositoryCount, starCount]: [
    number,
    number,
    number,
    number,
    number,
  ],
  overrides: Partial<StaffInsightsPeriodLeaderCandidateRecord> = {},
): StaffInsightsPeriodLeaderCandidateRecord {
  return {
    githubId,
    githubLogin: `login-${githubId}`,
    name: `학생 ${githubId}`,
    department,
    commitCount,
    pullRequestCount,
    issueCount,
    repositoryCount,
    starCount,
    total:
      commitCount + pullRequestCount + issueCount + repositoryCount + starCount,
    studentId: null,
    recentTotal: null,
    previousOverallRank: null,
    previousCohortRank: null,
    ...overrides,
  };
}

function program(
  id: string,
  name: string,
  overrides: Partial<StaffInsightsProgramRecord> = {},
): StaffInsightsProgramRecord {
  return {
    id,
    name,
    category: 'BASIC',
    applicationStartAt: new Date('2026-02-01T00:00:00.000Z'),
    applicationEndAt: new Date('2026-02-28T00:00:00.000Z'),
    startAt: new Date('2026-03-02T00:00:00.000Z'),
    endAt: new Date('2026-06-30T00:00:00.000Z'),
    ...overrides,
  };
}

function repository(): Store {
  return {
    listDepartmentMetrics: jest.fn().mockResolvedValue([
      metrics(SW, {
        activeStudentCount: 1,
        total: 19,
        participantCount: 1,
      }),
      metrics(NON_SW, {
        activeStudentCount: 1,
        total: 1,
        participantCount: 1,
      }),
      metrics(null),
    ]),
    listPeriodLeaderCandidates: jest.fn().mockResolvedValue([]),
    listRecentLeaderCandidates: jest.fn().mockResolvedValue([]),
    listAttentionStudents: jest.fn().mockResolvedValue([]),
    findActivityDataAsOf: jest
      .fn()
      .mockResolvedValue(new Date('2026-08-01T00:00:00.000Z')),
    listActivityYears: jest.fn().mockResolvedValue([2026, 2025]),
    listPublishedPrograms: jest
      .fn()
      .mockResolvedValue([program('program-basic', '합성 기초')]),
    listProgramParticipantDepartments: jest.fn().mockResolvedValue([
      { programId: 'program-basic', department: SW, participantCount: 1 },
      { programId: 'program-basic', department: NON_SW, participantCount: 1 },
    ]),
    countPublishedParticipants: jest.fn().mockResolvedValue({
      uniqueParticipantCount: 2,
      repeatParticipantCount: 0,
    }),
    listProgramApplicationCounts: jest.fn().mockResolvedValue([]),
    listProgramCompletion: jest.fn().mockResolvedValue([]),
    listProgramOutcomes: jest.fn().mockResolvedValue([]),
  };
}

function serviceFor(store: Store): StaffInsightsService {
  return new StaffInsightsService(
    store as StaffInsightsRepository,
    new RankingYearService(),
    new StaffInsightsQueryService(),
  );
}

function withLeaders(
  period: readonly StaffInsightsPeriodLeaderCandidateRecord[],
  recent: readonly StaffInsightsLeaderCandidateRecord[] = [],
): Store {
  const store = repository();
  (store.listPeriodLeaderCandidates as jest.Mock).mockResolvedValue(period);
  (store.listRecentLeaderCandidates as jest.Mock).mockResolvedValue(recent);
  return store;
}

describe('StaffInsightsService', () => {
  it('folds department aggregates into cohorts and program cohort counts', async () => {
    const store = repository();

    const summary = await serviceFor(store).summarize(
      { kind: 'all' },
      NOW_2026,
    );

    expect(store.listDepartmentMetrics).toHaveBeenCalledWith({}, WINDOW_2026);
    expect(store.listPeriodLeaderCandidates).toHaveBeenCalledWith(
      {},
      SW_MAJOR_DEPARTMENTS,
      WINDOW_2026,
    );
    expect(store.findActivityDataAsOf).toHaveBeenCalledTimes(1);
    expect(store.listActivityYears).toHaveBeenCalledTimes(1);
    const cohort = (name: string) =>
      summary.cohorts.find((row) => row.cohort === name);
    expect(cohort(DEPARTMENT_COHORTS.SW_MAJOR)).toMatchObject({
      studentCount: 1,
      activeStudentCount: 1,
      total: 19,
      participantCount: 1,
    });
    expect(cohort(DEPARTMENT_COHORTS.NON_SW)).toMatchObject({
      studentCount: 1,
      activeStudentCount: 1,
      total: 1,
      participantCount: 1,
    });
    expect(cohort(DEPARTMENT_COHORTS.UNREGISTERED)).toMatchObject({
      studentCount: 1,
      activeStudentCount: 0,
      total: 0,
      participantCount: 0,
    });
    expect(summary.programs[0]).toMatchObject({
      programId: 'program-basic',
      swMajorCount: 1,
      nonSwCount: 1,
      unregisteredCount: 0,
      participantCount: 2,
    });
  });

  it('merges null and blank departments into one 미등록 row', async () => {
    const store = repository();
    (store.listDepartmentMetrics as jest.Mock).mockResolvedValue([
      metrics(null, { studentCount: 2, recentTotal: 4 }),
      metrics('  ', { studentCount: 1, total: 3, recentTotal: 0 }),
    ]);

    const { departments } = await serviceFor(store).summarize(
      { kind: 'all' },
      NOW_2026,
    );

    expect(departments).toEqual([
      expect.objectContaining({
        department: '미등록',
        cohort: DEPARTMENT_COHORTS.UNREGISTERED,
        studentCount: 3,
        total: 3,
        recentPerStudent: 1.3,
      }),
    ]);
  });

  describe('program scorecard', () => {
    function scorecardStore(): Store {
      const store = repository();
      (store.listPublishedPrograms as jest.Mock).mockResolvedValue([
        program('program-full', '가 성과 프로그램', {
          category: 'CAPSTONE',
          applicationStartAt: new Date('2026-11-01T00:00:00+09:00'),
          applicationEndAt: new Date('2026-11-30T00:00:00+09:00'),
        }),
        program('program-empty', '나 모집 프로그램'),
      ]);
      (store.listProgramParticipantDepartments as jest.Mock).mockResolvedValue([
        { programId: 'program-full', department: SW, participantCount: 1 },
        { programId: 'program-full', department: NON_SW, participantCount: 1 },
        { programId: 'program-full', department: null, participantCount: 1 },
      ]);
      (store.countPublishedParticipants as jest.Mock).mockResolvedValue({
        uniqueParticipantCount: 3,
        repeatParticipantCount: 1,
      });
      (store.listProgramApplicationCounts as jest.Mock).mockResolvedValue([
        { programId: 'program-full', appliedCount: 5, approvedCount: 2 },
        { programId: 'program-empty', appliedCount: 3, approvedCount: 0 },
      ]);
      (store.listProgramCompletion as jest.Mock).mockResolvedValue([
        {
          programId: 'program-full',
          dueRequirementCount: 6,
          submittedRequirementCount: 5,
        },
      ]);
      (store.listProgramOutcomes as jest.Mock).mockResolvedValue([
        {
          programId: 'program-full',
          repoTeamCount: 2,
          activeTeamCount: 1,
          contributionCount: 10,
        },
      ]);
      return store;
    }

    it('scores every published program including ones without approvals', async () => {
      const store = scorecardStore();

      const summary = await serviceFor(store).summarize(
        { kind: 'all' },
        NOW_2026,
      );

      expect(store.listProgramCompletion).toHaveBeenCalledWith(NOW_2026);
      expect(store.listProgramOutcomes).toHaveBeenCalledWith(NOW_2026);
      expect(summary.programs).toEqual([
        {
          programId: 'program-full',
          name: '가 성과 프로그램',
          category: 'CAPSTONE',
          startAt: new Date('2026-03-02T00:00:00.000Z'),
          endAt: new Date('2026-06-30T00:00:00.000Z'),
          recruiting: true,
          swMajorCount: 1,
          nonSwCount: 1,
          unregisteredCount: 1,
          participantCount: 3,
          appliedCount: 5,
          approvedCount: 2,
          competitionRatio: 2.5,
          dueRequirementCount: 6,
          submittedRequirementCount: 5,
          completionRate: 83,
          contributionCount: 10,
          activeTeamCount: 1,
          repoTeamCount: 2,
          contributionsPerParticipant: 3.3,
        },
        {
          programId: 'program-empty',
          name: '나 모집 프로그램',
          category: 'BASIC',
          startAt: new Date('2026-03-02T00:00:00.000Z'),
          endAt: new Date('2026-06-30T00:00:00.000Z'),
          recruiting: false,
          swMajorCount: 0,
          nonSwCount: 0,
          unregisteredCount: 0,
          participantCount: 0,
          appliedCount: 3,
          approvedCount: 0,
          competitionRatio: null,
          dueRequirementCount: 0,
          submittedRequirementCount: 0,
          completionRate: null,
          contributionCount: 0,
          activeTeamCount: 0,
          repoTeamCount: 0,
          contributionsPerParticipant: null,
        },
      ]);
      expect(summary.programSummary).toEqual({
        programCount: 2,
        recruitingCount: 1,
        approvedParticipantCount: 3,
        uniqueParticipantCount: 3,
        competitionRatio: 4,
        repeatParticipantCount: 1,
        repeatParticipantRate: 33,
      });
    });

    it('keeps outcome null when repos exist but no student is approved', async () => {
      const store = scorecardStore();
      (store.listProgramParticipantDepartments as jest.Mock).mockResolvedValue(
        [],
      );
      (store.countPublishedParticipants as jest.Mock).mockResolvedValue({
        uniqueParticipantCount: 0,
        repeatParticipantCount: 0,
      });

      const summary = await serviceFor(store).summarize(
        { kind: 'all' },
        NOW_2026,
      );

      expect(summary.programs[0]).toMatchObject({
        participantCount: 0,
        repoTeamCount: 2,
        contributionsPerParticipant: null,
      });
      expect(summary.programSummary).toMatchObject({
        uniqueParticipantCount: 0,
        repeatParticipantRate: null,
      });
    });

    it('serializes program dates and the summary through the response DTO', async () => {
      const summary = await serviceFor(scorecardStore()).summarize(
        { kind: 'all' },
        NOW_2026,
      );

      const dto = StaffInsightsResponseDto.from(summary);

      expect(dto.programs[0]).toMatchObject({
        startAt: '2026-03-02T00:00:00.000Z',
        endAt: '2026-06-30T00:00:00.000Z',
        competitionRatio: 2.5,
      });
      expect(dto.programSummary.programCount).toBe(2);
    });
  });

  it('passes only a numeric year into the activity aggregates', async () => {
    const store = repository();

    await serviceFor(store).summarize(
      { kind: 'calendar', year: 2026 },
      NOW_2026,
    );

    expect(store.listDepartmentMetrics).toHaveBeenCalledWith(
      { currentYear: 2026 },
      WINDOW_2026,
    );
    expect(store.listPeriodLeaderCandidates).toHaveBeenCalledWith(
      { currentYear: 2026 },
      SW_MAJOR_DEPARTMENTS,
      WINDOW_2026,
    );
    expect(store.listAttentionStudents).toHaveBeenCalledWith(
      { currentYear: 2026 },
      WINDOW_2026,
    );
  });

  describe('leaders', () => {
    it('keeps the SQL ranking order and numbers ranks ordinally', async () => {
      const store = withLeaders([
        candidate(4n, SW, [1, 1, 1, 1, 20], {
          githubLogin: 'top',
          studentId: '990004',
        }),
        candidate(1n, SW, [8, 2, 0, 0, 0], { githubLogin: 'zed' }),
        candidate(3n, SW, [5, 5, 0, 0, 0], { githubLogin: 'alpha' }),
        candidate(2n, SW, [5, 5, 0, 0, 0], { githubLogin: 'Bravo' }),
      ]);

      const summary = await serviceFor(store).summarize(
        { kind: 'all' },
        NOW_2026,
      );

      expect(
        summary.leaders.period.all.map((row) => [row.rank, row.githubLogin]),
      ).toEqual([
        [1, 'top'],
        [2, 'zed'],
        [3, 'alpha'],
        [4, 'Bravo'],
      ]);
      expect(summary.leaders.period.all[0]).toEqual({
        rank: 1,
        name: '학생 4',
        githubLogin: 'top',
        department: SW,
        cohort: DEPARTMENT_COHORTS.SW_MAJOR,
        commitCount: 1,
        pullRequestCount: 1,
        issueCount: 1,
        repositoryCount: 1,
        starCount: 20,
        total: 24,
        studentId: '990004',
        major: null,
        recentTotal: null,
        previousRank: null,
        collaborationRatio: 2 / 24,
      });
    });

    it('caps every period and recent cohort list at 10 rows', async () => {
      const rows = Array.from({ length: 26 }, (_, index) => {
        const id = 26 - index;
        return candidate(BigInt(id), index % 2 === 0 ? SW : NON_SW, [
          id,
          0,
          0,
          0,
          0,
        ]);
      });
      const store = withLeaders(rows, rows);

      const summary = await serviceFor(store).summarize(
        { kind: 'all' },
        NOW_2026,
      );

      expect(summary.leaders.period.all.map((row) => row.rank)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      ]);
      expect(summary.leaders.period.swMajor).toHaveLength(10);
      expect(summary.leaders.period.nonSw).toHaveLength(10);
      expect(summary.leaders.period.all[9]?.total).toBe(17);
      expect(summary.leaders.recent.all).toHaveLength(10);
      expect(summary.leaders.recent.swMajor).toHaveLength(10);
      expect(summary.leaders.recent.nonSw).toHaveLength(10);
    });

    it('uses the full prior rank for each view and distinguishes zero recent activity from unknown', async () => {
      const store = withLeaders([
        candidate(1n, SW, [5, 0, 0, 0, 0], {
          recentTotal: 0,
          previousOverallRank: 28,
          previousCohortRank: 15,
        }),
        candidate(2n, NON_SW, [4, 0, 0, 0, 0]),
      ]);
      const summary = await serviceFor(store).summarize(
        { kind: 'calendar', year: 2026 },
        NOW_2026,
      );
      const { all, swMajor, nonSw } = summary.leaders.period;

      expect(all[0]).toMatchObject({ recentTotal: 0, previousRank: 28 });
      expect(swMajor[0]?.previousRank).toBe(15);
      expect(nonSw[0]).toMatchObject({ recentTotal: null, previousRank: null });
    });

    it('splits cohorts and lists an unregistered student only in all', async () => {
      const store = withLeaders([
        candidate(3n, null, [5, 0, 0, 0, 0], { name: null }),
        candidate(1n, SW, [3, 0, 0, 0, 0]),
        candidate(2n, NON_SW, [2, 0, 0, 0, 0]),
      ]);

      const { period } = (
        await serviceFor(store).summarize({ kind: 'all' }, NOW_2026)
      ).leaders;

      expect(period.all.map((row) => row.githubLogin)).toEqual([
        'login-3',
        'login-1',
        'login-2',
      ]);
      expect(period.all[0]).toMatchObject({
        name: null,
        department: null,
        cohort: DEPARTMENT_COHORTS.UNREGISTERED,
      });
      expect(period.swMajor.map((row) => [row.rank, row.githubLogin])).toEqual([
        [1, 'login-1'],
      ]);
      expect(period.nonSw.map((row) => [row.rank, row.githubLogin])).toEqual([
        [1, 'login-2'],
      ]);
    });

    it('reads recent leaders for the 30-day window and omits Star from the row', async () => {
      const store = withLeaders([], [candidate(1n, SW, [6, 2, 0, 1, 0])]);

      const summary = await serviceFor(store).summarize(
        { kind: 'all' },
        NOW_2026,
      );

      expect(store.listRecentLeaderCandidates).toHaveBeenCalledWith(
        WINDOW_2026,
        SW_MAJOR_DEPARTMENTS,
      );
      expect(summary.recentWindow).toEqual({ from: CUTOFF_2026, to: NOW_2026 });
      expect(summary.leaders.recent.all).toEqual([
        {
          rank: 1,
          name: '학생 1',
          githubLogin: 'login-1',
          department: SW,
          cohort: DEPARTMENT_COHORTS.SW_MAJOR,
          commitCount: 6,
          pullRequestCount: 2,
          issueCount: 0,
          repositoryCount: 1,
          total: 9,
        },
      ]);
    });

    it('passes both years across a year boundary', async () => {
      const store = repository();

      await serviceFor(store).summarize({ kind: 'all' }, NOW_2027);

      expect(store.listRecentLeaderCandidates).toHaveBeenCalledWith(
        WINDOW_2027,
        SW_MAJOR_DEPARTMENTS,
      );
    });
  });

  it('adds recent activity per student for complete coverage, preserving measured zero', async () => {
    const store = repository();
    (store.listDepartmentMetrics as jest.Mock).mockResolvedValue([
      metrics(SW, { studentCount: 3, total: 11, recentTotal: 2 }),
      metrics(NON_SW, { studentCount: 2, total: 5, recentTotal: 0 }),
      metrics(null, { studentCount: 2, recentTotal: 2 }),
      metrics('  '),
    ]);

    const { departments } = await serviceFor(store).summarize(
      { kind: 'all' },
      NOW_2026,
    );

    expect(departments.find((row) => row.department === SW)).toMatchObject({
      studentCount: 3,
      total: 11,
      activityPerStudent: 3.7,
      major: null,
      recentPerStudent: 0.7,
      sampleTooSmall: false,
    });
    expect(departments.find((row) => row.department === NON_SW)).toMatchObject({
      studentCount: 2,
      total: 5,
      activityPerStudent: 2.5,
      recentPerStudent: 0,
      sampleTooSmall: true,
    });
    expect(
      departments.find((row) => row.department === '미등록')?.recentPerStudent,
    ).toBeNull();
  });

  it('passes the request clock through summarizeFromRequest', async () => {
    const store = repository();

    const summary = await serviceFor(store).summarizeFromRequest(
      { year: '2026' },
      NOW_2027,
    );

    expect(summary.recentWindow).toEqual({ from: CUTOFF_2027, to: NOW_2027 });
    expect(store.listDepartmentMetrics).toHaveBeenCalledWith(
      { currentYear: 2026 },
      WINDOW_2027,
    );
  });

  it('serializes staff-only fields without changing recent leaders or exposing internal ids', async () => {
    const store = withLeaders(
      [candidate(987654321n, SW, [5, 1, 1, 0, 1], { studentId: '990001' })],
      [candidate(987654321n, SW, [4, 0, 0, 0, 0], { studentId: '990001' })],
    );
    const attention = {
      name: '합성 학생',
      githubLogin: 'synthetic-attention',
      studentId: '990002',
      department: NON_SW,
      total: 3,
    };
    (store.listAttentionStudents as jest.Mock).mockResolvedValue([
      { ...attention, id: 'internal-id' },
    ]);

    const summary = await serviceFor(store).summarize(
      { kind: 'all' },
      NOW_2026,
    );
    const dto = StaffInsightsResponseDto.from(summary);
    const body = JSON.stringify(dto);

    expect(body).toContain('"githubLogin":"login-987654321"');
    expect(dto.leaders.period.all[0]).toMatchObject({
      studentId: '990001',
      major: null,
      recentTotal: null,
      previousRank: null,
      collaborationRatio: 0.25,
    });
    expect(dto.leaders.recent.all[0]).not.toHaveProperty('studentId');
    expect(dto.attentionStudents).toEqual([
      { ...attention, lastActiveAt: null },
    ]);
    expect(dto.firstContributionCount).toBeNull();
    expect(body).not.toContain('githubId');
    expect(body).not.toContain('"987654321"');
    expect(body).not.toContain('internal-id');
  });
});
