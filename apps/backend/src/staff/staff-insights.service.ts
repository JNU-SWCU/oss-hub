import { Injectable } from '@nestjs/common';
import type { ProgramCategory } from '@prisma/client';
import {
  StaffInsightsRepository,
  type StaffInsightsApplicationCountRecord,
  type StaffInsightsBaselineRecord,
  type StaffInsightsCompletionRecord,
  type StaffInsightsOutcomeRecord,
  type StaffInsightsParticipationRecord,
  type StaffInsightsProgramRecord,
  type StaffInsightsStudentRecord,
} from './staff-insights.repository';
import {
  RankingYearService,
  type ActivityCounts,
  type RankedActivity,
} from '../ranking/ranking-year.service';
import {
  StaffInsightsQueryService,
  DepartmentCohort,
  InsightsYearScope,
  DEPARTMENT_COHORTS,
} from './staff-insights-query.service';

export interface StaffInsightsMetrics {
  readonly studentCount: number;
  readonly activeStudentCount: number;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
  readonly total: number;
  readonly participantCount: number;
}

export interface StaffInsightsCohortRow extends StaffInsightsMetrics {
  readonly cohort: DepartmentCohort;
}

export interface StaffInsightsDepartmentRow extends StaffInsightsMetrics {
  readonly department: string;
  readonly cohort: DepartmentCohort;
  readonly activityPerStudent: number;
  readonly sampleTooSmall: boolean;
}

export interface StaffInsightsRecentLeaderRow {
  readonly rank: number;
  readonly name: string | null;
  readonly githubLogin: string;
  readonly department: string | null;
  readonly cohort: DepartmentCohort;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly total: number;
}

export interface StaffInsightsLeaderRow extends StaffInsightsRecentLeaderRow {
  readonly starCount: number;
}

export interface StaffInsightsCohortLeaders<Row> {
  readonly all: readonly Row[];
  readonly swMajor: readonly Row[];
  readonly nonSw: readonly Row[];
}

export interface StaffInsightsLeaders {
  readonly period: StaffInsightsCohortLeaders<StaffInsightsLeaderRow>;
  readonly recent: StaffInsightsCohortLeaders<StaffInsightsRecentLeaderRow>;
}

export interface StaffInsightsProgramRow {
  readonly programId: string;
  readonly name: string;
  readonly category: ProgramCategory;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly recruiting: boolean;
  readonly swMajorCount: number;
  readonly nonSwCount: number;
  readonly unregisteredCount: number;
  readonly participantCount: number;
  readonly appliedCount: number;
  readonly approvedCount: number;
  readonly competitionRatio: number | null;
  readonly dueRequirementCount: number;
  readonly submittedRequirementCount: number;
  readonly completionRate: number | null;
  readonly contributionCount: number;
  readonly activeTeamCount: number;
  readonly repoTeamCount: number;
  readonly contributionsPerParticipant: number | null;
}

export interface StaffInsightsProgramSummary {
  readonly programCount: number;
  readonly recruitingCount: number;
  readonly approvedParticipantCount: number;
  readonly uniqueParticipantCount: number;
  readonly competitionRatio: number | null;
  readonly repeatParticipantCount: number;
  readonly repeatParticipantRate: number | null;
}

export interface StaffInsightsSummary {
  readonly scope: InsightsYearScope;
  readonly dataAsOf: Date | null;
  readonly years: readonly number[];
  readonly cohorts: readonly StaffInsightsCohortRow[];
  readonly departments: readonly StaffInsightsDepartmentRow[];
  readonly programs: readonly StaffInsightsProgramRow[];
  readonly programSummary: StaffInsightsProgramSummary;
  readonly leaders: StaffInsightsLeaders;
  readonly recentWindow: { readonly from: Date; readonly to: Date };
}

interface ProgramScorecardInput {
  readonly programs: readonly StaffInsightsProgramRecord[];
  readonly participations: readonly StaffInsightsParticipationRecord[];
  readonly applications: readonly StaffInsightsApplicationCountRecord[];
  readonly completion: readonly StaffInsightsCompletionRecord[];
  readonly outcomes: readonly StaffInsightsOutcomeRecord[];
  readonly studentsById: ReadonlyMap<string, StaffInsightsStudentRecord>;
  readonly now: Date;
}

const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const LEADER_LIMIT = 10;
const SMALL_SAMPLE_STUDENT_COUNT = 3;

