import { Injectable } from '@nestjs/common';
import {
  ActivityVisibility,
  Prisma,
  ProgramLifecycle,
  type ProgramCategory,
} from '@prisma/client';
import { ContributorReadRepository } from '../platform/contributor-read.repository';
import {
  RANKING_ORDER_BY_SQL,
  STANDING_SQL,
} from '../platform/contributor-read.config';
import { BoundedReadRepository } from '../platform/bounded-read.repository';
import { PrismaService } from '../platform/prisma.service';
import {
  STAFF_INSIGHTS_ATTENTION_STUDENT_LIMIT,
  STAFF_INSIGHTS_PERIOD_LEADER_LIMIT,
  STAFF_INSIGHTS_RECENT_LEADER_LIMIT,
  UNREGISTERED_DEPARTMENT,
  type StaffInsightsFinderQuery,
} from './staff-insights-query.config';

const STANDING = Prisma.raw(STANDING_SQL);

interface StaffInsightsActivityCounts {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
}

export interface StaffInsightsDepartmentMetricsRecord {
  readonly department: string | null;
  readonly studentCount: number;
  readonly activeStudentCount: number;
  readonly total: number;
  readonly recentTotal: number | null;
  readonly participantCount: number;
}

export interface StaffInsightsLeaderCandidateRecord extends StaffInsightsActivityCounts {
  readonly githubId: bigint;
  readonly githubLogin: string;
  readonly name: string | null;
  readonly department: string | null;
  readonly total: number;
}

export interface StaffInsightsPeriodLeaderCandidateRecord extends StaffInsightsLeaderCandidateRecord {
  readonly studentId: string | null;
  readonly recentTotal: number | null;
  readonly previousOverallRank: number | null;
  readonly previousCohortRank: number | null;
}

export interface StaffInsightsAttentionStudentRecord {
  readonly name: string | null;
  readonly githubLogin: string;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly total: number;
}

export interface StaffInsightsProgramDepartmentRecord {
  readonly programId: string;
  readonly department: string | null;
  readonly participantCount: number;
}

export interface StaffInsightsParticipantCountRecord {
  readonly uniqueParticipantCount: number;
  readonly repeatParticipantCount: number;
}

export interface StaffInsightsRecentWindow {
  readonly cutoff: Date;
  readonly now: Date;
  readonly cutoffYear: number;
  readonly nowYear: number;
}

export interface StaffInsightsProgramRecord {
  readonly id: string;
  readonly name: string;
  readonly category: ProgramCategory;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly startAt: Date;
  readonly endAt: Date;
}

export interface StaffInsightsApplicationCountRecord {
  readonly programId: string;
  readonly appliedCount: number;
  readonly approvedCount: number;
}

export interface StaffInsightsCompletionRecord {
  readonly programId: string;
  readonly dueRequirementCount: number;
  readonly submittedRequirementCount: number;
}

export interface StaffInsightsOutcomeRecord {
  readonly programId: string;
  readonly repoTeamCount: number;
  readonly activeTeamCount: number;
  readonly contributionCount: number;
}

export interface StaffInsightsActivityQuery {
  readonly currentYear?: number;
}

export interface StaffInsightsFinderRow {
  readonly name: string | null;
  readonly githubLogin: string;
  readonly studentId: string | null;
  readonly major: string | null;
  readonly total: number;
  readonly recentTotal: number | null;
  readonly collaborationRatio: number | null;
  readonly programIds: readonly string[];
}

