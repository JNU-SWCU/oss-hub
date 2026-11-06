import { Injectable } from '@nestjs/common';
import {
  Prisma,
  ProgramLifecycle,
  type Program,
  ApplicationStatus,
  ProgramCategory,
  type ProgramTrackType,
  type ProgramHistoryEvent,
  type Prisma as PrismaTypes,
  AccountStatus,
} from '@prisma/client';
import {
  PROGRAM_LIST_QUERY_STATUSES,
  PROGRAM_LIST_QUERY_SORTS,
  PROGRAM_LIST_QUERY_DIRECTIONS,
} from './program-list.config';
import {
  USER_AUTHORITY_SELECT,
  USER_PROFILE_NAME_SELECT,
} from '../platform/user-profile-read.config';
import { PrismaService } from '../platform/prisma.service';
import { PlatformRepository } from '../platform/platform.repository';
import {
  ProgramCoverRepository,
  ProgramAuthoringUploadTransactionRepository,
} from './files.repository';
import {
  type ProgramAuthoringProgramPlan,
  type ProgramExternalCover,
  type ProgramAuthoringProgram,
  type ProgramAuthoringCreateRequestInput,
  type ProgramAuthoringMilestonePlan,
  type ProgramAuthoringDocumentPlan,
  type ProgramAuthoringTemplateInput,
  type ProgramAuthoringReplay,
  type ProgramAuthoringUploadToken,
} from './files.config';
import type { MemberKind } from '../users/user-contract.config';
export type ProgramListQueryStatus =
  (typeof PROGRAM_LIST_QUERY_STATUSES)[number];

export type ProgramListQuerySort = (typeof PROGRAM_LIST_QUERY_SORTS)[number];

export type ProgramListQueryDirection =
  (typeof PROGRAM_LIST_QUERY_DIRECTIONS)[number];

export interface ProgramListQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly search: string;
  readonly status: ProgramListQueryStatus;
  readonly year?: number;

  readonly sort?: ProgramListQuerySort;

  readonly direction?: ProgramListQueryDirection;
}

export type ProgramListDerivedStatus = Exclude<
  ProgramListQueryStatus,
  'all' | 'current'
>;

export type ProgramListStatusInput = {
  readonly lifecycle: ProgramLifecycle;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly endAt: Date;
};

@Injectable()
export class ProgramListStatusFilterRepository {
  deriveProgramListStatus(
    program: ProgramListStatusInput,
    now: Date,
  ): ProgramListDerivedStatus {
    if (program.lifecycle === ProgramLifecycle.ARCHIVED) return 'ended';
    if (program.endAt < now) return 'ended';
    if (program.applicationStartAt > now) return 'upcoming';
    if (program.applicationEndAt >= now) return 'recruiting';
    return 'in_progress';
  }

  programListSortRank(status: ProgramListDerivedStatus): 0 | 1 | 2 | 3 {
    switch (status) {
      case 'recruiting':
        return 0;
      case 'upcoming':
        return 1;
      case 'in_progress':
        return 2;
      case 'ended':
        return 3;
    }
  }

  programListPrismaWhere(
    status: ProgramListQueryStatus,
    now: Date,
  ): Prisma.ProgramWhereInput {
    const whereByStatus = {
      current: {
        lifecycle: ProgramLifecycle.PUBLISHED,
        ...notDateEnded(now),
      },
      all: {
        lifecycle: {
          in: [ProgramLifecycle.PUBLISHED, ProgramLifecycle.ARCHIVED],
        },
      },
      ended: {
        OR: [
          { lifecycle: ProgramLifecycle.ARCHIVED },
          {
            lifecycle: ProgramLifecycle.PUBLISHED,
            endAt: { lt: now },
          },
        ],
      },
      upcoming: {
        lifecycle: ProgramLifecycle.PUBLISHED,
        applicationStartAt: { gt: now },
        ...notDateEnded(now),
      },
      recruiting: {
        lifecycle: ProgramLifecycle.PUBLISHED,
        applicationStartAt: { lte: now },
        applicationEndAt: { gte: now },
        ...notDateEnded(now),
      },
      in_progress: {
        lifecycle: ProgramLifecycle.PUBLISHED,
        applicationStartAt: { lte: now },
        applicationEndAt: { lt: now },
        ...notDateEnded(now),
      },
    } satisfies Readonly<
      Record<ProgramListQueryStatus, Prisma.ProgramWhereInput>
    >;
    return whereByStatus[status];
  }

  programListSqlStatusPredicate(
    status: ProgramListQueryStatus,
    now: Date,
  ): Prisma.Sql {
    if (status === 'all') {
      return Prisma.sql`p."lifecycle" IN ('PUBLISHED', 'ARCHIVED')`;
    }
    if (status === 'current') {
      return Prisma.sql`p."lifecycle" = 'PUBLISHED' AND p."endAt" >= ${now}`;
    }
    return Prisma.sql`p."lifecycle" IN ('PUBLISHED', 'ARCHIVED') AND (${programListStatusCaseSql(now)}) = ${status}`;
  }

  programEndYearRange(year: number) {
    return {
      gte: new Date(Date.UTC(year, 0, 1, -9)),
      lt: new Date(Date.UTC(year + 1, 0, 1, -9)),
    };
  }

  programListSortRankSql(now: Date): Prisma.Sql {
    return Prisma.sql`
    CASE (${programListStatusCaseSql(now)})
      WHEN 'recruiting' THEN 0
      WHEN 'upcoming' THEN 1
      WHEN 'in_progress' THEN 2
      WHEN 'ended' THEN 3
    END
  `;
  }