interface LeaderCandidate {
  readonly student: StaffInsightsStudentRecord;
  readonly cohort: DepartmentCohort;
  readonly activity: ActivityCounts;
  readonly total: number;
}

const EMPTY_ACTIVITY: ActivityCounts = {
  commitCount: 0,
  pullRequestCount: 0,
  issueCount: 0,
  repositoryCount: 0,
  starCount: 0,
};

const EMPTY_METRICS: StaffInsightsMetrics = {
  studentCount: 0,
  activeStudentCount: 0,
  commitCount: 0,
  pullRequestCount: 0,
  issueCount: 0,
  repositoryCount: 0,
  starCount: 0,
  total: 0,
  participantCount: 0,
};

@Injectable()
export class StaffInsightsService {
  constructor(
    private readonly repository: StaffInsightsRepository,
    private readonly rankingYearService: RankingYearService,
    private readonly staffInsightsQueryService: StaffInsightsQueryService,
  ) {}

  summarizeFromRequest(
    request: {
      readonly year?: string;
    },
    now: Date = new Date(),
  ): Promise<StaffInsightsSummary> {
    return this.summarize(
      this.staffInsightsQueryService.parseInsightsYearQuery(request.year),
      now,
    );
  }

  async summarize(
    scope: InsightsYearScope,
    now: Date = new Date(),
  ): Promise<StaffInsightsSummary> {
    const cutoff = new Date(now.getTime() - RECENT_WINDOW_MS);
    const cutoffYear = this.rankingYearService.rankingYearInAsiaSeoul(cutoff);
    const nowYear = this.rankingYearService.rankingYearInAsiaSeoul(now);
    const [
      students,
      participations,
      activity,
      dataAsOf,
      years,
      baselines,
      cutoffYearActivity,
      nowYearActivity,
      programs,
      applications,
      completion,
      outcomes,
    ] = await Promise.all([
      this.repository.listStudents(),
      this.repository.listApprovedParticipations(),
      this.repository.listActivityTotals(
        this.staffInsightsQueryService.rankingYearFilter(scope),
      ),
      this.repository.findActivityDataAsOf(),
      this.repository.listActivityYears(),
      this.repository.listActivityBaselines(cutoffYear, cutoff),
      this.repository.listActivityByYear(cutoffYear),
      nowYear === cutoffYear
        ? Promise.resolve([])
        : this.repository.listActivityByYear(nowYear),
      this.repository.listPublishedPrograms(),
      this.repository.listProgramApplicationCounts(),
      this.repository.listProgramCompletion(now),
      this.repository.listProgramOutcomes(now),
    ]);

    const activityByGithubId = new Map(
      activity.map((row) => [row.githubId.toString(), row]),
    );
    const participantIds = new Set<string>();
    for (const participation of participations) {
      for (const userId of participation.userIds) {
        participantIds.add(userId);
      }
    }

    const studentsById = new Map(
      students.map((student) => [student.id, student]),
    );
    const programRows = this.buildProgramRows({
      programs,
      participations,
      applications,
      completion,
      outcomes,
      studentsById,
      now,
    });

    return {
      scope,
      dataAsOf,
      years,
      cohorts: this.buildCohortRows(
        students,
        activityByGithubId,
        participantIds,
      ),
      departments: this.buildDepartmentRows(
        students,
        activityByGithubId,
        participantIds,
      ),
      programs: programRows,
      programSummary: summarizePrograms(programRows, participations),
      leaders: {
        period: this.buildPeriodLeaders(students, activityByGithubId),
        recent: this.buildRecentLeaders(
          students,
          byGithubId(baselines),
          byGithubId(cutoffYearActivity),
          byGithubId(nowYearActivity),
        ),
      },
      recentWindow: { from: cutoff, to: now },
    };
  }

  private buildPeriodLeaders(
    students: readonly StaffInsightsStudentRecord[],
    activityByGithubId: ReadonlyMap<string, ActivityCounts>,
  ): StaffInsightsCohortLeaders<StaffInsightsLeaderRow> {
    const candidates: LeaderCandidate[] = [];
    for (const student of students) {
      if (student.githubLogin === '') continue;
      const activity = activityFor(student, activityByGithubId);
      candidates.push(
        this.candidate(
          student,
          activity,
          this.rankingYearService.activityTotal(activity),
        ),
      );
    }
    return this.rankLeaders(candidates, (candidate, rank) => ({
      ...leaderRow(candidate, rank),
      starCount: candidate.activity.starCount,
    }));
  }