export interface StaffInsightsFinderPage {
  readonly rows: readonly StaffInsightsFinderRow[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

const FINDER_PAGE_SIZE = 20;
const FINDER_SORT_COLUMNS: Readonly<
  Record<StaffInsightsFinderQuery['sort'], Prisma.Sql>
> = {
  name: Prisma.sql`lower(name) COLLATE "C"`,
  studentId: Prisma.sql`"studentId" COLLATE "C"`,
  total: Prisma.sql`total`,
  recentTotal: Prisma.sql`recent_total`,
  collaborationRatio: Prisma.sql`collaboration_ratio`,
};

const PUBLIC_STANDING = Prisma.sql`
  SELECT * FROM ${STANDING} WHERE visibility = 'PUBLIC'::"ActivityVisibility"
`;

const APPROVED_PARTICIPANTS = Prisma.sql`
  SELECT team."programId" AS program_id, team."applicantId" AS user_id
  FROM "Team" AS team
  WHERE team.status = 'APPROVED' AND team."archivedAt" IS NULL
  UNION
  SELECT team."programId", member."userId"
  FROM "TeamMember" AS member
  JOIN "Team" AS team ON team.id = member."teamId"
  WHERE team.status = 'APPROVED' AND team."archivedAt" IS NULL
`;

const PUBLISHED_PARTICIPANTS = Prisma.sql`
  SELECT approved.program_id, approved.user_id
  FROM (${APPROVED_PARTICIPANTS}) AS approved
  JOIN "Program" AS program ON program.id = approved.program_id
  WHERE program.lifecycle = 'PUBLISHED'
`;

const DEPARTMENT_MISSING = Prisma.sql`
  student.department IS NULL OR btrim(student.department, E' \\t\\n\\r') = ''
`;

const LEADER_COLUMNS = Prisma.sql`
  leader.github_id AS "githubId",
  leader.login AS "githubLogin",
  leader.name,
  leader.department,
  leader.commit_count AS "commitCount",
  leader.pull_request_count AS "pullRequestCount",
  leader.issue_count AS "issueCount",
  leader.repository_count AS "repositoryCount",
  leader.star_count AS "starCount",
  leader.total
`;

function cohortSql(swMajorDepartments: readonly string[]): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN ${DEPARTMENT_MISSING} THEN 'unregistered'
      WHEN student.department = ANY(${[...swMajorDepartments]}::text[]) THEN 'sw-major'
      ELSE 'non-sw'
    END
  `;
}

function rankedCandidatesSql(
  activity: Prisma.Sql,
  swMajorDepartments: readonly string[],
): Prisma.Sql {
  const order = Prisma.sql`ORDER BY ${Prisma.raw(RANKING_ORDER_BY_SQL)}`;
  return Prisma.sql`
    WITH activity AS (${activityWithTotalSql(activity)}),
    candidates AS (
      SELECT
        student."githubId" AS github_id,
        student.login,
        student.name,
        student.department,
        student."studentId" AS student_id,
        ${cohortSql(swMajorDepartments)} AS cohort,
        activity.commit_count,
        activity.pull_request_count,
        activity.issue_count,
        activity.repository_count,
        activity.star_count,
        activity.total
      FROM "User" AS student
      JOIN activity ON activity.github_id = student."githubId"
      WHERE student.type = 'STUDENT'
        AND student."accountStatus" = 'ACTIVE'
        AND student.login <> ''
    )
    SELECT
      candidates.*,
      ROW_NUMBER() OVER (${order}) AS overall_rank,
      ROW_NUMBER() OVER (PARTITION BY cohort ${order}) AS cohort_rank
    FROM candidates
    WHERE total > 0
  `;
}

function topLeadersFilter(limit: number): Prisma.Sql {
  return Prisma.sql`
    leader.overall_rank <= ${limit}
    OR (leader.cohort <> 'unregistered' AND leader.cohort_rank <= ${limit})
  `;
}

function activityWithTotalSql(activity: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT activity.*,
      commit_count + pull_request_count + issue_count + repository_count + star_count AS total
    FROM (${activity}) AS activity
  `;
}

function foldedActivitySql(query: StaffInsightsActivityQuery): Prisma.Sql {
  const year =
    query.currentYear === undefined
      ? Prisma.empty
      : Prisma.sql`WHERE year = ${query.currentYear}`;
  return Prisma.sql`
    SELECT
      github_id,
      SUM(commit_count)::int AS commit_count,
      SUM(pull_request_count)::int AS pull_request_count,
      SUM(issue_count)::int AS issue_count,
      SUM(repository_count)::int AS repository_count,
      ((ARRAY_AGG(star_count ORDER BY year DESC))[1])::int AS star_count
    FROM (${PUBLIC_STANDING}) AS standing
    ${year}
    GROUP BY github_id
  `;
}

function recentActivitySql(window: StaffInsightsRecentWindow): Prisma.Sql {
  return Prisma.sql`
    WITH current_year AS (
      SELECT * FROM (${PUBLIC_STANDING}) AS standing
      WHERE year = ${window.cutoffYear}
    ),
    baseline AS (
      SELECT DISTINCT ON (observation.github_id)
        observation.github_id,
        observation.commit_count,
        observation.pull_request_count,
        observation.issue_count,
        observation.repository_count
      FROM github_user_activity_history AS observation
      WHERE observation.observed_at < ${window.cutoff}
        AND observation.year = ${window.cutoffYear}
        AND observation.visibility = 'PUBLIC'::"ActivityVisibility"
      ORDER BY observation.github_id, observation.observed_at DESC
    ),
    combined AS (
      SELECT
        current_year.github_id,
        GREATEST(0, current_year.commit_count - baseline.commit_count) AS commit_count,
        GREATEST(0, current_year.pull_request_count - baseline.pull_request_count) AS pull_request_count,
        GREATEST(0, current_year.issue_count - baseline.issue_count) AS issue_count,
        GREATEST(0, current_year.repository_count - baseline.repository_count) AS repository_count,
        current_year.observed_at BETWEEN ${window.cutoff} AND ${window.now} AS reobserved
      FROM current_year
      JOIN baseline USING (github_id)
      ${
        window.nowYear === window.cutoffYear
          ? Prisma.empty
          : Prisma.sql`
            UNION ALL
            SELECT github_id, commit_count, pull_request_count, issue_count, repository_count,
              standing.observed_at BETWEEN ${window.cutoff} AND ${window.now} AS reobserved
            FROM (${PUBLIC_STANDING}) AS standing
            WHERE year = ${window.nowYear}
              AND NOT EXISTS (
                SELECT 1 FROM current_year
                LEFT JOIN baseline USING (github_id)
                WHERE current_year.github_id = standing.github_id
                  AND baseline.github_id IS NULL
              )
          `
      }
    )
    SELECT
      github_id,
      SUM(commit_count)::int AS commit_count,
      SUM(pull_request_count)::int AS pull_request_count,
      SUM(issue_count)::int AS issue_count,
      SUM(repository_count)::int AS repository_count,
      0 AS star_count,
      BOOL_OR(reobserved) AS reobserved
    FROM combined
    GROUP BY github_id
  `;
}

function measuredRecentTotalsSql(
  window: StaffInsightsRecentWindow,
): Prisma.Sql {
  return Prisma.sql`
    SELECT github_id, total
    FROM (${activityWithTotalSql(recentActivitySql(window))}) AS recent
    WHERE total > 0 OR reobserved
  `;
}

function afterNullable(
  column: Prisma.Sql,
  after: string | null | undefined,
): Prisma.Sql {
  if (after === undefined) return Prisma.sql`TRUE`;
  return after === null
    ? Prisma.sql`${column} IS NOT NULL`
    : Prisma.sql`${column} > ${after}`;
}

function afterKey(column: Prisma.Sql, after: string | undefined): Prisma.Sql {
  return after === undefined
    ? Prisma.sql`TRUE`
    : Prisma.sql`${column} > ${after}`;
}

@Injectable()
export class StaffInsightsRepository {
  private readonly boundedReads = new BoundedReadRepository();