  programListStatusSortRank(status: ProgramListDerivedStatus): 0 | 1 | 2 | 3 {
    switch (status) {
      case 'recruiting':
        return 0;
      case 'in_progress':
        return 1;
      case 'upcoming':
        return 2;
      case 'ended':
        return 3;
    }
  }

  programListOrderBySql(
    sort: ProgramListQuerySort | undefined,
    direction: ProgramListQueryDirection | undefined,
    now: Date,
  ): Prisma.Sql {
    const dir = direction === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    switch (sort) {
      case 'name':
        return Prisma.sql`p."name" ${dir}, p."id" ASC`;
      case 'applicationPeriod':
        return Prisma.sql`p."applicationStartAt" ${dir}, p."id" ASC`;
      case 'status':
        return Prisma.sql`
        ${programListStatusSortRankSql(now)} ${dir},
        p."applicationEndAt" ASC,
        p."name" ASC,
        p."id" ASC
      `;
      default:
        return Prisma.sql`
        ${this.programListSortRankSql(now)} ASC,
        p."applicationEndAt" ASC,
        p."name" ASC,
        p."id" ASC
      `;
    }
  }

  programListSqlWhere(
    status: ProgramListQueryStatus,
    search: string,
    now: Date,
    year?: number,
  ): Prisma.Sql {
    const conditions: Prisma.Sql[] = [
      this.programListSqlStatusPredicate(status, now),
    ];
    if (year !== undefined) {
      const { gte, lt } = this.programEndYearRange(year);
      conditions.push(Prisma.sql`p."endAt" >= ${gte} AND p."endAt" < ${lt}`);
    }
    if (search) {
      conditions.push(Prisma.sql`p."name" ILIKE ${`%${search}%`}`);
    }
    return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
  }

  programStatusCountsSql(now: Date): Prisma.Sql {
    const statusCase = programListStatusCaseSql(now);
    return Prisma.sql`
    SELECT
      COUNT(*)::int AS "all",
      COUNT(*) FILTER (WHERE (${statusCase}) = 'recruiting')::int AS recruiting,
      COUNT(*) FILTER (WHERE (${statusCase}) = 'in_progress')::int AS in_progress,
      COUNT(*) FILTER (WHERE (${statusCase}) = 'upcoming')::int AS upcoming,
      COUNT(*) FILTER (WHERE (${statusCase}) = 'ended')::int AS ended
    FROM "Program" AS p
    WHERE p."lifecycle" IN ('PUBLISHED', 'ARCHIVED')
  `;
  }
}

const notDateEnded = (now: Date): Prisma.ProgramWhereInput => ({
  endAt: { gte: now },
});

