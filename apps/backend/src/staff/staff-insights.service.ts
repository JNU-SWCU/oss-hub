import { Injectable } from '@nestjs/common';
import type { ProgramCategory } from '@prisma/client';
import {
  StaffInsightsRepository,
  type StaffInsightsApplicationCountRecord,
  type StaffInsightsAttentionStudentRecord,
  type StaffInsightsCompletionRecord,
  type StaffInsightsDepartmentMetricsRecord,
  type StaffInsightsFinderPage,
  type StaffInsightsLeaderCandidateRecord,
  type StaffInsightsOutcomeRecord,
  type StaffInsightsParticipantCountRecord,
  type StaffInsightsPeriodLeaderCandidateRecord,
  type StaffInsightsProgramDepartmentRecord,
  type StaffInsightsProgramRecord,
  type StaffInsightsRecentWindow,
} from './staff-insights.repository';
import { RankingYearService } from '../ranking/ranking-year.service';
import {
  StaffInsightsQueryService,
  DepartmentCohort,
  InsightsYearScope,
  DEPARTMENT_COHORTS,
  SW_MAJOR_DEPARTMENTS,
} from './staff-insights-query.service';
import {
  STAFF_INSIGHTS_PERIOD_LEADER_LIMIT,
  STAFF_INSIGHTS_RECENT_LEADER_LIMIT,
  UNREGISTERED_DEPARTMENT,
  type StaffInsightsFinderInput,
} from './staff-insights-query.config';

export interface StaffInsightsMetrics {
  readonly studentCount: number;
  readonly activeStudentCount: number;
  readonly total: number;
  readonly participantCount: number;
}

export interface StaffInsightsCohortRow extends StaffInsightsMetrics {
  readonly cohort: DepartmentCohort;
}

export interface StaffInsightsDepartmentRow extends StaffInsightsMetrics {
  readonly department: string;
  readonly major: string | null;
  readonly cohort: DepartmentCohort;
  readonly activityPerStudent: number;
  readonly recentPerStudent: number | null;
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

export interface StaffInsightsPeriodLeaderRow extends StaffInsightsRecentLeaderRow {
  readonly starCount: number;
  readonly studentId: string | null;
  readonly major: string | null;
  readonly recentTotal: number | null;
  readonly previousRank: number | null;
  readonly collaborationRatio: number | null;
}

export interface StaffInsightsAttentionStudentRow extends StaffInsightsAttentionStudentRecord {
  readonly lastActiveAt: Date | null;
}

export interface StaffInsightsCohortLeaders<Row> {
  readonly all: readonly Row[];
  readonly swMajor: readonly Row[];
  readonly nonSw: readonly Row[];
}

export interface StaffInsightsLeaders {
  readonly period: StaffInsightsCohortLeaders<StaffInsightsPeriodLeaderRow>;
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
  readonly attentionStudents: readonly StaffInsightsAttentionStudentRow[];
  readonly firstContributionCount: number | null;
  readonly recentWindow: { readonly from: Date; readonly to: Date };
}

interface ProgramScorecardInput {
  readonly programs: readonly StaffInsightsProgramRecord[];
  readonly departments: readonly StaffInsightsProgramDepartmentRecord[];
  readonly applications: readonly StaffInsightsApplicationCountRecord[];
  readonly completion: readonly StaffInsightsCompletionRecord[];
  readonly outcomes: readonly StaffInsightsOutcomeRecord[];
  readonly now: Date;
}

const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const SMALL_SAMPLE_STUDENT_COUNT = 3;

interface LeaderCandidate<
  Candidate extends StaffInsightsLeaderCandidateRecord =
    StaffInsightsLeaderCandidateRecord,
> {
  readonly record: Candidate;
  readonly cohort: DepartmentCohort;
}

const EMPTY_METRICS: StaffInsightsMetrics = {
  studentCount: 0,
  activeStudentCount: 0,
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

  findStudents(
    request: StaffInsightsFinderInput,
    now: Date = new Date(),
  ): Promise<StaffInsightsFinderPage> {
    return this.repository.findStudents(
      this.staffInsightsQueryService.finderQuery(request),
      this.recentWindow(now),
    );
  }

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
    const window = this.recentWindow(now);
    const yearFilter = this.staffInsightsQueryService.rankingYearFilter(scope);
    const [
      departmentMetrics,
      periodCandidates,
      recentCandidates,
      attentionStudents,
      dataAsOf,
      years,
      programs,
      programDepartments,
      participantCounts,
      applications,
      completion,
      outcomes,
    ] = await Promise.all([
      this.repository.listDepartmentMetrics(yearFilter, window),
      this.repository.listPeriodLeaderCandidates(
        yearFilter,
        SW_MAJOR_DEPARTMENTS,
        window,
      ),
      this.repository.listRecentLeaderCandidates(window, SW_MAJOR_DEPARTMENTS),
      this.repository.listAttentionStudents(yearFilter, window),
      this.repository.findActivityDataAsOf(),
      this.repository.listActivityYears(),
      this.repository.listPublishedPrograms(),
      this.repository.listProgramParticipantDepartments(),
      this.repository.countPublishedParticipants(),
      this.repository.listProgramApplicationCounts(),
      this.repository.listProgramCompletion(now),
      this.repository.listProgramOutcomes(now),
    ]);

    const departments = this.buildDepartmentRows(departmentMetrics);
    const programRows = this.buildProgramRows({
      programs,
      departments: programDepartments,
      applications,
      completion,
      outcomes,
      now,
    });

    return {
      scope,
      dataAsOf,
      years,
      cohorts: buildCohortRows(departments),
      departments,
      programs: programRows,
      programSummary: summarizePrograms(programRows, participantCounts),
      leaders: {
        period: this.rankLeaders(
          periodCandidates,
          STAFF_INSIGHTS_PERIOD_LEADER_LIMIT,
          periodLeaderRow,
        ),
        recent: this.rankLeaders(
          recentCandidates,
          STAFF_INSIGHTS_RECENT_LEADER_LIMIT,
          leaderRow,
        ),
      },
      attentionStudents: attentionStudents.map((student) => ({
        ...student,
        lastActiveAt: null,
      })),
      firstContributionCount: null,
      recentWindow: { from: window.cutoff, to: now },
    };
  }