  private readonly contributors: ContributorReadRepository;

  constructor(private readonly prisma: PrismaService) {
    this.contributors = new ContributorReadRepository(prisma);
  }

  async listDepartmentMetrics(
    query: StaffInsightsActivityQuery,
    window: StaffInsightsRecentWindow,
  ): Promise<readonly StaffInsightsDepartmentMetricsRecord[]> {
    return this.boundedReads.readAllInBatches(
      (after: string | null | undefined, take) =>
        this.prisma.$queryRaw<StaffInsightsDepartmentMetricsRecord[]>`
      WITH activity AS (${activityWithTotalSql(foldedActivitySql(query))}),
      recent AS (${measuredRecentTotalsSql(window)}),
      participants AS (
        SELECT DISTINCT user_id FROM (${APPROVED_PARTICIPANTS}) AS approved
      ),
      students AS (
        SELECT
          student.department,
          COALESCE(activity.total, 0) AS total,
          recent.total AS recent_total,
          participants.user_id IS NOT NULL AS participant
        FROM "User" AS student
        LEFT JOIN activity ON activity.github_id = student."githubId"
        LEFT JOIN recent ON recent.github_id = student."githubId"
        LEFT JOIN participants ON participants.user_id = student.id
        WHERE student.type = 'STUDENT'
          AND student."accountStatus" = 'ACTIVE'
          AND ${afterNullable(Prisma.sql`student.department`, after)}
      )
      SELECT
        department,
        COUNT(*)::int AS "studentCount",
        COUNT(*) FILTER (WHERE total > 0)::int AS "activeStudentCount",
        SUM(total)::int AS total,
        CASE WHEN COUNT(recent_total) = COUNT(*)
          THEN SUM(recent_total)::int END AS "recentTotal",
        COUNT(*) FILTER (WHERE participant)::int AS "participantCount"
      FROM students
      GROUP BY department
      ORDER BY department NULLS FIRST
      LIMIT ${take}
    `,
      (row) => row.department,
    );
  }