  private buildRecentLeaders(
    students: readonly StaffInsightsStudentRecord[],
    baselines: ReadonlyMap<string, StaffInsightsBaselineRecord>,
    cutoffYearActivity: ReadonlyMap<string, StaffInsightsBaselineRecord>,
    nowYearActivity: ReadonlyMap<string, StaffInsightsBaselineRecord>,
  ): StaffInsightsCohortLeaders<StaffInsightsRecentLeaderRow> {
    const candidates: LeaderCandidate[] = [];
    for (const student of students) {
      if (student.githubLogin === '') continue;
      const key = student.githubId.toString();
      const current = cutoffYearActivity.get(key);
      const baseline = baselines.get(key);
      let sinceCutoff = EMPTY_ACTIVITY;
      if (current !== undefined) {
        if (baseline === undefined) continue;
        sinceCutoff = recentDelta(current, baseline);
      }
      const activity = addCounts(
        sinceCutoff,
        nowYearActivity.get(key) ?? EMPTY_ACTIVITY,
      );
      candidates.push(
        this.candidate(
          student,
          activity,
          this.rankingYearService.activityTotal({ ...activity, starCount: 0 }),
        ),
      );
    }
    return this.rankLeaders(candidates, leaderRow);
  }

  private candidate(
    student: StaffInsightsStudentRecord,
    activity: ActivityCounts,
    total: number,
  ): LeaderCandidate {
    return {
      student,
      cohort: this.staffInsightsQueryService.classifyDepartment(
        student.department,
      ),
      activity,
      total,
    };
  }

  private rankLeaders<Row>(
    candidates: readonly LeaderCandidate[],
    toRow: (candidate: LeaderCandidate, rank: number) => Row,
  ): StaffInsightsCohortLeaders<Row> {
    const ranked = candidates
      .filter((candidate) => candidate.total > 0)
      .sort((left, right) =>
        this.rankingYearService.compareRanked(
          rankedActivity(left),
          rankedActivity(right),
        ),
      );
    const top = (cohort?: DepartmentCohort): readonly Row[] =>
      ranked
        .filter(
          (candidate) => cohort === undefined || candidate.cohort === cohort,
        )
        .slice(0, LEADER_LIMIT)
        .map((candidate, index) => toRow(candidate, index + 1));
    return {
      all: top(),
      swMajor: top(DEPARTMENT_COHORTS.SW_MAJOR),
      nonSw: top(DEPARTMENT_COHORTS.NON_SW),
    };
  }

  private addStudent(
    metrics: StaffInsightsMetrics,
    activity: ActivityCounts,
    isParticipant: boolean,
  ): StaffInsightsMetrics {
    const total = this.rankingYearService.activityTotal(activity);
    return {
      studentCount: metrics.studentCount + 1,
      activeStudentCount: metrics.activeStudentCount + (total > 0 ? 1 : 0),
      commitCount: metrics.commitCount + activity.commitCount,
      pullRequestCount: metrics.pullRequestCount + activity.pullRequestCount,
      issueCount: metrics.issueCount + activity.issueCount,
      repositoryCount: metrics.repositoryCount + activity.repositoryCount,
      starCount: metrics.starCount + activity.starCount,
      total: metrics.total + total,
      participantCount: metrics.participantCount + (isParticipant ? 1 : 0),
    };
  }

  private buildCohortRows(
    students: readonly StaffInsightsStudentRecord[],
    activityByGithubId: ReadonlyMap<string, ActivityCounts>,
    participantIds: ReadonlySet<string>,
  ): readonly StaffInsightsCohortRow[] {
    const byCohort = new Map<DepartmentCohort, StaffInsightsMetrics>([
      [DEPARTMENT_COHORTS.SW_MAJOR, EMPTY_METRICS],
      [DEPARTMENT_COHORTS.NON_SW, EMPTY_METRICS],
      [DEPARTMENT_COHORTS.UNREGISTERED, EMPTY_METRICS],
    ]);
    for (const student of students) {
      const cohort = this.staffInsightsQueryService.classifyDepartment(
        student.department,
      );
      const current = byCohort.get(cohort);
      if (current === undefined) {
        throw new Error(`Unknown department cohort: ${cohort}`);
      }
      byCohort.set(
        cohort,
        this.addStudent(
          current,
          activityFor(student, activityByGithubId),
          participantIds.has(student.id),
        ),
      );
    }
    return [
      DEPARTMENT_COHORTS.SW_MAJOR,
      DEPARTMENT_COHORTS.NON_SW,
      DEPARTMENT_COHORTS.UNREGISTERED,
    ].map((cohort) => {
      const metrics = byCohort.get(cohort);
      if (metrics === undefined) {
        throw new Error(`Unknown department cohort: ${cohort}`);
      }
      return { cohort, ...metrics };
    });
  }

