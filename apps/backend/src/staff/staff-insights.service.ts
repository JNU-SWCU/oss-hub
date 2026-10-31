import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { DomainException } from '../platform/error-code.error';
import { UsersAuthorityService } from '../users/users-authority.service';
import {
  APPLICATIONS_ERROR_CODES,
  ApplicationsErrorCode,
} from '../programs/applications-error-code.error';
import {
  StaffInsightsRepository,
  type StaffInsightsStudentRecord,
} from './staff-insights.repository';
import { activityTotal, type ActivityCounts } from '../ranking/ranking.service';

export const DEPARTMENT_COHORTS = {
  SW_MAJOR: 'sw-major',
  NON_SW: 'non-sw',
  UNREGISTERED: 'unregistered',
} as const;

export type DepartmentCohort =
  (typeof DEPARTMENT_COHORTS)[keyof typeof DEPARTMENT_COHORTS];

const SW_MAJOR_DEPARTMENTS: readonly string[] = [
  '인공지능학부',
  '소프트웨어공학과',
  '컴퓨터정보통신공학과',
  '전자컴퓨터공학부(컴퓨터공학전공)',
];

const SW_MAJOR_DEPARTMENT_SET = new Set(SW_MAJOR_DEPARTMENTS);

export function classifyDepartment(
  department: string | null,
): DepartmentCohort {
  if (department === null || department.trim() === '') {
    return DEPARTMENT_COHORTS.UNREGISTERED;
  }
  return SW_MAJOR_DEPARTMENT_SET.has(department)
    ? DEPARTMENT_COHORTS.SW_MAJOR
    : DEPARTMENT_COHORTS.NON_SW;
}

export const INSIGHTS_YEAR_MIN = 2000;

export const INSIGHTS_YEAR_MAX = 2100;

export type InsightsYearScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'calendar'; readonly year: number };

const CALENDAR_YEAR_PATTERN = /^(20\d{2}|2100)$/;

export function parseInsightsYearQuery(
  raw: string | undefined,
): InsightsYearScope {
  if (raw === undefined || raw === '') {
    return { kind: 'all' };
  }
  if (raw.toLowerCase() === 'all') {
    return { kind: 'all' };
  }
  if (!CALENDAR_YEAR_PATTERN.test(raw)) {
    throw new BadRequestException(
      `year must be omitted, "all", or a calendar year between ${INSIGHTS_YEAR_MIN} and ${INSIGHTS_YEAR_MAX}`,
    );
  }

  return { kind: 'calendar', year: Number(raw) };
}

export function rankingYearFilter(
  scope: InsightsYearScope,
): { readonly currentYear: number } | Record<string, never> {
  if (scope.kind === 'all') {
    return {};
  }
  return { currentYear: scope.year };
}

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
}

export interface StaffInsightsProgramRow {
  readonly programId: string;
  readonly name: string;
  readonly swMajorCount: number;
  readonly nonSwCount: number;
  readonly unregisteredCount: number;
  readonly participantCount: number;
}

export interface StaffInsightsSummary {
  readonly scope: InsightsYearScope;
  readonly dataAsOf: Date | null;
  readonly years: readonly number[];
  readonly cohorts: readonly StaffInsightsCohortRow[];
  readonly departments: readonly StaffInsightsDepartmentRow[];
  readonly programs: readonly StaffInsightsProgramRow[];
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
    @Inject(UsersAuthorityService)
    private readonly authority: Pick<
      UsersAuthorityService,
      'assertActiveStaff'
    >,
  ) {}

  async summarize(
    sessionGithubId: bigint,
    scope: InsightsYearScope,
  ): Promise<StaffInsightsSummary> {
    await this.authority.assertActiveStaff(
      sessionGithubId,
      () =>
        new DomainException(
          APPLICATIONS_ERROR_CODES[ApplicationsErrorCode.STAFF_LIST_ONLY],
        ),
    );

    const [students, participations, activity, dataAsOf, years] =
      await Promise.all([
        this.repository.listStudents(),
        this.repository.listApprovedParticipations(),
        this.repository.listActivityTotals(rankingYearFilter(scope)),
        this.repository.findActivityDataAsOf(),
        this.repository.listActivityYears(),
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

    return {
      scope,
      dataAsOf,
      years,
      cohorts: buildCohortRows(students, activityByGithubId, participantIds),
      departments: buildDepartmentRows(
        students,
        activityByGithubId,
        participantIds,
      ),
      programs: buildProgramRows(participations, studentsById),
    };
  }
}

function activityFor(
  student: StaffInsightsStudentRecord,
  activityByGithubId: ReadonlyMap<string, ActivityCounts>,
): ActivityCounts {
  return activityByGithubId.get(student.githubId.toString()) ?? EMPTY_ACTIVITY;
}

function addStudent(
  metrics: StaffInsightsMetrics,
  activity: ActivityCounts,
  isParticipant: boolean,
): StaffInsightsMetrics {
  const total = activityTotal(activity);
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

function buildCohortRows(
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
    const cohort = classifyDepartment(student.department);
    const current = byCohort.get(cohort);
    if (current === undefined) {
      throw new Error(`Unknown department cohort: ${cohort}`);
    }
    byCohort.set(
      cohort,
      addStudent(
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

function buildDepartmentRows(
  students: readonly StaffInsightsStudentRecord[],
  activityByGithubId: ReadonlyMap<string, ActivityCounts>,
  participantIds: ReadonlySet<string>,
): readonly StaffInsightsDepartmentRow[] {
  const byDepartment = new Map<
    string,
    { readonly cohort: DepartmentCohort; metrics: StaffInsightsMetrics }
  >();
  for (const student of students) {
    const cohort = classifyDepartment(student.department);
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
      metrics: addStudent(
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
    }))
    .sort(
      (left, right) =>
        right.total - left.total || right.studentCount - left.studentCount,
    );
}

function buildProgramRows(
  participations: readonly {
    readonly programId: string;
    readonly programName: string;
    readonly userIds: readonly string[];
  }[],
  studentsById: ReadonlyMap<string, StaffInsightsStudentRecord>,
): readonly StaffInsightsProgramRow[] {
  const byProgram = new Map<
    string,
    {
      readonly name: string;
      readonly userIds: Set<string>;
    }
  >();
  for (const participation of participations) {
    const current = byProgram.get(participation.programId) ?? {
      name: participation.programName,
      userIds: new Set<string>(),
    };
    for (const userId of participation.userIds) {
      current.userIds.add(userId);
    }
    byProgram.set(participation.programId, current);
  }
  return [...byProgram.entries()]
    .map(([programId, row]) => {
      let swMajorCount = 0;
      let nonSwCount = 0;
      let unregisteredCount = 0;
      for (const userId of row.userIds) {
        const student = studentsById.get(userId);
        const cohort = classifyDepartment(student?.department ?? null);
        if (cohort === DEPARTMENT_COHORTS.SW_MAJOR) swMajorCount += 1;
        else if (cohort === DEPARTMENT_COHORTS.NON_SW) nonSwCount += 1;
        else unregisteredCount += 1;
      }
      return {
        programId,
        name: row.name,
        swMajorCount,
        nonSwCount,
        unregisteredCount,
        participantCount: row.userIds.size,
      };
    })
    .sort((left, right) => right.participantCount - left.participantCount);
}