  async listPeriodLeaderCandidates(
    query: StaffInsightsActivityQuery,
    swMajorDepartments: readonly string[],
    window: StaffInsightsRecentWindow,
  ): Promise<readonly StaffInsightsPeriodLeaderCandidateRecord[]> {
    const priorRanks =
      query.currentYear === undefined
        ? Prisma.sql`SELECT NULL::bigint AS github_id, NULL::int AS overall_rank, NULL::int AS cohort_rank WHERE FALSE`
        : rankedCandidatesSql(
            foldedActivitySql({ currentYear: query.currentYear - 1 }),
            swMajorDepartments,
          );
    return this.prisma.$queryRaw<StaffInsightsPeriodLeaderCandidateRecord[]>`
      WITH recent AS (${measuredRecentTotalsSql(window)}),
        prior AS (${priorRanks})
      SELECT ${LEADER_COLUMNS},
        leader.student_id AS "studentId",
        recent.total AS "recentTotal",
        prior.overall_rank::int AS "previousOverallRank",
        prior.cohort_rank::int AS "previousCohortRank"
      FROM (${rankedCandidatesSql(foldedActivitySql(query), swMajorDepartments)}) AS leader
      LEFT JOIN recent ON recent.github_id = leader.github_id
      LEFT JOIN prior ON prior.github_id = leader.github_id
      WHERE ${topLeadersFilter(STAFF_INSIGHTS_PERIOD_LEADER_LIMIT)}
      ORDER BY leader.overall_rank
      LIMIT ${STAFF_INSIGHTS_PERIOD_LEADER_LIMIT * 3}
    `;
  }

  async listRecentLeaderCandidates(
    window: StaffInsightsRecentWindow,
    swMajorDepartments: readonly string[],
  ): Promise<readonly StaffInsightsLeaderCandidateRecord[]> {
    return this.prisma.$queryRaw<StaffInsightsLeaderCandidateRecord[]>`
      SELECT ${LEADER_COLUMNS}
      FROM (${rankedCandidatesSql(recentActivitySql(window), swMajorDepartments)}) AS leader
      WHERE ${topLeadersFilter(STAFF_INSIGHTS_RECENT_LEADER_LIMIT)}
      ORDER BY leader.overall_rank
      LIMIT ${STAFF_INSIGHTS_RECENT_LEADER_LIMIT * 3}
    `;
  }