  private buildDepartmentRows(
    students: readonly StaffInsightsStudentRecord[],
    activityByGithubId: ReadonlyMap<string, ActivityCounts>,
    participantIds: ReadonlySet<string>,
  ): readonly StaffInsightsDepartmentRow[] {
    const byDepartment = new Map<
      string,
      { readonly cohort: DepartmentCohort; metrics: StaffInsightsMetrics }
    >();
    for (const student of students) {
      const cohort = this.staffInsightsQueryService.classifyDepartment(
        student.department,
      );
      const department =
        cohort === DEPARTMENT_COHORTS.UNREGISTERED
          ? '미등록'
          : (student.department ?? '미등록');
      const current = byDepartment.get(department) ?? {
        cohort,
        metrics: EMPTY_METRICS,
      };
      byDepartment.set(department, {
        cohort,
        metrics: this.addStudent(
          current.metrics,
          activityFor(student, activityByGithubId),
          participantIds.has(student.id),
        ),
      });
    }
    return [...byDepartment.entries()]
      .map(([department, row]) => ({
        department,
        cohort: row.cohort,
        ...row.metrics,
        activityPerStudent:
          row.metrics.studentCount === 0
            ? 0
            : Math.round((row.metrics.total / row.metrics.studentCount) * 10) /
              10,
        sampleTooSmall: row.metrics.studentCount < SMALL_SAMPLE_STUDENT_COUNT,
      }))
      .sort(
        (left, right) =>
          right.total - left.total || right.studentCount - left.studentCount,
      );
  }

  private buildProgramRows(
    input: ProgramScorecardInput,
  ): readonly StaffInsightsProgramRow[] {
    const userIdsByProgram = participantsByProgram(input.participations);
    const applications = new Map(
      input.applications.map((row) => [row.programId, row]),
    );
    const completion = new Map(
      input.completion.map((row) => [row.programId, row]),
    );
    const outcomes = new Map(input.outcomes.map((row) => [row.programId, row]));
    const now = input.now.getTime();
    return input.programs
      .map((program) => {
        const userIds = userIdsByProgram.get(program.id) ?? new Set<string>();
        let swMajorCount = 0;
        let nonSwCount = 0;
        let unregisteredCount = 0;
        for (const userId of userIds) {
          const student = input.studentsById.get(userId);
          const cohort = this.staffInsightsQueryService.classifyDepartment(
            student?.department ?? null,
          );
          if (cohort === DEPARTMENT_COHORTS.SW_MAJOR) swMajorCount += 1;
          else if (cohort === DEPARTMENT_COHORTS.NON_SW) nonSwCount += 1;
          else unregisteredCount += 1;
        }
        const participantCount = userIds.size;
        const appliedCount = applications.get(program.id)?.appliedCount ?? 0;
        const approvedCount = applications.get(program.id)?.approvedCount ?? 0;
        const due = completion.get(program.id)?.dueRequirementCount ?? 0;
        const submitted =
          completion.get(program.id)?.submittedRequirementCount ?? 0;
        const outcome = outcomes.get(program.id);
        const repoTeamCount = outcome?.repoTeamCount ?? 0;
        const contributionCount = outcome?.contributionCount ?? 0;
        return {
          programId: program.id,
          name: program.name,
          category: program.category,
          startAt: program.startAt,
          endAt: program.endAt,
          recruiting:
            program.applicationStartAt.getTime() <= now &&
            now < program.applicationEndAt.getTime(),
          swMajorCount,
          nonSwCount,
          unregisteredCount,
          participantCount,
          appliedCount,
          approvedCount,
          competitionRatio: ratio(appliedCount, approvedCount),
          dueRequirementCount: due,
          submittedRequirementCount: submitted,
          completionRate: percent(submitted, due),
          contributionCount,
          activeTeamCount: outcome?.activeTeamCount ?? 0,
          repoTeamCount,
          contributionsPerParticipant:
            repoTeamCount === 0
              ? null
              : ratio(contributionCount, participantCount),
        };
      })
      .sort(
        (left, right) =>
          right.participantCount - left.participantCount ||
          left.name.localeCompare(right.name, 'ko'),
      );
  }
}