  private recentWindow(now: Date): StaffInsightsRecentWindow {
    const cutoff = new Date(now.getTime() - RECENT_WINDOW_MS);
    return {
      cutoff,
      now,
      cutoffYear: this.rankingYearService.rankingYearInAsiaSeoul(cutoff),
      nowYear: this.rankingYearService.rankingYearInAsiaSeoul(now),
    };
  }

  private rankLeaders<
    Candidate extends StaffInsightsLeaderCandidateRecord,
    Row,
  >(
    records: readonly Candidate[],
    limit: number,
    toRow: (
      candidate: LeaderCandidate<Candidate>,
      rank: number,
      cohort?: DepartmentCohort,
    ) => Row,
  ): StaffInsightsCohortLeaders<Row> {
    const ranked = records.map((record) => ({
      record,
      cohort: this.staffInsightsQueryService.classifyDepartment(
        record.department,
      ),
    }));
    const top = (cohort?: DepartmentCohort): readonly Row[] =>
      ranked
        .filter(
          (candidate) => cohort === undefined || candidate.cohort === cohort,
        )
        .slice(0, limit)
        .map((candidate, index) => toRow(candidate, index + 1, cohort));
    return {
      all: top(),
      swMajor: top(DEPARTMENT_COHORTS.SW_MAJOR),
      nonSw: top(DEPARTMENT_COHORTS.NON_SW),
    };
  }