function programListStatusCaseSql(now: Date): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN p."lifecycle" = 'ARCHIVED' THEN 'ended'
      WHEN p."endAt" < ${now} THEN 'ended'
      WHEN p."applicationStartAt" > ${now} THEN 'upcoming'
      WHEN p."applicationEndAt" >= ${now} THEN 'recruiting'
      ELSE 'in_progress'
    END
  `;
}

function programListStatusSortRankSql(now: Date): Prisma.Sql {
  return Prisma.sql`
    CASE (${programListStatusCaseSql(now)})
      WHEN 'recruiting' THEN 0
      WHEN 'in_progress' THEN 1
      WHEN 'upcoming' THEN 2
      WHEN 'ended' THEN 3
    END
  `;
}
export type ProgramListRecord = {
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly trackType: ProgramTrackType | null;
  readonly applicationTemplateKey: string;
  readonly lifecycle: ProgramLifecycle;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly endAt: Date;
  readonly description: string;
  readonly teamMinSize: number;
  readonly teamMaxSize: number;
  readonly coverId?: string | null;
  readonly coverExternalImageUrl?: string | null;
};
export type ProgramStatusCounts = {
  readonly all: number;
  readonly recruiting: number;
  readonly in_progress: number;
  readonly upcoming: number;
  readonly ended: number;
};
function emptyProgramStatusCounts(): ProgramStatusCounts {
  return {
    all: 0,
    recruiting: 0,
    in_progress: 0,
    upcoming: 0,
    ended: 0,
  };
}
export interface ProgramApplicationCounts {
  readonly total: number;
  readonly pending: number;
}
@Injectable()
export class ProgramsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRepository: PlatformRepository,
    private readonly programListStatusFilterRepository: ProgramListStatusFilterRepository,
  ) {}
  listPrograms(query: ProgramListQuery, now: Date) {
    const where: Prisma.ProgramWhereInput = {
      ...this.programListStatusFilterRepository.programListPrismaWhere(
        query.status,
        now,
      ),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
      ...(query.year !== undefined
        ? {
            AND: [
              {
                endAt:
                  this.programListStatusFilterRepository.programEndYearRange(
                    query.year,
                  ),
              },
            ],
          }
        : {}),
    };
    const sqlWhere = this.programListStatusFilterRepository.programListSqlWhere(
      query.status,
      query.search,
      now,
      query.year,
    );
    const orderBy =
      this.programListStatusFilterRepository.programListOrderBySql(
        query.sort,
        query.direction,
        now,
      );
    const offset = (query.page - 1) * query.pageSize;
    return this.prisma.$transaction([
      this.prisma.$queryRaw<readonly ProgramListRecord[]>(Prisma.sql`
        SELECT
          p."id",
          p."name",
          p."organizer",
          p."trackType",
          p."applicationTemplateKey",
          p."lifecycle",
          p."applicationStartAt",
          p."applicationEndAt",
          p."endAt",
          p."description",
          p."teamMinSize",
          p."teamMaxSize",
          p."coverFileId" AS "coverId",
          p."coverImageUrl" AS "coverExternalImageUrl"
        FROM "Program" AS p
        ${sqlWhere}
        ORDER BY ${orderBy}
        LIMIT ${query.pageSize}
        OFFSET ${offset}
      `),
      this.prisma.program.count({ where }),
    ]);
  }
  async findEndedYears(now: Date): Promise<readonly number[]> {
    const programEndYearSql = Prisma.sql`EXTRACT(YEAR FROM p."endAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::int`;
    const rows = await this.prisma.$queryRaw<
      readonly {
        readonly year: number;
      }[]
    >(Prisma.sql`
      SELECT DISTINCT ${programEndYearSql} AS year
      FROM "Program" AS p
      ${this.programListStatusFilterRepository.programListSqlWhere('ended', '', now)}
      AND ${programEndYearSql} BETWEEN 2000 AND 2100
      ORDER BY year DESC
    `);
    return rows.map((row) => row.year);
  }
  async countProgramsByStatus(now: Date): Promise<ProgramStatusCounts> {
    const rows = await this.prisma.$queryRaw<
      readonly {
        readonly all: number;
        readonly recruiting: number;
        readonly in_progress: number;
        readonly upcoming: number;
        readonly ended: number;
      }[]
    >(this.programListStatusFilterRepository.programStatusCountsSql(now));
    const row = rows[0];
    if (!row) return emptyProgramStatusCounts();
    return {
      all: row.all,
      recruiting: row.recruiting,
      in_progress: row.in_progress,
      upcoming: row.upcoming,
      ended: row.ended,
    };
  }
  findProgramDetail(programId: string) {
    return this.prisma.program.findUnique({
      where: { id: programId, lifecycle: { not: 'DELETED' } },
      select: {
        lifecycle: true,
        coverFileId: true,
        coverImageUrl: true,
        id: true,
        name: true,
        organizer: true,
        trackType: true,
        applicationTemplateKey: true,
        teamMinSize: true,
        teamMaxSize: true,
        description: true,
        repositoryProvisioningEnabled: true,
        applicationStartAt: true,
        applicationEndAt: true,
        startAt: true,
        endAt: true,
        milestones: {
          orderBy: [{ dueAt: 'asc' as const }, { createdAt: 'asc' as const }],
          select: {
            id: true,
            name: true,
            startAt: true,
            dueAt: true,
            instructions: true,
            _count: {
              select: {
                requirements: {
                  where: {},
                },
              },
            },
            requirements: {
              where: {
                required: true,
              },
              select: { id: true },
            },
          },
        },
      },
    });
  }
  async findStudentApplication(programId: string, userId: string) {
    return this.prisma.team.findFirst({
      where: {
        programId,
        ...this.platformRepository.programApplicationParticipantWhere(userId),
      },
      select: {
        id: true,
        status: true,
        submissions: {
          select: {
            status: true,
            requirement: { select: { id: true, milestoneId: true } },
          } satisfies Prisma.SubmissionSelect,
        },
      },
    });
  }
  async findApprovedApplications(programId: string) {
    return this.prisma.team.findMany({
      where: { programId, status: ApplicationStatus.APPROVED },
      select: {
        submissions: {
          select: {
            status: true,
            requirement: { select: { id: true, milestoneId: true } },
          } satisfies Prisma.SubmissionSelect,
        },
      },
    });
  }
  async findViewerApplicationStatuses(
    programIds: readonly string[],
    userId: string,
  ): Promise<ReadonlyMap<string, ApplicationStatus>> {
    if (programIds.length === 0) return new Map();
    const applications = await this.prisma.team.findMany({
      where: {
        programId: { in: [...programIds] },
        ...this.platformRepository.programApplicationParticipantWhere(userId),
      },
      select: { programId: true, status: true },
    });
    return new Map(
      applications.map((application) => [
        application.programId,
        application.status,
      ]),
    );
  }
  async countApplicationsByProgram(
    programIds: readonly string[],
  ): Promise<ReadonlyMap<string, ProgramApplicationCounts>> {
    if (programIds.length === 0) return new Map();
    const rows = await this.prisma.team.groupBy({
      by: ['programId', 'status'],
      where: { programId: { in: [...programIds] } },
      _count: { _all: true },
    });
    const counts = new Map<
      string,
      {
        total: number;
        pending: number;
      }
    >();
    for (const row of rows) {
      const bucket = counts.get(row.programId) ?? { total: 0, pending: 0 };
      bucket.total += row._count._all;
      if (row.status === ApplicationStatus.SUBMITTED) {
        bucket.pending += row._count._all;
      }
      counts.set(row.programId, bucket);
    }
    return counts;
  }
  async findProgramRepositories(
    programId: string,
    studentUserId: string | null,
  ) {
    const repositories = await this.prisma.githubRepository.findMany({
      where: {
        team: {
          programId,
          ...(studentUserId
            ? this.platformRepository.programApplicationParticipantWhere(
                studentUserId,
              )
            : {}),
        },
      },
      select: {
        githubRepositoryId: true,
        team: {
          select: {
            id: true,
            applicant: {
              select: {
                githubId: true,
                nickname: true,
                ...USER_PROFILE_NAME_SELECT,
              },
            },
            name: true,
            leader: { select: { githubId: true } },
            members: { select: { user: { select: { githubId: true } } } },
          },
        },
      },
    });

    return repositories.flatMap((repository) => {
      const team = repository.team;
      if (team === null) return [];
      return [
        {
          githubRepositoryId: repository.githubRepositoryId,
          application: {
            id: team.id,
            applicant: team.applicant,
            team: {
              name: team.name,
              leader: team.leader,
              members: team.members,
            },
          },
        },
      ];
    });
  }
  async findStudentActivityApplications(userId: string) {
    return this.prisma.team.findMany({
      where: {
        status: ApplicationStatus.APPROVED,
        ...this.platformRepository.programApplicationParticipantWhere(userId),
      },
      select: {
        id: true,
        applicant: { select: { githubId: true } },
        leader: { select: { githubId: true } },
        members: {
          select: { user: { select: { githubId: true } } },
        },
        program: {
          select: { id: true, name: true, applicationStartAt: true },
        },
        repository: { select: { githubRepositoryId: true } },
      },
    });
  }
  findViewer(githubId: bigint) {
    return this.prisma.user.findUnique({
      where: { githubId },
      select: {
        id: true,
        accountStatus: true,
        ...USER_AUTHORITY_SELECT,
      },
    });
  }
  withCreateTransaction<T>(
    operation: (
      writer: Pick<Prisma.TransactionClient, 'program'> &
        ProgramHistoryWriterClient,
    ) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) => operation(transaction));
  }
  createProgram(
    data: {
      readonly createdByGithubId: bigint;
      readonly name: string;
      readonly organizer: string;
      readonly category: ProgramCategory;
      readonly trackType: Program['trackType'];
      readonly applicationTemplateKey: string;
      readonly applicationTemplateVersion: number;
      readonly applicationStartAt: Date;
      readonly applicationEndAt: Date;
      readonly startAt: Date;
      readonly endAt: Date;
      readonly teamMinSize: number;
      readonly teamMaxSize: number;
      readonly description: string;
    },
    writer: Pick<Prisma.TransactionClient, 'program'>,
  ) {
    const { createdByGithubId, ...program } = data;
    return writer.program.create({
      data: {
        ...program,
        createdBy: 'USER',
        creator: { connect: { githubId: createdByGithubId } },
      },
    });
  }
}
export type ProgramDeletionScopeCounts = {
  readonly applications: number;
  readonly teams: number;
  readonly boardPosts: number;
  readonly submissions: number;
  readonly submissionEvents: number;
  readonly scopeFingerprint: string;
};
type DeletionScopeCountsRow = Readonly<{
  applications: bigint;
  teams: bigint;
  boardPosts: bigint;
  submissions: bigint;
  submissionEvents: bigint;
  scopeFingerprint: string;
}>;
@Injectable()
export class ProgramDeletionScopeRepository {
  async readProgramDeletionScopeCounts(
    transaction: PrismaTypes.TransactionClient,
    programId: string,
  ): Promise<ProgramDeletionScopeCounts> {
    const [row] = await transaction.$queryRaw<
      readonly DeletionScopeCountsRow[]
    >(Prisma.sql`
      SELECT
        (SELECT count(*) FROM "Team" WHERE "programId" = ${programId}) AS applications,
        (SELECT count(*) FROM "Team" WHERE "programId" = ${programId}) AS teams,
        (SELECT count(*) FROM "BoardPost" WHERE "programId" = ${programId}) AS "boardPosts",
        (SELECT count(*) FROM "Submission" WHERE "requirementId" IN (
            SELECT document.id
            FROM "Requirement" AS document
            INNER JOIN "Milestone" AS milestone ON milestone.id = document."milestoneId"
            WHERE milestone."programId" = ${programId}
          )) AS submissions,
        (
          (SELECT count(*) FROM "File" file WHERE file.kind='SUBMISSION' AND (file."programId" = ${programId}
              OR file."teamId" IN (SELECT id FROM "Team" WHERE "programId" = ${programId})
              OR file."requirementId" IN (SELECT requirement.id FROM "Requirement" requirement JOIN "Milestone" milestone ON milestone.id=requirement."milestoneId" WHERE milestone."programId"=${programId})
              OR file."submissionHistoryId" IN (SELECT history.id FROM "SubmissionHistory" history JOIN "Submission" submission ON submission.id=history."submissionId" JOIN "Requirement" requirement ON requirement.id=submission."requirementId" JOIN "Milestone" milestone ON milestone.id=requirement."milestoneId" WHERE milestone."programId"=${programId})))
          +
          (SELECT count(*) FROM "SubmissionHistory" WHERE "submissionId" IN (
            SELECT document_submission.id
            FROM "Submission" AS document_submission
            INNER JOIN "Requirement" AS document ON document.id = document_submission."requirementId"
            INNER JOIN "Milestone" AS milestone ON milestone.id = document."milestoneId"
            WHERE milestone."programId" = ${programId}
          ))
        ) AS "submissionEvents",
        (
          SELECT MD5(COALESCE(STRING_AGG(scope."key", '|' ORDER BY scope."key"), ''))
          FROM (
            SELECT CONCAT('Team:', id) AS "key" FROM "Team" WHERE "programId" = ${programId}
            UNION ALL
            SELECT CONCAT('TeamMember:', JSONB_BUILD_ARRAY("teamId", "userId")::text) FROM "TeamMember" WHERE "programId" = ${programId}
            UNION ALL
            SELECT CONCAT('TeamInvitation:', id) FROM "TeamInvitation" WHERE "programId" = ${programId}
            UNION ALL
            SELECT CONCAT('BoardPost:', id) FROM "BoardPost" WHERE "programId" = ${programId}
            UNION ALL
            SELECT CONCAT('BoardComment:', comment.id)
            FROM "BoardComment" AS comment
            INNER JOIN "BoardPost" AS post ON post.id = comment."postId"
            WHERE post."programId" = ${programId}
            UNION ALL
            SELECT CONCAT('Milestone:', id) FROM "Milestone" WHERE "programId" = ${programId}
            UNION ALL
            SELECT CONCAT('MilestoneDocument:', document.id)
            FROM "Requirement" AS document
            INNER JOIN "Milestone" AS milestone ON milestone.id = document."milestoneId"
            WHERE milestone."programId" = ${programId}
            UNION ALL
            SELECT CONCAT('MilestoneDocumentSubmission:', document_submission.id)
            FROM "Submission" AS document_submission
            INNER JOIN "Requirement" AS document ON document.id = document_submission."requirementId"
            INNER JOIN "Milestone" AS milestone ON milestone.id = document."milestoneId"
            WHERE milestone."programId" = ${programId}
            UNION ALL
            SELECT CONCAT('MilestoneDocumentSubmissionHistory:', history.id)
            FROM "SubmissionHistory" AS history
            INNER JOIN "Submission" AS document_submission
              ON document_submission.id = history."submissionId"
            INNER JOIN "Requirement" AS document ON document.id = document_submission."requirementId"
            INNER JOIN "Milestone" AS milestone ON milestone.id = document."milestoneId"
            WHERE milestone."programId" = ${programId}
            UNION ALL
            SELECT CONCAT('File:', file.id) FROM "File" file WHERE file."programId" = ${programId}
              OR file."teamId" IN (SELECT id FROM "Team" WHERE "programId" = ${programId})
              OR file."requirementId" IN (SELECT requirement.id FROM "Requirement" requirement JOIN "Milestone" milestone ON milestone.id=requirement."milestoneId" WHERE milestone."programId"=${programId})
              OR file."submissionHistoryId" IN (SELECT history.id FROM "SubmissionHistory" history JOIN "Submission" submission ON submission.id=history."submissionId" JOIN "Requirement" requirement ON requirement.id=submission."requirementId" JOIN "Milestone" milestone ON milestone.id=requirement."milestoneId" WHERE milestone."programId"=${programId})
            UNION ALL
            SELECT CONCAT('RepositoryProvisionJob:', job.id)
            FROM "RepositoryProvisionJob" AS job
            INNER JOIN "Team" AS application ON application.id = job."teamId"
            WHERE application."programId" = ${programId}
            UNION ALL
            SELECT CONCAT(
              'GithubRepository:', repository.id, ':',
              COALESCE(repository."teamId", '')
            )
            FROM "GithubRepository" AS repository
            WHERE repository."teamId" IN (SELECT id FROM "Team" WHERE "programId" = ${programId})
            UNION ALL
            SELECT CONCAT('OutboxEvent:', event.id)
            FROM "OutboxEvent" AS event
            WHERE (event."aggregateType" = 'PROGRAM' AND event."aggregateId" = ${programId})
              OR (event."aggregateType" = 'Team' AND event."aggregateId" IN (
                SELECT id FROM "Team" WHERE "programId" = ${programId}
              ))
            UNION ALL
            SELECT CONCAT('Notification:', notification.id)
            FROM "Notification" AS notification
            WHERE (
              notification.type = 'APPLICATION_DECISION'
              AND notification.payload->>'programId' = ${programId}
            ) OR (
              notification.type = 'APPLICATION_DECISION_ACKNOWLEDGED'
              AND notification."idempotencyKey" IN (
                SELECT CONCAT('application-decision-acknowledged:', decision.id)
                FROM "Notification" AS decision
                WHERE decision.type = 'APPLICATION_DECISION'
                  AND decision.payload->>'programId' = ${programId}
              )
            ) OR (
              notification.type = 'DEADLINE_DIGEST'
              AND notification."idempotencyKey" LIKE CONCAT('%:', ${programId}, ':%')
            ) OR (
              notification.type = 'TEAM_DELETED'
              AND notification.payload->>'programId' = ${programId}
            )
          ) AS scope
        ) AS "scopeFingerprint"
    `);
    if (!row) throw new Error('Deletion scope count query returned no result.');
    return {
      applications: Number(row.applications),
      teams: Number(row.teams),
      boardPosts: Number(row.boardPosts),
      submissions: Number(row.submissions),
      submissionEvents: Number(row.submissionEvents),
      scopeFingerprint: row.scopeFingerprint,
    };
  }
}
export type ProgramPurgeDeletedCounts = {
  readonly applications: number;
  readonly teams: number;
  readonly teamMembers: number;
  readonly teamInvitations: number;
  readonly boardPosts: number;
  readonly boardComments: number;
  readonly submissions: number;
  readonly submissionRevisions: number;
  readonly reviews: number;
  readonly milestones: number;
  readonly milestoneDocuments: number;
  readonly milestoneDocumentSubmissions: number;
  readonly milestoneDocumentSubmissionHistories: number;
  readonly programCreateRequests: number;
  readonly repositoryProvisionJobs: number;
  readonly githubRepositoriesDetached: number;
  readonly outboxEvents: number;
  readonly notifications: number;
  readonly files: number;
};
type ProgramLifecycleTransaction = Prisma.TransactionClient;
@Injectable()
export class ProgramLifecycleRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly programDeletionScope: ProgramDeletionScopeRepository,
  ) {}
  withDeleteTransaction<T>(
    operation: (transaction: ProgramLifecycleTransaction) => Promise<T>,
  ): Promise<T> {
    return this.withPurgeTransaction(operation);
  }
  withPurgeTransaction<T>(
    operation: (transaction: ProgramLifecycleTransaction) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(operation, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }
  readScopeCounts(programId: string): Promise<ProgramDeletionScopeCounts> {
    return this.prisma.$transaction((transaction) =>
      this.readScopeCountsInTransaction(transaction, programId),
    );
  }
  readScopeCountsInTransaction(
    transaction: ProgramLifecycleTransaction,
    programId: string,
  ): Promise<ProgramDeletionScopeCounts> {
    return this.programDeletionScope.readProgramDeletionScopeCounts(
      transaction,
      programId,
    );
  }
  findProgramForDeletion(
    transaction: ProgramLifecycleTransaction,
    programId: string,
  ) {
    return transaction.program.findUnique({
      where: { id: programId, lifecycle: { not: 'DELETED' } },
      select: { id: true, name: true, lifecycle: true },
    });
  }
  async deleteProgram(
    transaction: ProgramLifecycleTransaction,
    programId: string,
  ): Promise<void> {
    await transaction.program.update({
      where: { id: programId },
      data: { lifecycle: 'DELETED' },
    });
  }
  async purgeProgramTree(
    transaction: ProgramLifecycleTransaction,
    programId: string,
  ): Promise<ProgramPurgeDeletedCounts> {
    const now = new Date();
    const fileScope = {
      OR: [
        { programId },
        { team: { programId } },
        { requirement: { milestone: { programId } } },
        {
          submissionHistory: {
            submission: { requirement: { milestone: { programId } } },
          },
        },
      ],
      lifecycle: { in: ['PENDING', 'ATTACHED'] },
    } satisfies Prisma.FileWhereInput;
    const files = await transaction.file.findMany({
      where: fileScope,
      select: { kind: true },
    });
    await transaction.file.updateMany({
      where: fileScope,
      data: { lifecycle: 'DELETE_PENDING', nextDeleteAttemptAt: now },
    });
    return {
      applications: 0,
      teams: 0,
      teamMembers: 0,
      teamInvitations: 0,
      boardPosts: 0,
      boardComments: 0,
      submissions: 0,
      submissionRevisions: 0,
      reviews: 0,
      milestones: 0,
      milestoneDocuments: 0,
      milestoneDocumentSubmissions: 0,
      milestoneDocumentSubmissionHistories: 0,
      programCreateRequests: 0,
      repositoryProvisionJobs: 0,
      githubRepositoriesDetached: 0,
      outboxEvents: 0,
      notifications: 0,
      files: files.length,
    };
  }
  isForeignKeyConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2003'
    );
  }
}
export type ProgramHistoryWriterClient = Pick<
  Prisma.TransactionClient,
  'user' | 'programHistory'