function participantsByProgram(
  participations: readonly StaffInsightsParticipationRecord[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const byProgram = new Map<string, Set<string>>();
  for (const participation of participations) {
    const current = byProgram.get(participation.programId) ?? new Set<string>();
    for (const userId of participation.userIds) {
      current.add(userId);
    }
    byProgram.set(participation.programId, current);
  }
  return byProgram;
}

function summarizePrograms(
  rows: readonly StaffInsightsProgramRow[],
  participations: readonly StaffInsightsParticipationRecord[],
): StaffInsightsProgramSummary {
  const programIds = new Set(rows.map((row) => row.programId));
  const programCountByUser = new Map<string, number>();
  for (const [programId, userIds] of participantsByProgram(participations)) {
    if (!programIds.has(programId)) continue;
    for (const userId of userIds) {
      programCountByUser.set(userId, (programCountByUser.get(userId) ?? 0) + 1);
    }
  }
  const uniqueParticipantCount = programCountByUser.size;
  const repeatParticipantCount = [...programCountByUser.values()].filter(
    (count) => count >= 2,
  ).length;
  const sum = (pick: (row: StaffInsightsProgramRow) => number): number =>
    rows.reduce((total, row) => total + pick(row), 0);
  return {
    programCount: rows.length,
    recruitingCount: rows.filter((row) => row.recruiting).length,
    approvedParticipantCount: sum((row) => row.participantCount),
    uniqueParticipantCount,
    competitionRatio: ratio(
      sum((row) => row.appliedCount),
      sum((row) => row.approvedCount),
    ),
    repeatParticipantCount,
    repeatParticipantRate: percent(
      repeatParticipantCount,
      uniqueParticipantCount,
    ),
  };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0
    ? null
    : Math.round((numerator / denominator) * 10) / 10;
}

function percent(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 100);
}

function activityFor(
  student: StaffInsightsStudentRecord,
  activityByGithubId: ReadonlyMap<string, ActivityCounts>,
): ActivityCounts {
  return activityByGithubId.get(student.githubId.toString()) ?? EMPTY_ACTIVITY;
}

function byGithubId(
  rows: readonly StaffInsightsBaselineRecord[],
): ReadonlyMap<string, StaffInsightsBaselineRecord> {
  return new Map(rows.map((row) => [row.githubId.toString(), row]));
}

function recentDelta(
  current: StaffInsightsBaselineRecord,
  baseline: StaffInsightsBaselineRecord,
): ActivityCounts {
  return {
    commitCount: Math.max(0, current.commitCount - baseline.commitCount),
    pullRequestCount: Math.max(
      0,
      current.pullRequestCount - baseline.pullRequestCount,
    ),
    issueCount: Math.max(0, current.issueCount - baseline.issueCount),
    repositoryCount: Math.max(
      0,
      current.repositoryCount - baseline.repositoryCount,
    ),
    starCount: 0,
  };
}

function addCounts(
  left: ActivityCounts,
  right: Omit<ActivityCounts, 'starCount'>,
): ActivityCounts {
  return {
    commitCount: left.commitCount + right.commitCount,
    pullRequestCount: left.pullRequestCount + right.pullRequestCount,
    issueCount: left.issueCount + right.issueCount,
    repositoryCount: left.repositoryCount + right.repositoryCount,
    starCount: 0,
  };
}

function rankedActivity(candidate: LeaderCandidate): RankedActivity {
  return {
    ...candidate.activity,
    githubId: candidate.student.githubId,
    githubLogin: candidate.student.githubLogin,
    total: candidate.total,
  };
}

function leaderRow(
  candidate: LeaderCandidate,
  rank: number,
): StaffInsightsRecentLeaderRow {
  return {
    rank,
    name: candidate.student.name,
    githubLogin: candidate.student.githubLogin,
    department: candidate.student.department,
    cohort: candidate.cohort,
    commitCount: candidate.activity.commitCount,
    pullRequestCount: candidate.activity.pullRequestCount,
    issueCount: candidate.activity.issueCount,
    repositoryCount: candidate.activity.repositoryCount,
    total: candidate.total,
  };
}
