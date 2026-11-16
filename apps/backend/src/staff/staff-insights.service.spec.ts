import { StaffInsightsService } from './staff-insights.service';
import type {
  StaffInsightsActivityRecord,
  StaffInsightsBaselineRecord,
  StaffInsightsProgramRecord,
  StaffInsightsRepository,
  StaffInsightsStudentRecord,
} from './staff-insights.repository';
import { RankingYearService } from '../ranking/ranking-year.service';
import {
  StaffInsightsQueryService,
  DEPARTMENT_COHORTS,
} from './staff-insights-query.service';
import { StaffInsightsResponseDto } from './dto/staff-insights-response.dto';

type Store = Pick<
  StaffInsightsRepository,
  | 'listStudents'
  | 'listApprovedParticipations'
  | 'listActivityTotals'
  | 'findActivityDataAsOf'
  | 'listActivityYears'
  | 'listActivityBaselines'
  | 'listActivityByYear'
  | 'listPublishedPrograms'
  | 'listProgramApplicationCounts'
  | 'listProgramCompletion'
  | 'listProgramOutcomes'
>;

function repository(): Store {
  return {
    listStudents: jest.fn().mockResolvedValue([
      {
        id: 'student-sw',
        githubId: 11n,
        githubLogin: 'sw-login',
        name: '합성 SW',
        department: '소프트웨어공학과',
      },
      {
        id: 'student-non',
        githubId: 22n,
        githubLogin: 'non-login',
        name: '합성 비SW',
        department: '국어국문학과',
      },
      {
        id: 'student-empty',
        githubId: 33n,
        githubLogin: 'empty-login',
        name: null,
        department: null,
      },
    ]),
    listApprovedParticipations: jest.fn().mockResolvedValue([
      {
        programId: 'program-basic',
        programName: '합성 기초',
        userIds: ['student-sw', 'student-non'],
      },
    ]),
    listActivityTotals: jest.fn().mockResolvedValue([
      {
        githubId: 11n,
        commitCount: 10,
        pullRequestCount: 2,
        issueCount: 1,
        repositoryCount: 2,
        starCount: 4,
      },
      {
        githubId: 22n,
        commitCount: 1,
        pullRequestCount: 0,
        issueCount: 0,
        repositoryCount: 0,
        starCount: 0,
      },
    ]),
    findActivityDataAsOf: jest
      .fn()
      .mockResolvedValue(new Date('2026-08-01T00:00:00.000Z')),
    listActivityYears: jest.fn().mockResolvedValue([2026, 2025]),
    listActivityBaselines: jest.fn().mockResolvedValue([]),
    listActivityByYear: jest.fn().mockResolvedValue([]),
    listPublishedPrograms: jest
      .fn()
      .mockResolvedValue([program('program-basic', '합성 기초')]),
    listProgramApplicationCounts: jest.fn().mockResolvedValue([]),
    listProgramCompletion: jest.fn().mockResolvedValue([]),
    listProgramOutcomes: jest.fn().mockResolvedValue([]),
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

function serviceFor(store: Store): StaffInsightsService {
  return new StaffInsightsService(
    store as StaffInsightsRepository,
    new RankingYearService(),
    new StaffInsightsQueryService(),
  );
}

function student(
  githubId: bigint,
  department: string | null,
  overrides: Partial<StaffInsightsStudentRecord> = {},
): StaffInsightsStudentRecord {
  return {
    id: `user-${githubId}`,
    githubId,
    githubLogin: `login-${githubId}`,
    name: `학생 ${githubId}`,
    department,
    ...overrides,
  };
}

function totals(
  githubId: bigint,
  [commitCount, pullRequestCount, issueCount, repositoryCount, starCount]: [
    number,
    number,
    number,
    number,
    number,
  ],
): StaffInsightsActivityRecord {
  return {
    githubId,
    commitCount,
    pullRequestCount,
    issueCount,
    repositoryCount,
    starCount,
  };
}

function yearRow(
  githubId: bigint,
  year: number,
  [commitCount, pullRequestCount, issueCount, repositoryCount]: [
    number,
    number,
    number,
    number,
  ],
): StaffInsightsBaselineRecord {
  return {
    githubId,
    year,
    commitCount,
    pullRequestCount,
    issueCount,
    repositoryCount,
  };
}

function storeWith(input: {
  readonly students: readonly StaffInsightsStudentRecord[];
  readonly totals?: readonly StaffInsightsActivityRecord[];
  readonly baselines?: readonly StaffInsightsBaselineRecord[];
  readonly byYear?: Readonly<
    Record<number, readonly StaffInsightsBaselineRecord[]>
  >;
}): Store {
  const store = repository();
  (store.listStudents as jest.Mock).mockResolvedValue(input.students);
  (store.listApprovedParticipations as jest.Mock).mockResolvedValue([]);
  (store.listActivityTotals as jest.Mock).mockResolvedValue(input.totals ?? []);
  (store.listActivityBaselines as jest.Mock).mockResolvedValue(
    input.baselines ?? [],
  );
  (store.listActivityByYear as jest.Mock).mockImplementation((year: number) =>
    Promise.resolve(input.byYear?.[year] ?? []),
  );
  return store;
}

const SW = '소프트웨어공학과';
const NON_SW = '국어국문학과';
const NOW_2026 = new Date('2026-11-16T00:00:00+09:00');
const CUTOFF_2026 = new Date('2026-10-17T00:00:00+09:00');
const NOW_2027 = new Date('2027-01-10T00:00:00+09:00');
const CUTOFF_2027 = new Date('2026-12-11T00:00:00+09:00');

describe('StaffInsightsService', () => {
  it('splits ranking and participation by department cohort', async () => {
    const store = repository();
    const service = serviceFor(store);

    const summary = await service.summarize({ kind: 'all' }, NOW_2026);

    expect(store.listActivityTotals).toHaveBeenCalledWith({});
    expect(store.findActivityDataAsOf).toHaveBeenCalledTimes(1);
    expect(store.listActivityYears).toHaveBeenCalledTimes(1);
    const sw = summary.cohorts.find(
      (row) => row.cohort === DEPARTMENT_COHORTS.SW_MAJOR,
    );
    const non = summary.cohorts.find(
      (row) => row.cohort === DEPARTMENT_COHORTS.NON_SW,
    );
    const missing = summary.cohorts.find(
      (row) => row.cohort === DEPARTMENT_COHORTS.UNREGISTERED,
    );
    expect(sw).toMatchObject({
      studentCount: 1,
      activeStudentCount: 1,
      issueCount: 1,
      repositoryCount: 2,
      starCount: 4,
      total: 19,
      participantCount: 1,
    });
    expect(non).toMatchObject({
      studentCount: 1,
      activeStudentCount: 1,
      total: 1,
      participantCount: 1,
    });
    expect(missing).toMatchObject({
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
      (store.listApprovedParticipations as jest.Mock).mockResolvedValue([
        {
          programId: 'program-full',
          programName: '가 성과 프로그램',
          userIds: ['student-sw', 'student-non'],
        },
        {
          programId: 'program-full',
          programName: '가 성과 프로그램',
          userIds: ['student-empty', 'student-sw'],
        },
        {
          programId: 'program-deleted',
          programName: '삭제된 프로그램',
          userIds: ['student-non'],
        },
      ]);
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
    });

    it('summarizes pooled ratio and repeat participants across published programs', async () => {
      const store = scorecardStore();
      (store.listPublishedPrograms as jest.Mock).mockResolvedValue([
        program('program-full', '가 성과 프로그램'),
        program('program-empty', '나 모집 프로그램'),
        program('program-other', '다 다른 프로그램'),
      ]);
      (store.listApprovedParticipations as jest.Mock).mockResolvedValue([
        {
          programId: 'program-full',
          programName: '가 성과 프로그램',
          userIds: ['student-sw', 'student-non', 'student-empty'],
        },
        {
          programId: 'program-other',
          programName: '다 다른 프로그램',
          userIds: ['student-sw'],
        },
        {
          programId: 'program-deleted',
          programName: '삭제된 프로그램',
          userIds: ['student-non'],
        },
      ]);

      const summary = await serviceFor(store).summarize(
        { kind: 'all' },
        NOW_2026,
      );

      expect(summary.programSummary).toEqual({
        programCount: 3,
        recruitingCount: 0,
        approvedParticipantCount: 4,
        uniqueParticipantCount: 3,
        competitionRatio: 4,
        repeatParticipantCount: 1,
        repeatParticipantRate: 33,
      });
    });

    it('keeps outcome null when repos exist but no student is approved', async () => {
      const store = scorecardStore();
      (store.listApprovedParticipations as jest.Mock).mockResolvedValue([]);

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

  it('passes only a numeric year into activity totals', async () => {
    const store = repository();
    const service = serviceFor(store);

    await service.summarize({ kind: 'calendar', year: 2026 }, NOW_2026);

    expect(store.listActivityTotals).toHaveBeenCalledWith({
      currentYear: 2026,
    });
  });

  describe('period leaders', () => {
    it('orders leaders with the ranking comparator and numbers ranks ordinally', async () => {
      const store = storeWith({
        students: [
          student(1n, SW, { githubLogin: 'zed' }),
          student(2n, SW, { githubLogin: 'Bravo' }),
          student(3n, SW, { githubLogin: 'alpha' }),
          student(4n, SW, { githubLogin: 'top' }),
        ],
        totals: [
          totals(1n, [8, 2, 0, 0, 0]),
          totals(2n, [5, 5, 0, 0, 0]),
          totals(3n, [5, 5, 0, 0, 0]),
          totals(4n, [1, 1, 1, 1, 20]),
        ],
      });

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
      });
    });

    it('never lists a student whose total is 0', async () => {
      const store = storeWith({
        students: [student(1n, SW), student(2n, SW), student(3n, SW)],
        totals: [totals(1n, [1, 0, 0, 0, 0]), totals(2n, [0, 0, 0, 0, 0])],
      });

      const summary = await serviceFor(store).summarize(
        { kind: 'all' },
        NOW_2026,
      );

      expect(summary.leaders.period.all.map((row) => row.githubLogin)).toEqual([
        'login-1',
      ]);
    });

    it('caps every list at 10 rows', async () => {
      const ids = Array.from({ length: 12 }, (_, index) => BigInt(index + 1));
      const store = storeWith({
        students: ids.map((id) => student(id, SW)),
        totals: ids.map((id) => totals(id, [Number(id), 0, 0, 0, 0])),
      });

      const summary = await serviceFor(store).summarize(
        { kind: 'all' },
        NOW_2026,
      );

      expect(summary.leaders.period.all).toHaveLength(10);
      expect(summary.leaders.period.swMajor).toHaveLength(10);
      expect(summary.leaders.period.all.map((row) => row.rank)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      ]);
      expect(summary.leaders.period.all[0]?.total).toBe(12);
      expect(summary.leaders.period.all[9]?.total).toBe(3);
    });

    it('splits cohorts and lists an unregistered student only in all', async () => {
      const store = storeWith({
        students: [
          student(1n, SW),
          student(2n, NON_SW),
          student(3n, null, { name: null }),
        ],
        totals: [
          totals(1n, [3, 0, 0, 0, 0]),
          totals(2n, [2, 0, 0, 0, 0]),
          totals(3n, [5, 0, 0, 0, 0]),
        ],
      });

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

    it('skips a student whose GitHub login is empty', async () => {
      const store = storeWith({
        students: [student(1n, SW, { githubLogin: '' }), student(2n, SW)],
        totals: [totals(1n, [9, 0, 0, 0, 0]), totals(2n, [1, 0, 0, 0, 0])],
        baselines: [yearRow(1n, 2026, [0, 0, 0, 0])],
        byYear: { 2026: [yearRow(1n, 2026, [9, 0, 0, 0])] },
      });

      const { leaders } = await serviceFor(store).summarize(
        { kind: 'all' },
        NOW_2026,
      );

      expect(leaders.period.all.map((row) => row.githubLogin)).toEqual([
        'login-2',
      ]);
      expect(leaders.recent.all).toEqual([]);
    });
  });

  describe('recent leaders', () => {
    it('subtracts a same-year baseline taken 30 days before now', async () => {
      const store = storeWith({
        students: [student(1n, SW)],
        baselines: [yearRow(1n, 2026, [4, 1, 2, 0])],
        byYear: { 2026: [yearRow(1n, 2026, [10, 3, 2, 1])] },
      });

      const summary = await serviceFor(store).summarize(
        { kind: 'all' },
        NOW_2026,
      );

      expect(store.listActivityBaselines).toHaveBeenCalledWith(
        2026,
        CUTOFF_2026,
      );
      expect(store.listActivityByYear).toHaveBeenCalledTimes(1);
      expect(store.listActivityByYear).toHaveBeenCalledWith(2026);
      expect(summary.recentWindow).toEqual({
        from: CUTOFF_2026,
        to: NOW_2026,
      });
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

    it('counts the new year from 0 and uses the baseline for the old year across a year boundary', async () => {
      const store = storeWith({
        students: [student(1n, SW)],
        baselines: [yearRow(1n, 2026, [7, 1, 0, 0])],
        byYear: {
          2026: [yearRow(1n, 2026, [10, 1, 0, 0])],
          2027: [yearRow(1n, 2027, [5, 0, 1, 0])],
        },
      });

      const summary = await serviceFor(store).summarize(
        { kind: 'all' },
        NOW_2027,
      );

      expect(store.listActivityBaselines).toHaveBeenCalledWith(
        2026,
        CUTOFF_2027,
      );
      expect(store.listActivityByYear).toHaveBeenCalledWith(2026);
      expect(store.listActivityByYear).toHaveBeenCalledWith(2027);
      expect(summary.leaders.recent.all[0]).toMatchObject({
        commitCount: 8,
        pullRequestCount: 0,
        issueCount: 1,
        repositoryCount: 0,
        total: 9,
      });
    });

    it('excludes a student whose current cutoff-year row has no baseline', async () => {
      const store = storeWith({
        students: [student(1n, SW), student(2n, SW)],
        baselines: [yearRow(2n, 2026, [1, 0, 0, 0])],
        byYear: {
          2026: [
            yearRow(1n, 2026, [50, 0, 0, 0]),
            yearRow(2n, 2026, [2, 0, 0, 0]),
          ],
          2027: [yearRow(1n, 2027, [5, 0, 0, 0])],
        },
      });

      const { recent } = (
        await serviceFor(store).summarize({ kind: 'all' }, NOW_2027)
      ).leaders;

      expect(recent.all.map((row) => [row.githubLogin, row.total])).toEqual([
        ['login-2', 1],
      ]);
    });

    it('includes a student whose only current row is in the new year with delta = current', async () => {
      const store = storeWith({
        students: [student(1n, NON_SW)],
        byYear: { 2027: [yearRow(1n, 2027, [3, 2, 1, 1])] },
      });

      const { recent } = (
        await serviceFor(store).summarize({ kind: 'all' }, NOW_2027)
      ).leaders;

      expect(recent.nonSw).toEqual([
        expect.objectContaining({
          rank: 1,
          githubLogin: 'login-1',
          commitCount: 3,
          pullRequestCount: 2,
          issueCount: 1,
          repositoryCount: 1,
          total: 7,
        }),
      ]);
    });

    it('drops a student whose counts did not change since the cutoff', async () => {
      const store = storeWith({
        students: [student(1n, SW)],
        baselines: [yearRow(1n, 2026, [4, 1, 0, 2])],
        byYear: { 2026: [yearRow(1n, 2026, [4, 1, 0, 2])] },
      });

      const { recent } = (
        await serviceFor(store).summarize({ kind: 'all' }, NOW_2026)
      ).leaders;

      expect(recent.all).toEqual([]);
    });

    it('clamps each metric at 0 when the baseline exceeds the current row', async () => {
      const store = storeWith({
        students: [student(1n, SW)],
        baselines: [yearRow(1n, 2026, [9, 0, 5, 0])],
        byYear: { 2026: [yearRow(1n, 2026, [4, 2, 1, 0])] },
      });

      const { recent } = (
        await serviceFor(store).summarize({ kind: 'all' }, NOW_2026)
      ).leaders;

      expect(recent.all[0]).toMatchObject({
        commitCount: 0,
        pullRequestCount: 2,
        issueCount: 0,
        repositoryCount: 0,
        total: 2,
      });
    });

    it('excludes Star from the recent total and row', async () => {
      const store = storeWith({
        students: [student(1n, SW)],
        totals: [totals(1n, [3, 0, 0, 0, 40])],
        baselines: [yearRow(1n, 2026, [1, 0, 0, 0])],
        byYear: { 2026: [yearRow(1n, 2026, [3, 0, 0, 0])] },
      });

      const { leaders } = await serviceFor(store).summarize(
        { kind: 'all' },
        NOW_2026,
      );

      expect(leaders.period.all[0]).toMatchObject({
        starCount: 40,
        total: 43,
      });
      expect(leaders.recent.all[0]?.total).toBe(2);
      expect(leaders.recent.all[0]).not.toHaveProperty('starCount');
    });
  });

  it('adds rounded activity per student and flags departments under 3 students', async () => {
    const store = storeWith({
      students: [
        student(1n, SW),
        student(2n, SW),
        student(3n, SW),
        student(4n, NON_SW),
        student(5n, NON_SW),
      ],
      totals: [
        totals(1n, [11, 0, 0, 0, 0]),
        totals(4n, [3, 0, 0, 0, 0]),
        totals(5n, [2, 0, 0, 0, 0]),
      ],
    });

    const { departments } = await serviceFor(store).summarize(
      { kind: 'all' },
      NOW_2026,
    );

    expect(departments.find((row) => row.department === SW)).toMatchObject({
      studentCount: 3,
      total: 11,
      activityPerStudent: 3.7,
      sampleTooSmall: false,
    });
    expect(departments.find((row) => row.department === NON_SW)).toMatchObject({
      studentCount: 2,
      total: 5,
      activityPerStudent: 2.5,
      sampleTooSmall: true,
    });
  });

  it('passes the request clock through summarizeFromRequest', async () => {
    const store = repository();

    const summary = await serviceFor(store).summarizeFromRequest(
      { year: '2026' },
      NOW_2027,
    );

    expect(summary.recentWindow).toEqual({ from: CUTOFF_2027, to: NOW_2027 });
    expect(store.listActivityTotals).toHaveBeenCalledWith({
      currentYear: 2026,
    });
  });

  it('never serializes studentId, githubId or the user id in leader rows', async () => {
    const store = storeWith({
      students: [
        student(987654321n, SW, { id: 'user-secret-cuid', name: '합성 학생' }),
      ],
      totals: [totals(987654321n, [5, 0, 0, 0, 0])],
      baselines: [yearRow(987654321n, 2026, [1, 0, 0, 0])],
      byYear: { 2026: [yearRow(987654321n, 2026, [5, 0, 0, 0])] },
    });

    const summary = await serviceFor(store).summarize(
      { kind: 'all' },
      NOW_2026,
    );
    const body = JSON.stringify(StaffInsightsResponseDto.from(summary));

    expect(summary.leaders.period.all).toHaveLength(1);
    expect(summary.leaders.recent.all).toHaveLength(1);
    expect(body).toContain('"githubLogin":"login-987654321"');
    expect(body).not.toContain('studentId');
    expect(body).not.toContain('githubId');
    expect(body).not.toContain('user-secret-cuid');
    expect(body).not.toContain('"987654321"');
  });
});