>;

export interface AppendProgramHistoryInput {
  readonly programId: string;
  readonly actorGithubId: bigint;
  readonly event: ProgramHistoryEvent;
  readonly metadata: Prisma.InputJsonObject;
}

@Injectable()
export class ProgramHistoryRepository {
  async append(
    client: ProgramHistoryWriterClient,
    input: AppendProgramHistoryInput,
  ): Promise<void> {
    const actor = await client.user.findUniqueOrThrow({
      where: { githubId: input.actorGithubId },
      select: { id: true },
    });
    await client.programHistory.create({
      data: {
        programId: input.programId,
        actorId: actor.id,
        event: input.event,
        source: 'APPLICATION',
        data: { schemaVersion: 1, metadata: input.metadata },
      },
    });
  }
}

export interface ProgramAuthoringTransactionStore {
  readonly historyWriter: ProgramHistoryWriterClient;
  createProgram(
    plan: ProgramAuthoringProgramPlan,
    cover?:
      | {
          readonly actorId: string;
          readonly upload: ProgramAuthoringUploadToken;
        }
      | {
          readonly externalCover: ProgramExternalCover;
        },
  ): Promise<ProgramAuthoringProgram>;
  createRequest(input: ProgramAuthoringCreateRequestInput): Promise<string>;
  lockUploads(
    tokenIds: readonly string[],
  ): Promise<readonly ProgramAuthoringUploadToken[]>;
  createMilestone(
    programId: string,
    plan: ProgramAuthoringMilestonePlan,
  ): Promise<string>;
  createDocument(
    milestoneId: string,
    plan: ProgramAuthoringDocumentPlan,
  ): Promise<string>;
  createTemplate(input: ProgramAuthoringTemplateInput): Promise<void>;
}
@Injectable()
export class ProgramAuthoringRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly programAuthoringUploadTransactionRepository: ProgramAuthoringUploadTransactionRepository,
    private readonly programCoverRepository: ProgramCoverRepository,
  ) {}
  async findReplay(
    actorId: string,
    idempotencyKey: string,
  ): Promise<ProgramAuthoringReplay | null> {
    const program = await this.prisma.program.findFirst({
      where: { createdById: actorId, idempotencyKey },
    });
    if (program === null || program.payloadHash === null) return null;
    return { payloadHash: program.payloadHash, program };
  }
  withTransaction<T>(
    operation: (store: ProgramAuthoringTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(this.programAuthoringTransactionStore(transaction)),
    );
  }
  private programAuthoringTransactionStore(
    prisma: Prisma.TransactionClient,
  ): ProgramAuthoringTransactionStore {
    return {
      historyWriter: prisma,
      createProgram: this.createProgramIn.bind(this, prisma),
      createRequest: this.createRequestIn.bind(this, prisma),
      lockUploads: this.lockUploadsIn.bind(this, prisma),
      createMilestone: this.createMilestoneIn.bind(this, prisma),
      createDocument: this.createDocumentIn.bind(this, prisma),
      createTemplate: this.createTemplateIn.bind(this, prisma),
    };
  }
  private async createProgramIn(
    prisma: Prisma.TransactionClient,
    plan: ProgramAuthoringProgramPlan,
    cover?:
      | {
          readonly actorId: string;
          readonly upload: ProgramAuthoringUploadToken;
        }
      | {
          readonly externalCover: ProgramExternalCover;
        },
  ): Promise<ProgramAuthoringProgram> {
    const program = await prisma.program.create({
      data: plan,
    });
    if (cover !== undefined) {
      if ('externalCover' in cover) {
        await this.programCoverRepository.createExternalProgramCover(
          prisma,
          program.id,
          cover.externalCover,
        );
      } else {
        await this.programCoverRepository.createProgramCover(prisma, {
          programId: program.id,
          ...cover,
        });
      }
    }
    return program;
  }
  private async createRequestIn(
    prisma: Prisma.TransactionClient,
    input: ProgramAuthoringCreateRequestInput,
  ): Promise<string> {
    const program = await prisma.program.update({
      where: { id: input.programId },
      data: {
        createdBy: 'USER',
        createdById: input.actorId,
        idempotencyKey: input.idempotencyKey,
        payloadHash: input.payloadHash,
      },
    });
    return program.id;
  }
  private lockUploadsIn(
    prisma: Prisma.TransactionClient,
    tokenIds: readonly string[],
  ): Promise<readonly ProgramAuthoringUploadToken[]> {
    return this.programAuthoringUploadTransactionRepository.lockProgramAuthoringUploads(
      prisma,
      tokenIds,
    );
  }
  private async createMilestoneIn(
    prisma: Prisma.TransactionClient,
    programId: string,
    plan: ProgramAuthoringMilestonePlan,
  ): Promise<string> {
    const milestone = await prisma.milestone.create({
      data: {
        programId,
        name: plan.name,
        startAt: plan.startAt,
        dueAt: plan.dueAt,
        instructions: plan.instructions,
      },
    });
    return milestone.id;
  }
  private async createDocumentIn(
    prisma: Prisma.TransactionClient,
    milestoneId: string,
    plan: ProgramAuthoringDocumentPlan,
  ): Promise<string> {
    const document = await prisma.requirement.create({
      data: {
        milestoneId,
        name: plan.name,
        required: plan.required,
        sortOrder: plan.sortOrder,
      },
    });
    return document.id;
  }
  private async createTemplateIn(
    prisma: Prisma.TransactionClient,
    input: ProgramAuthoringTemplateInput,
  ): Promise<void> {
    await this.programAuthoringUploadTransactionRepository.consumePendingProgramAuthoringUploads(
      prisma,
      input.actorId,
      [
        {
          milestoneDocumentId: input.milestoneDocumentId,
          upload: input.upload,
        },
      ],
    );
  }
}
export interface ProgramOverviewRecord {
  programId: string;
  name: string;
  trackType: string | null;
  lifecycle: string;
  milestoneCount: number;
  boardPostCount: number;
  participantCount: number;
  teamCount: number;
  connectedRepositoryCount: number;
}
interface PublicTeamMemberRow {
  userId: string;
  displayName: string;
  isLeader: boolean;
}
export interface PublicTeamRow {
  teamId: string;
  name: string;
  members: PublicTeamMemberRow[];
}
export interface CurrentSubmissionMilestone {
  milestoneId: string;
  documentIds: string[];
  requiredDocumentIds: string[];
}
export interface ViewerIdentity {
  readonly accountStatus: AccountStatus;
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly profileCreatedAt: Date | null;
  userId: string;
  memberKind: MemberKind | null;
  hasStaffAccess: boolean;
  hasAdminAccess: boolean;
}
export interface MilestoneSchedule {
  milestoneId: string;
  label: string;
  dueAt: Date;
}
export interface MilestoneDocumentCatalogEntry {
  milestoneId: string;
  title: string;
  documentIds: string[];
  requiredDocumentIds: string[];
}
const CURRENT_MILESTONE_SELECT = {
  id: true,
  requirements: {
    where: {},
    select: { id: true, required: true },
    orderBy: { sortOrder: 'asc' as const },
  },
} satisfies Prisma.MilestoneSelect;
type CurrentMilestoneSelection = {
  id: string;
  requirements: {
    id: string;
    required: boolean;
  }[];
};
function toCurrentSubmissionMilestone(
  milestone: CurrentMilestoneSelection,
): CurrentSubmissionMilestone {
  return {
    milestoneId: milestone.id,
    documentIds: milestone.requirements.map((document) => document.id),
    requiredDocumentIds: milestone.requirements
      .filter((document) => document.required)
      .map((document) => document.id),
  };
}
export interface ProgramApplicationTeamRow {
  readonly id: string;
}
export interface SubmittedDocumentPairRow {
  readonly teamId: string;
  readonly milestoneDocumentId: string;
}
@Injectable()
export class ProgramOverviewRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRepository: PlatformRepository,
  ) {}
  async findByProgramId(
    programId: string,
  ): Promise<ProgramOverviewRecord | null> {
    const program = await this.prisma.program.findUnique({
      where: { id: programId, lifecycle: { not: 'DELETED' } },
      select: {
        id: true,
        name: true,
        trackType: true,
        lifecycle: true,
        _count: { select: { milestones: true, boardPosts: true, teams: true } },
      },
    });
    if (!program) {
      return null;
    }
    const [teamMemberRows, connectedRepositoryCount] = await Promise.all([
      this.prisma.teamMember.findMany({
        where: { programId },
        select: { userId: true },
        distinct: ['userId'],
      }),
      this.prisma.githubRepository.count({ where: { team: { programId } } }),
    ]);
    const participantIds = new Set<string>(
      teamMemberRows.map((row) => row.userId),
    );
    return {
      programId: program.id,
      name: program.name,
      trackType: program.trackType,
      lifecycle: program.lifecycle,
      milestoneCount: program._count.milestones,
      boardPostCount: program._count.boardPosts,
      participantCount: participantIds.size,
      teamCount: program._count.teams,
      connectedRepositoryCount,
    };
  }
  async programExists(programId: string): Promise<boolean> {
    const count = await this.prisma.program.count({
      where: { id: programId },
    });
    return count > 0;
  }
  async findViewerIdentity(githubId: bigint): Promise<ViewerIdentity | null> {
    const user = await this.prisma.user.findFirst({
      where: { githubId, accountStatus: AccountStatus.ACTIVE },
      select: {
        id: true,
        accountStatus: true,
        ...USER_AUTHORITY_SELECT,
      },
    });
    if (user === null) {
      return null;
    }
    return {
      ...user,
      userId: user.id,
      memberKind: user.type === 'UNSELECTED' ? null : user.type,
      hasStaffAccess:
        user.type === 'STAFF' && user.approvalStatus === 'APPROVED',
      hasAdminAccess: user.admin !== null,
    };
  }
  async findCurrentSubmissionMilestone(
    programId: string,
    now: Date,
  ): Promise<CurrentSubmissionMilestone | null> {
    const upcoming = await this.prisma.milestone.findFirst({
      where: {
        programId,
        dueAt: { gte: now },
        requirements: { some: {} },
      },
      orderBy: { dueAt: 'asc' },
      select: CURRENT_MILESTONE_SELECT,
    });
    const milestone =
      upcoming ??
      (await this.prisma.milestone.findFirst({
        where: {
          programId,
          requirements: { some: {} },
        },
        orderBy: { dueAt: 'desc' },
        select: CURRENT_MILESTONE_SELECT,
      }));
    return milestone ? toCurrentSubmissionMilestone(milestone) : null;
  }
  async findMilestoneSchedules(
    programId: string,
  ): Promise<MilestoneSchedule[]> {
    const milestones = await this.prisma.milestone.findMany({
      where: { programId },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, dueAt: true },
    });
    return milestones.map((milestone) => ({
      milestoneId: milestone.id,
      label: milestone.name,
      dueAt: milestone.dueAt,
    }));
  }
  async findMilestoneDocumentCatalog(
    programId: string,
  ): Promise<MilestoneDocumentCatalogEntry[]> {
    const milestones = await this.prisma.milestone.findMany({
      where: { programId },
      orderBy: { dueAt: 'asc' },
      select: {
        id: true,
        name: true,
        requirements: {
          where: {},
          select: { id: true, required: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    return milestones.map((milestone) => ({
      milestoneId: milestone.id,
      title: milestone.name,
      documentIds: milestone.requirements.map((document) => document.id),
      requiredDocumentIds: milestone.requirements
        .filter((document) => document.required)
        .map((document) => document.id),
    }));
  }
  async findApprovedViewerApplicationId(
    programId: string,
    userId: string,
  ): Promise<string | null> {
    const application = await this.prisma.team.findFirst({
      where: {
        programId,
        status: ApplicationStatus.APPROVED,
        ...this.platformRepository.programApplicationParticipantWhere(userId),
      },
      select: { id: true },
    });
    return application?.id ?? null;
  }
  async findViewerApplicationId(
    programId: string,
    userId: string,
  ): Promise<string | null> {
    const direct = await this.prisma.team.findFirst({
      where: { programId, applicantId: userId },
      select: { id: true },
      orderBy: { submittedAt: 'desc' },
    });
    if (direct) {
      return direct.id;
    }
    const membership = await this.prisma.teamMember.findUnique({
      where: { programId_userId: { programId, userId } },
      select: { teamId: true },
    });
    if (!membership) {
      return null;
    }

    const teamApplication = await this.prisma.team.findFirst({
      where: { programId, id: membership.teamId },
      select: { id: true },
      orderBy: { submittedAt: 'desc' },
    });
    return teamApplication?.id ?? null;
  }
  async countSubmittedDocuments(
    teamId: string,
    documentIds: string[],
  ): Promise<number> {
    if (documentIds.length === 0) {
      return 0;
    }
    return this.prisma.submission.count({
      where: { teamId, requirementId: { in: documentIds } },
    });
  }
  async findSubmittedDocumentIds(
    teamId: string,
    documentIds: string[],
  ): Promise<Set<string>> {
    if (documentIds.length === 0) {
      return new Set();
    }
    const rows = await this.prisma.submission.groupBy({
      by: ['requirementId'],
      where: { teamId, requirementId: { in: documentIds } },
    });
    return new Set(rows.map((row) => row.requirementId));
  }
  findProgramApplications(
    programId: string,
  ): Promise<readonly ProgramApplicationTeamRow[]> {
    return this.prisma.team.findMany({
      where: { programId },
      select: { id: true },
    });
  }
  async findSubmittedDocumentPairs(
    teamIds: readonly string[],
    documentIds: readonly string[],
  ): Promise<readonly SubmittedDocumentPairRow[]> {
    if (documentIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.submission.groupBy({
      by: ['requirementId', 'teamId'],
      where: {
        teamId: { in: [...teamIds] },
        requirementId: { in: [...documentIds] },
      },
    });
    return rows.map((row) => ({
      teamId: row.teamId,
      milestoneDocumentId: row.requirementId,
    }));
  }
  async countTeamMembers(
    programId: string,
    teamIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>> {
    if (teamIds.length === 0) {
      return new Map();
    }
    const memberCounts = await this.prisma.teamMember.groupBy({
      by: ['teamId'],
      where: { programId, teamId: { in: [...teamIds] } },
      _count: { teamId: true },
    });
    return new Map(memberCounts.map((row) => [row.teamId, row._count.teamId]));
  }
  async listPublicTeams(programId: string): Promise<PublicTeamRow[]> {
    const teams = await this.prisma.team.findMany({
      where: { programId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        leaderId: true,
        members: {
          select: { userId: true, user: { select: { nickname: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    return teams.map((team) => ({
      teamId: team.id,
      name: team.name,
      members: team.members.map((member) => ({
        userId: member.userId,
        displayName: member.user.nickname,
        isLeader: member.userId === team.leaderId,
      })),
    }));
  }
}