  async listAttentionStudents(
    query: StaffInsightsActivityQuery,
    window: StaffInsightsRecentWindow,
  ): Promise<readonly StaffInsightsAttentionStudentRecord[]> {
    return this.prisma.$queryRaw<StaffInsightsAttentionStudentRecord[]>`
      WITH period AS (${activityWithTotalSql(foldedActivitySql(query))}),
        recent AS (${measuredRecentTotalsSql(window)})
      SELECT student.name, student.login AS "githubLogin", student."studentId",
        student.department, period.total
      FROM "User" AS student
      JOIN period ON period.github_id = student."githubId"
      JOIN recent ON recent.github_id = student."githubId"
      WHERE student.type = 'STUDENT'
        AND student."accountStatus" = 'ACTIVE'
        AND student.login <> ''
        AND period.total > 0
        AND recent.total = 0
      ORDER BY student.id COLLATE "C"
      LIMIT ${STAFF_INSIGHTS_ATTENTION_STUDENT_LIMIT}
    `;
  }

  async findStudents(
    query: StaffInsightsFinderQuery,
    window: StaffInsightsRecentWindow,
  ): Promise<StaffInsightsFinderPage> {
    const direction =
      query.direction === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const order = Prisma.sql`${FINDER_SORT_COLUMNS[query.sort]} ${direction} NULLS LAST, id COLLATE "C"`;
    const search = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`;
    const [result] = await this.prisma.$queryRaw<
      Pick<StaffInsightsFinderPage, 'rows' | 'total'>[]
    >`
      WITH period AS (${activityWithTotalSql(foldedActivitySql(query))}),
      recent AS (${measuredRecentTotalsSql(window)}),
      participants AS (${PUBLISHED_PARTICIPANTS}),
      filtered AS (
        SELECT student.id, student.name, student.login, student."studentId",
          COALESCE(period.total, 0) AS total,
          recent.total AS recent_total,
          (period.pull_request_count + period.issue_count)::float8
            / NULLIF(period.total, 0) AS collaboration_ratio
        FROM "User" AS student
        LEFT JOIN period ON period.github_id = student."githubId"
        LEFT JOIN recent ON recent.github_id = student."githubId"
        WHERE student.type = 'STUDENT'
          AND student."accountStatus" = 'ACTIVE'
          AND COALESCE(period.total, 0) >= ${query.minActivity}
          ${
            query.search
              ? Prisma.sql`AND (student.name ILIKE ${search} OR student.login ILIKE ${search} OR student."studentId" LIKE ${search})`
              : Prisma.empty
          }
          ${
            query.department
              ? Prisma.sql`AND (CASE WHEN ${DEPARTMENT_MISSING} THEN ${UNREGISTERED_DEPARTMENT} ELSE student.department END) = ${query.department}`
              : Prisma.empty
          }
          ${
            query.programId
              ? Prisma.sql`AND EXISTS (SELECT 1 FROM participants WHERE user_id = student.id AND program_id = ${query.programId})`
              : Prisma.empty
          }
          ${
            query.recentActivity === 'all'
              ? Prisma.empty
              : query.recentActivity === 'active'
                ? Prisma.sql`AND recent.total > 0`
                : Prisma.sql`AND recent.total = 0`
          }
      )
      SELECT (SELECT COUNT(*)::int FROM filtered) AS total,
        COALESCE(json_agg(json_build_object(
          'name', page.name,
          'githubLogin', page.login,
          'studentId', page."studentId",
          'major', NULL::text,
          'total', page.total,
          'recentTotal', page.recent_total,
          'collaborationRatio', page.collaboration_ratio,
          'programIds', ARRAY(SELECT program_id FROM participants WHERE user_id = page.id ORDER BY program_id COLLATE "C")
        ) ORDER BY ${order}), '[]'::json) AS rows
      FROM (
        SELECT * FROM filtered ORDER BY ${order}
        LIMIT ${FINDER_PAGE_SIZE} OFFSET ${(query.page - 1) * FINDER_PAGE_SIZE}
      ) AS page
      LIMIT 1
    `;
    if (result === undefined)
      throw new Error('Student finder returned no page');
    return { ...result, page: query.page, pageSize: FINDER_PAGE_SIZE };
  }

  async listProgramParticipantDepartments(): Promise<
    readonly StaffInsightsProgramDepartmentRecord[]
  > {
    return this.boundedReads.readAllInBatches(
      (
        after:
          | { readonly programId: string; readonly department: string | null }
          | undefined,
        take,
      ) =>
        this.prisma.$queryRaw<StaffInsightsProgramDepartmentRecord[]>`
      SELECT "programId", department, "participantCount"
      FROM (
        SELECT
          approved.program_id AS "programId",
          CASE
            WHEN student.type = 'STUDENT' AND student."accountStatus" = 'ACTIVE'
              THEN student.department
          END AS department,
          COUNT(DISTINCT approved.user_id)::int AS "participantCount"
        FROM (${PUBLISHED_PARTICIPANTS}) AS approved
        JOIN "User" AS student ON student.id = approved.user_id
        GROUP BY 1, 2
      ) AS grouped
      WHERE ${
        after === undefined
          ? Prisma.sql`TRUE`
          : Prisma.sql`("programId" > ${after.programId} OR ("programId" = ${after.programId} AND ${afterNullable(Prisma.sql`department`, after.department)}))`
      }
      ORDER BY "programId", department NULLS FIRST
      LIMIT ${take}
    `,
      (row) => ({ programId: row.programId, department: row.department }),
    );
  }

  async countPublishedParticipants(): Promise<StaffInsightsParticipantCountRecord> {
    const [row] = await this.prisma.$queryRaw<
      StaffInsightsParticipantCountRecord[]
    >`
      SELECT
        COUNT(*)::int AS "uniqueParticipantCount",
        COUNT(*) FILTER (WHERE program_count >= 2)::int AS "repeatParticipantCount"
      FROM (
        SELECT approved.user_id, COUNT(DISTINCT approved.program_id) AS program_count
        FROM (${PUBLISHED_PARTICIPANTS}) AS approved
        GROUP BY approved.user_id
      ) AS per_user
      LIMIT 1
    `;
    if (row === undefined)
      throw new Error('Participant count query did not return a row');
    return row;
  }

  async listPublishedPrograms(): Promise<
    readonly StaffInsightsProgramRecord[]
  > {
    return this.boundedReads.readAllInBatches(
      (after: string | undefined, take) =>
        this.prisma.program.findMany({
          take,
          where: {
            lifecycle: ProgramLifecycle.PUBLISHED,
            ...(after === undefined ? {} : { id: { gt: after } }),
          },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            name: true,
            category: true,
            applicationStartAt: true,
            applicationEndAt: true,
            startAt: true,
            endAt: true,
          },
        }),
      (program) => program.id,
    );
  }

  async listProgramApplicationCounts(): Promise<
    readonly StaffInsightsApplicationCountRecord[]
  > {
    return this.boundedReads.readAllInBatches(
      (after: string | undefined, take) =>
        this.prisma.$queryRaw<StaffInsightsApplicationCountRecord[]>`
      SELECT
        team."programId" AS "programId",
        COUNT(*)::int AS "appliedCount",
        COUNT(*) FILTER (WHERE team.status = 'APPROVED')::int AS "approvedCount"
      FROM "Team" AS team
      JOIN "Program" AS program ON program.id = team."programId"
      WHERE team."archivedAt" IS NULL
        AND program.lifecycle = 'PUBLISHED'
        AND ${afterKey(Prisma.sql`team."programId"`, after)}
      GROUP BY team."programId"
      ORDER BY team."programId"
      LIMIT ${take}
    `,
      (row) => row.programId,
    );
  }

  async listProgramCompletion(
    now: Date,
  ): Promise<readonly StaffInsightsCompletionRecord[]> {
    return this.boundedReads.readAllInBatches(
      (after: string | undefined, take) =>
        this.prisma.$queryRaw<StaffInsightsCompletionRecord[]>`
      SELECT
        team."programId" AS "programId",
        COUNT(*)::int AS "dueRequirementCount",
        COUNT(submission.id) FILTER (
          WHERE submission.status <> 'REJECTED'
        )::int AS "submittedRequirementCount"
      FROM "Team" AS team
      JOIN "Program" AS program ON program.id = team."programId"
      JOIN "Milestone" AS milestone ON milestone."programId" = team."programId"
      JOIN "Requirement" AS requirement
        ON requirement."milestoneId" = milestone.id
      LEFT JOIN "Submission" AS submission
        ON submission."requirementId" = requirement.id
        AND submission."teamId" = team.id
      WHERE team.status = 'APPROVED'
        AND team."archivedAt" IS NULL
        AND program.lifecycle = 'PUBLISHED'
        AND requirement.required = true
        AND milestone."dueAt" <= (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')
        AND ${afterKey(Prisma.sql`team."programId"`, after)}
      GROUP BY team."programId"
      ORDER BY team."programId"
      LIMIT ${take}
    `,
      (row) => row.programId,
    );
  }

  async listProgramOutcomes(
    now: Date,
  ): Promise<readonly StaffInsightsOutcomeRecord[]> {
    return this.boundedReads.readAllInBatches(
      (after: string | undefined, take) =>
        this.prisma.$queryRaw<StaffInsightsOutcomeRecord[]>`
      WITH linked AS (
        SELECT
          team."programId" AS program_id,
          team.id AS team_id,
          link.repo_id,
          link.valid_from,
          link.valid_to,
          program."startAt" AT TIME ZONE 'UTC' AS window_start,
          LEAST(
            program."endAt" AT TIME ZONE 'UTC',
            ${now.toISOString()}::timestamptz
          ) AS window_end
        FROM "Team" AS team
        JOIN "Program" AS program ON program.id = team."programId"
        JOIN "team_repo" AS link ON link.team_id = team.id
        WHERE team.status = 'APPROVED'
          AND team."archivedAt" IS NULL
          AND program.lifecycle = 'PUBLISHED'
          AND ${afterKey(Prisma.sql`team."programId"`, after)}
      ),
      matched AS (
        SELECT DISTINCT
          linked.program_id,
          linked.team_id,
          event.repo_id,
          event.kind,
          event.github_key
        FROM linked
        JOIN "contribution" AS event ON event.repo_id = linked.repo_id
        WHERE event.kind IN (
            'commit'::"contribution_kind",
            'pull_request'::"contribution_kind",
            'issue'::"contribution_kind"
          )
          AND event.occurred_at >= linked.window_start
          AND event.occurred_at < linked.window_end
          AND event.occurred_at >= linked.valid_from
          AND (linked.valid_to IS NULL OR event.occurred_at < linked.valid_to)
      )
      SELECT
        program_id AS "programId",
        repo_teams.repo_team_count AS "repoTeamCount",
        COALESCE(active_teams.active_team_count, 0)::int AS "activeTeamCount",
        COALESCE(events.contribution_count, 0)::int AS "contributionCount"
      FROM (
        SELECT program_id, COUNT(DISTINCT team_id)::int AS repo_team_count
        FROM linked
        GROUP BY program_id
      ) AS repo_teams
      LEFT JOIN (
        SELECT program_id, COUNT(DISTINCT team_id)::int AS active_team_count
        FROM matched
        GROUP BY program_id
      ) AS active_teams USING (program_id)
      LEFT JOIN (
        SELECT program_id, COUNT(*)::int AS contribution_count
        FROM (
          SELECT DISTINCT program_id, repo_id, kind, github_key FROM matched
        ) AS distinct_events
        GROUP BY program_id
      ) AS events USING (program_id)
      ORDER BY program_id
      LIMIT ${take}
    `,
      (row) => row.programId,
    );
  }

  async listActivityYears(): Promise<readonly number[]> {
    return this.contributors.readStandingYears({
      year: null,
      visibility: ActivityVisibility.PUBLIC,
    });
  }

  async findActivityDataAsOf(): Promise<Date | null> {
    return this.contributors.readStandingObservedAt({
      year: null,
      visibility: ActivityVisibility.PUBLIC,
    });
  }
}