  private buildDepartmentRows(
    records: readonly StaffInsightsDepartmentMetricsRecord[],
  ): readonly StaffInsightsDepartmentRow[] {
    const byDepartment = new Map<
      string,
      {
        readonly cohort: DepartmentCohort;
        readonly metrics: StaffInsightsMetrics;
        readonly recentTotal: number | null;
      }
    >();
    for (const record of records) {
      const cohort = this.staffInsightsQueryService.classifyDepartment(
        record.department,
      );
      const department =
        cohort === DEPARTMENT_COHORTS.UNREGISTERED || record.department === null
          ? UNREGISTERED_DEPARTMENT
          : record.department;
      const current = byDepartment.get(department) ?? {
        cohort,
        metrics: EMPTY_METRICS,
        recentTotal: 0,
      };
      byDepartment.set(department, {
        cohort,
        metrics: addMetrics(current.metrics, record),
        recentTotal:
          current.recentTotal === null || record.recentTotal === null
            ? null
            : current.recentTotal + record.recentTotal,
      });
    }
    return [...byDepartment.entries()]
      .map(([department, row]) => ({
        department,
        major: null,
        cohort: row.cohort,
        ...row.metrics,
        activityPerStudent:
          ratio(row.metrics.total, row.metrics.studentCount) ?? 0,
        recentPerStudent:
          row.recentTotal === null
            ? null
            : ratio(row.recentTotal, row.metrics.studentCount),
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
    const cohortCounts = new Map<
      string,
      { swMajor: number; nonSw: number; unregistered: number }
    >();
    for (const row of input.departments) {
      const counts = cohortCounts.get(row.programId) ?? {
        swMajor: 0,
        nonSw: 0,
        unregistered: 0,
      };
      const cohort = this.staffInsightsQueryService.classifyDepartment(
        row.department,
      );
      if (cohort === DEPARTMENT_COHORTS.SW_MAJOR)
        counts.swMajor += row.participantCount;
      else if (cohort === DEPARTMENT_COHORTS.NON_SW)
        counts.nonSw += row.participantCount;
      else counts.unregistered += row.participantCount;
      cohortCounts.set(row.programId, counts);
    }
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
        const counts = cohortCounts.get(program.id);
        const swMajorCount = counts?.swMajor ?? 0;
        const nonSwCount = counts?.nonSw ?? 0;
        const unregisteredCount = counts?.unregistered ?? 0;
        const participantCount = swMajorCount + nonSwCount + unregisteredCount;
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

function addMetrics(
  metrics: StaffInsightsMetrics,
  record: StaffInsightsMetrics,
): StaffInsightsMetrics {
  return {
    studentCount: metrics.studentCount + record.studentCount,
    activeStudentCount: metrics.activeStudentCount + record.activeStudentCount,
    total: metrics.total + record.total,
    participantCount: metrics.participantCount + record.participantCount,
  };
}

function buildCohortRows(
  departments: readonly StaffInsightsDepartmentRow[],
): readonly StaffInsightsCohortRow[] {
  return [
    DEPARTMENT_COHORTS.SW_MAJOR,
    DEPARTMENT_COHORTS.NON_SW,
    DEPARTMENT_COHORTS.UNREGISTERED,
  ].map((cohort) => ({
    cohort,
    ...departments
      .filter((row) => row.cohort === cohort)
      .reduce<StaffInsightsMetrics>(addMetrics, EMPTY_METRICS),
  }));
}

function summarizePrograms(
  rows: readonly StaffInsightsProgramRow[],
  participants: StaffInsightsParticipantCountRecord,
): StaffInsightsProgramSummary {
  const sum = (pick: (row: StaffInsightsProgramRow) => number): number =>
    rows.reduce((total, row) => total + pick(row), 0);
  return {
    programCount: rows.length,
    recruitingCount: rows.filter((row) => row.recruiting).length,
    approvedParticipantCount: sum((row) => row.participantCount),
    uniqueParticipantCount: participants.uniqueParticipantCount,
    competitionRatio: ratio(
      sum((row) => row.appliedCount),
      sum((row) => row.approvedCount),
    ),
    repeatParticipantCount: participants.repeatParticipantCount,
    repeatParticipantRate: percent(
      participants.repeatParticipantCount,
      participants.uniqueParticipantCount,
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

function leaderRow(
  candidate: LeaderCandidate,
  rank: number,
): StaffInsightsRecentLeaderRow {
  const record = candidate.record;
  return {
    rank,
    name: record.name,
    githubLogin: record.githubLogin,
    department: record.department,
    cohort: candidate.cohort,
    commitCount: record.commitCount,
    pullRequestCount: record.pullRequestCount,
    issueCount: record.issueCount,
    repositoryCount: record.repositoryCount,
    total: record.total,
  };
}

function periodLeaderRow(
  candidate: LeaderCandidate<StaffInsightsPeriodLeaderCandidateRecord>,
  rank: number,
  cohort?: DepartmentCohort,
): StaffInsightsPeriodLeaderRow {
  const { record } = candidate;
  return {
    ...leaderRow(candidate, rank),
    starCount: record.starCount,
    studentId: record.studentId,
    major: null,
    recentTotal: record.recentTotal,
    previousRank:
      cohort === undefined
        ? record.previousOverallRank
        : record.previousCohortRank,
    collaborationRatio:
      record.total > 0
        ? (record.pullRequestCount + record.issueCount) / record.total
        : null,
  };
}
