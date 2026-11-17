import { Injectable } from '@nestjs/common';
import type { ProgramCategory } from '@prisma/client';
import {
  StaffInsightsRepository,
  type StaffInsightsApplicationCountRecord,
  type StaffInsightsCompletionRecord,
  type StaffInsightsDepartmentMetricsRecord,
  type StaffInsightsLeaderCandidateRecord,
  type StaffInsightsOutcomeRecord,
  type StaffInsightsParticipantCountRecord,
  type StaffInsightsProgramDepartmentRecord,
  type StaffInsightsProgramRecord,
} from './staff-insights.repository';
import { RankingYearService } from '../ranking/ranking-year.service';
import {
  StaffInsightsQueryService,
  DepartmentCohort,
  InsightsYearScope,
  DEPARTMENT_COHORTS,
  SW_MAJOR_DEPARTMENTS,
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
  readonly departments: readonly StaffInsightsProgramDepartmentRecord[];
  readonly applications: readonly StaffInsightsApplicationCountRecord[];
  readonly completion: readonly StaffInsightsCompletionRecord[];
  readonly outcomes: readonly StaffInsightsOutcomeRecord[];
  readonly now: Date;
}

const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const LEADER_LIMIT = 10;
const SMALL_SAMPLE_STUDENT_COUNT = 3;
const UNREGISTERED_DEPARTMENT = '미등록';

interface LeaderCandidate {
  readonly record: StaffInsightsLeaderCandidateRecord;
  readonly cohort: DepartmentCohort;
}

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
    const yearFilter = this.staffInsightsQueryService.rankingYearFilter(scope);
    const [
      departmentMetrics,
      periodCandidates,
      recentCandidates,
      dataAsOf,
      years,
      programs,
      programDepartments,
      participantCounts,
      applications,
      completion,
      outcomes,
    ] = await Promise.all([
      this.repository.listDepartmentMetrics(yearFilter),
      this.repository.listPeriodLeaderCandidates(
        yearFilter,
        SW_MAJOR_DEPARTMENTS,
      ),
      this.repository.listRecentLeaderCandidates(
        {
          cutoff,
          cutoffYear: this.rankingYearService.rankingYearInAsiaSeoul(cutoff),
          nowYear: this.rankingYearService.rankingYearInAsiaSeoul(now),
        },
        SW_MAJOR_DEPARTMENTS,
      ),
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
        period: this.rankLeaders(periodCandidates, (candidate, rank) => ({
          ...leaderRow(candidate, rank),
          starCount: candidate.record.starCount,
        })),
        recent: this.rankLeaders(recentCandidates, leaderRow),
      },
      recentWindow: { from: cutoff, to: now },
    };
  }

  private rankLeaders<Row>(
    records: readonly StaffInsightsLeaderCandidateRecord[],
    toRow: (candidate: LeaderCandidate, rank: number) => Row,
  ): StaffInsightsCohortLeaders<Row> {
    const ranked = records
      .map((record) => ({
        record,
        cohort: this.staffInsightsQueryService.classifyDepartment(
          record.department,
        ),
      }))
      .sort((left, right) =>
        this.rankingYearService.compareRanked(left.record, right.record),
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

  private buildDepartmentRows(
    records: readonly StaffInsightsDepartmentMetricsRecord[],
  ): readonly StaffInsightsDepartmentRow[] {
    const byDepartment = new Map<
      string,
      { readonly cohort: DepartmentCohort; metrics: StaffInsightsMetrics }
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
      };
      byDepartment.set(department, {
        cohort,
        metrics: addMetrics(current.metrics, record),
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
    commitCount: metrics.commitCount + record.commitCount,
    pullRequestCount: metrics.pullRequestCount + record.pullRequestCount,
    issueCount: metrics.issueCount + record.issueCount,
    repositoryCount: metrics.repositoryCount + record.repositoryCount,
    starCount: metrics.starCount + record.starCount,
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
