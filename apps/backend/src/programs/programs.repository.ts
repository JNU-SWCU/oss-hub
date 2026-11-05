import {
  USER_AUTHORITY_SELECT,
  USER_PROFILE_NAME_SELECT,
} from '../platform/user-profile-read.config';
import { Injectable } from '@nestjs/common';
import {
  type Program,
  ApplicationStatus,
  Prisma,
  ProgramCategory,
  type ProgramTrackType,
  type ProgramLifecycle,
  type Prisma as PrismaTypes,
  ProgramAuthoringUploadLifecycle,
  SubmissionFileLifecycle,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import {
  ProgramListStatusFilterRepository,
  type ProgramListQuery,
} from './program-list-status-filter.repository';
import { PlatformRepository } from '../platform/platform.repository';
import { ProgramCoverRepository } from './program-cover.repository';
import { type AuditLogTransactionWriter } from '../platform/audit-log-transaction-writer.types';
import {
  ProgramAuthoringUploadTransactionRepository,
  type ProgramAuthoringProgramPlan,
  type ProgramExternalCover,
  type ProgramAuthoringProgram,
  type ProgramAuthoringCreateRequestInput,
  type ProgramAuthoringMilestonePlan,
  type ProgramAuthoringDocumentPlan,
  type ProgramAuthoringTemplateInput,
  type ProgramAuthoringReplay,
} from './program-authoring-upload-transaction.repository';
import { type ProgramAuthoringUploadToken } from './program-authoring-upload.config';
import { ProgramAuthoringAttachmentRaceError } from './program-authoring.error';
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
          cover."id" AS "coverId",
          cover."imageUrl" AS "coverExternalImageUrl"
        FROM "Program" AS p
        LEFT JOIN "ProgramCover" AS cover ON cover."programId" = p."id"
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
        cover: { select: { id: true, imageUrl: true } },
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
                documents: {
                  where: {},
                },
              },
            },
            documents: {
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
    return this.prisma.application.findFirst({
      where: {
        programId,
        ...this.platformRepository.programApplicationParticipantWhere(userId),
      },
      select: {
        id: true,
        status: true,
        milestoneDocumentSubmissions: {
          select: {
            status: true,
            milestoneDocument: { select: { id: true, milestoneId: true } },
          } satisfies Prisma.MilestoneDocumentSubmissionSelect,
        },
      },
    });
  }
  async findApprovedApplications(programId: string) {
    return this.prisma.application.findMany({
      where: { programId, status: ApplicationStatus.APPROVED },
      select: {
        milestoneDocumentSubmissions: {
          select: {
            status: true,
            milestoneDocument: { select: { id: true, milestoneId: true } },
          } satisfies Prisma.MilestoneDocumentSubmissionSelect,
        },
      },
    });
  }
  async findViewerApplicationStatuses(
    programIds: readonly string[],
    userId: string,
  ): Promise<ReadonlyMap<string, ApplicationStatus>> {
    if (programIds.length === 0) return new Map();
    const applications = await this.prisma.application.findMany({
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
    const rows = await this.prisma.application.groupBy({
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
        programId,
        ...(studentUserId
          ? {
              application: {
                ...this.platformRepository.programApplicationParticipantWhere(
                  studentUserId,
                ),
              },
            }
          : {}),
      },
      select: {
        githubRepositoryId: true,
        application: {
          select: {
            id: true,
            applicant: {
              select: {
                githubId: true,
                nickname: true,
                ...USER_PROFILE_NAME_SELECT,
              },
            },
            team: {
              select: {
                name: true,
                leader: { select: { githubId: true } },
                members: { select: { user: { select: { githubId: true } } } },
              },
            },
          },
        },
      },
    });
    return repositories
      .filter((repository) => repository.application !== null)
      .map((repository) => ({
        githubRepositoryId: repository.githubRepositoryId,
        application: {
          id: repository.application!.id,
          applicant: {
            githubId: repository.application!.applicant.githubId,
            nickname: repository.application!.applicant.nickname,
            name: repository.application!.applicant.name ?? null,
          },
          team: repository.application!.team,
        },
      }));
  }
  async findStudentActivityApplications(userId: string) {
    return this.prisma.application.findMany({
      where: {
        status: ApplicationStatus.APPROVED,
        ...this.platformRepository.programApplicationParticipantWhere(userId),
      },
      select: {
        teamId: true,
        applicant: { select: { githubId: true } },
        team: {
          select: {
            leader: { select: { githubId: true } },
            members: {
              select: { user: { select: { githubId: true } } },
            },
          },
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
      writer: Pick<Prisma.TransactionClient, 'program' | 'auditLog'>,
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
        (SELECT count(*) FROM "Application" WHERE "programId" = ${programId}) AS applications,
        (SELECT count(*) FROM "Team" WHERE "programId" = ${programId}) AS teams,
        (SELECT count(*) FROM "BoardPost" WHERE "programId" = ${programId}) AS "boardPosts",
        (SELECT count(*) FROM "MilestoneDocumentSubmission" WHERE "milestoneDocumentId" IN (
            SELECT document.id
            FROM "MilestoneDocument" AS document
            INNER JOIN "Milestone" AS milestone ON milestone.id = document."milestoneId"
            WHERE milestone."programId" = ${programId}
          )) AS submissions,
        (
          (SELECT count(*) FROM "SubmissionFile" WHERE
            "applicationId" IN (SELECT id FROM "Application" WHERE "programId" = ${programId})
            OR "milestoneId" IN (SELECT id FROM "Milestone" WHERE "programId" = ${programId})
            OR "milestoneDocumentSubmissionHistoryId" IN (
              SELECT history.id
              FROM "MilestoneDocumentSubmissionHistory" AS history
              INNER JOIN "MilestoneDocumentSubmission" AS document_submission
                ON document_submission.id = history."milestoneDocumentSubmissionId"
              INNER JOIN "MilestoneDocument" AS document
                ON document.id = document_submission."milestoneDocumentId"
              INNER JOIN "Milestone" AS milestone
                ON milestone.id = document."milestoneId"
              WHERE milestone."programId" = ${programId}
            )
          )
          +
          (SELECT count(*) FROM "MilestoneDocumentSubmissionHistory" WHERE "milestoneDocumentSubmissionId" IN (
            SELECT document_submission.id
            FROM "MilestoneDocumentSubmission" AS document_submission
            INNER JOIN "MilestoneDocument" AS document ON document.id = document_submission."milestoneDocumentId"
            INNER JOIN "Milestone" AS milestone ON milestone.id = document."milestoneId"
            WHERE milestone."programId" = ${programId}
          ))
          +
          (SELECT count(*) FROM "MilestoneDocumentReviewHistory" WHERE "milestoneDocumentSubmissionId" IN (
            SELECT document_submission.id
            FROM "MilestoneDocumentSubmission" AS document_submission
            INNER JOIN "MilestoneDocument" AS document ON document.id = document_submission."milestoneDocumentId"
            INNER JOIN "Milestone" AS milestone ON milestone.id = document."milestoneId"
            WHERE milestone."programId" = ${programId}
          ))
        ) AS "submissionEvents",
        (
          SELECT MD5(COALESCE(STRING_AGG(scope."key", '|' ORDER BY scope."key"), ''))
          FROM (
            SELECT CONCAT('Application:', id) AS "key"
            FROM "Application" WHERE "programId" = ${programId}
            UNION ALL
            SELECT CONCAT('Team:', id) FROM "Team" WHERE "programId" = ${programId}
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
            FROM "MilestoneDocument" AS document
            INNER JOIN "Milestone" AS milestone ON milestone.id = document."milestoneId"
            WHERE milestone."programId" = ${programId}
            UNION ALL
            SELECT CONCAT('MilestoneDocumentTemplateFile:', file.id)
            FROM "MilestoneDocumentTemplateFile" AS file
            INNER JOIN "MilestoneDocument" AS document ON document.id = file."milestoneDocumentId"
            INNER JOIN "Milestone" AS milestone ON milestone.id = document."milestoneId"
            WHERE milestone."programId" = ${programId}
            UNION ALL
            SELECT CONCAT('MilestoneDocumentSubmission:', document_submission.id)
            FROM "MilestoneDocumentSubmission" AS document_submission
            INNER JOIN "MilestoneDocument" AS document ON document.id = document_submission."milestoneDocumentId"
            INNER JOIN "Milestone" AS milestone ON milestone.id = document."milestoneId"
            WHERE milestone."programId" = ${programId}
            UNION ALL
            SELECT CONCAT('MilestoneDocumentSubmissionHistory:', history.id)
            FROM "MilestoneDocumentSubmissionHistory" AS history
            INNER JOIN "MilestoneDocumentSubmission" AS document_submission
              ON document_submission.id = history."milestoneDocumentSubmissionId"
            INNER JOIN "MilestoneDocument" AS document ON document.id = document_submission."milestoneDocumentId"
            INNER JOIN "Milestone" AS milestone ON milestone.id = document."milestoneId"
            WHERE milestone."programId" = ${programId}
            UNION ALL
            SELECT CONCAT('SubmissionFile:', file.id)
            FROM "SubmissionFile" AS file
            WHERE file."applicationId" IN (
              SELECT id FROM "Application" WHERE "programId" = ${programId}
            ) OR file."milestoneId" IN (
              SELECT id FROM "Milestone" WHERE "programId" = ${programId}
            ) OR file."milestoneDocumentSubmissionHistoryId" IN (
              SELECT history.id
              FROM "MilestoneDocumentSubmissionHistory" AS history
              INNER JOIN "MilestoneDocumentSubmission" AS document_submission
                ON document_submission.id = history."milestoneDocumentSubmissionId"
              INNER JOIN "MilestoneDocument" AS document ON document.id = document_submission."milestoneDocumentId"
              INNER JOIN "Milestone" AS milestone ON milestone.id = document."milestoneId"
              WHERE milestone."programId" = ${programId}
            )
            UNION ALL
            SELECT CONCAT('ProgramAuthoringUpload:', upload.id)
            FROM "ProgramAuthoringUpload" AS upload
            WHERE upload."programId" = ${programId}
            UNION ALL
            SELECT CONCAT('RepositoryProvisionJob:', job.id)
            FROM "RepositoryProvisionJob" AS job
            INNER JOIN "Application" AS application ON application.id = job."applicationId"
            WHERE application."programId" = ${programId}
            UNION ALL
            SELECT CONCAT(
              'GithubRepository:', repository.id, ':',
              COALESCE(repository."programId", ''), ':',
              COALESCE(repository."applicationId", ''), ':',
              COALESCE(repository."teamId", '')
            )
            FROM "GithubRepository" AS repository
            WHERE repository."programId" = ${programId}
              OR repository."applicationId" IN (
                SELECT id FROM "Application" WHERE "programId" = ${programId}
              )
              OR repository."teamId" IN (
                SELECT id FROM "Team" WHERE "programId" = ${programId}
              )
            UNION ALL
            SELECT CONCAT('OutboxEvent:', event.id)
            FROM "OutboxEvent" AS event
            WHERE (event."aggregateType" = 'PROGRAM' AND event."aggregateId" = ${programId})
              OR (event."aggregateType" = 'Application' AND event."aggregateId" IN (
                SELECT id FROM "Application" WHERE "programId" = ${programId}
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
  readonly submissionFiles: number;
  readonly milestones: number;
  readonly milestoneDocuments: number;
  readonly milestoneDocumentSubmissions: number;
  readonly milestoneDocumentSubmissionHistories: number;
  readonly milestoneDocumentTemplateFiles: number;
  readonly programAuthoringUploads: number;
  readonly programCreateRequests: number;
  readonly repositoryProvisionJobs: number;
  readonly githubRepositoriesDetached: number;
  readonly outboxEvents: number;
  readonly notifications: number;
  readonly programPurgeFileTombstones: number;
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
    const submissionFiles = await transaction.submissionFile.updateMany({
      where: {
        OR: [
          { application: { is: { programId } } },
          { milestone: { is: { programId } } },
          {
            submissionHistory: {
              is: {
                submission: { milestoneDocument: { milestone: { programId } } },
              },
            },
          },
        ],
        lifecycle: {
          in: [
            SubmissionFileLifecycle.PENDING,
            SubmissionFileLifecycle.ATTACHED,
          ],
        },
      },
      data: {
        lifecycle: SubmissionFileLifecycle.DELETE_PENDING,
        nextDeleteAttemptAt: now,
      },
    });
    const programAuthoringUploads =
      await transaction.programAuthoringUpload.updateMany({
        where: {
          programId,
          lifecycle: ProgramAuthoringUploadLifecycle.ATTACHED,
        },
        data: {
          lifecycle: ProgramAuthoringUploadLifecycle.DELETE_PENDING,
          attachedAt: null,
          nextDeleteAttemptAt: now,
        },
      });
    const templateFiles =
      await transaction.milestoneDocumentTemplateFile.findMany({
        where: { milestoneDocument: { milestone: { programId } } },
        select: { storageKey: true },
      });
    const cover = await transaction.programCover.findUnique({
      where: { programId },
      select: { storageKey: true },
    });
    const storageKeys = new Set(templateFiles.map((file) => file.storageKey));
    if (cover?.storageKey) storageKeys.add(cover.storageKey);
    const tombstones = await transaction.programPurgeFileTombstone.createMany({
      data: [...storageKeys].map((storageKey) => ({
        storageKey,
        nextDeleteAttemptAt: now,
      })),
      skipDuplicates: true,
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
      milestoneDocumentTemplateFiles: 0,
      programCreateRequests: 0,
      repositoryProvisionJobs: 0,
      githubRepositoriesDetached: 0,
      outboxEvents: 0,
      notifications: 0,
      submissionFiles: submissionFiles.count,
      programAuthoringUploads: programAuthoringUploads.count,
      programPurgeFileTombstones: tombstones.count,
    };
  }
  isForeignKeyConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2003'
    );
  }
}
export interface ProgramAuthoringTransactionStore {
  readonly auditLogWriter: AuditLogTransactionWriter;
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
  attachUploads(
    actorId: string,
    requestId: string,
    tokenIds: readonly string[],
  ): Promise<void>;
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
      auditLogWriter: prisma,
      createProgram: this.createProgramIn.bind(this, prisma),
      createRequest: this.createRequestIn.bind(this, prisma),
      lockUploads: this.lockUploadsIn.bind(this, prisma),
      createMilestone: this.createMilestoneIn.bind(this, prisma),
      createDocument: this.createDocumentIn.bind(this, prisma),
      createTemplate: this.createTemplateIn.bind(this, prisma),
      attachUploads: this.attachUploadsIn.bind(this, prisma),
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
    const document = await prisma.milestoneDocument.create({
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
    await prisma.milestoneDocumentTemplateFile.create({
      data: {
        milestoneDocumentId: input.milestoneDocumentId,
        storageKey: input.upload.storageKey,
        originalFileName: input.upload.originalFileName,
        mimeType: input.upload.mimeType,
        sizeBytes: input.upload.sizeBytes,
        uploadedById: input.actorId,
      },
    });
  }
  private async attachUploadsIn(
    prisma: Prisma.TransactionClient,
    actorId: string,
    requestId: string,
    tokenIds: readonly string[],
  ): Promise<void> {
    if (tokenIds.length === 0) return;
    const attached = await prisma.programAuthoringUpload.updateMany({
      where: {
        id: { in: [...tokenIds] },
        actorId,
        lifecycle: ProgramAuthoringUploadLifecycle.PENDING,
      },
      data: {
        lifecycle: ProgramAuthoringUploadLifecycle.ATTACHED,
        attachedAt: new Date(),
        programId: requestId,
      },
    });
    if (attached.count !== tokenIds.length) {
      throw new ProgramAuthoringAttachmentRaceError();
    }
  }
}
