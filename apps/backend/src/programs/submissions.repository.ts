import { READ_CAP } from '../platform/bounded-read.config';
import { BoundedReadRepository } from '../platform/bounded-read.repository';
import { FileMetadataRepository } from './files.repository';
import {
  SUBMISSION_REVIEW_EVENTS,
  type SubmissionReviewDecision,
} from './submission-history.config';
import { Injectable } from '@nestjs/common';
import {
  Prisma,
  FileLifecycle,
  SubmissionStatus,
  SubmissionHistoryEvent,
  RequirementSubmissionType,
  ApplicationStatus,
  type Prisma as PrismaTypes,
  RepositoryVisibility,
  type RepositoryProvisionJobStatus,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { PlatformRepository } from '../platform/platform.repository';
import {
  RequirementPendingFileMissingError,
  RequirementReviewChangedError,
  RequirementDeadlineClosedError,
  SubmissionChangedError,
  RequirementRevisionChangedError,
  RequirementMissingError,
  SubmissionMembershipChangedError,
} from './submissions.error';
import { USER_PROFILE_NAME_SELECT } from '../platform/user-profile-read.config';
import {
  type MATRIX_APPLICATION_MODES,
  type MATRIX_CELL_STATUSES,
  SUBMISSION_DASHBOARD_STAGE_COUNT_CTES,
} from './submission-matrix.config';
import type { PublishBlockedReason } from '../github/repository-publish.config';
import type { SubmissionCompletionTargetRow } from './submission-completion.config';
@Injectable()
export class SubmissionsRepository {
  private readonly boundedReads = new BoundedReadRepository();

  constructor(
    private readonly platformRepository: PlatformRepository,
    private readonly fileMetadata: FileMetadataRepository,
  ) {}
  nextHistoryCreatedAt(requested: Date, latest: Date | null): Date {
    return latest === null || requested.getTime() > latest.getTime()
      ? requested
      : new Date(latest.getTime() + 1);
  }
  submissionContent(
    text: string | null,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    return text === null
      ? Prisma.JsonNull
      : { type: RequirementSubmissionType.TEXT, text };
  }
  upsertSubmission(
    prisma: PrismaService,
    input: UpsertSubmissionInput,
  ): Promise<SubmissionDetail> {
    return prisma.$transaction(async (transaction) => {
      const stillMember =
        await this.platformRepository.lockSubmissionMembership(
          transaction,
          input.teamId,
          input.submittedById,
        );
      if (!stillMember) {
        throw new SubmissionMembershipChangedError(
          input.teamId,
          input.submittedById,
        );
      }
      let afterDeadline = false;
      if (input.deadline !== undefined) {
        const milestone = await transaction.$queryRaw<
          readonly {
            dueAt: Date;
          }[]
        >(Prisma.sql`
          SELECT "dueAt"
          FROM "Milestone"
          WHERE "id" = ${input.deadline.milestoneId}
          LIMIT 1 FOR SHARE
        `);
        const dueAt = milestone[0]?.dueAt;
        afterDeadline =
          dueAt !== undefined && input.submittedAt.getTime() > dueAt.getTime();
      }
      const documents = await transaction.$queryRaw<
        readonly {
          id: string;
          graceDueAt: Date | null;
        }[]
      >(Prisma.sql`
      SELECT "id", "graceDueAt"
      FROM "Requirement"
      WHERE "id" = ${input.requirementId}
      LIMIT 1 FOR UPDATE
    `);
      const document = documents[0];
      if (document === undefined) throw new RequirementMissingError();
      if (
        afterDeadline &&
        input.deadline !== undefined &&
        !input.deadline.allowAfterDeadline &&
        !(
          input.expectedLatestReviewId === null &&
          document.graceDueAt != null &&
          input.submittedAt.getTime() <= document.graceDueAt.getTime()
        )
      ) {
        throw new RequirementDeadlineClosedError();
      }
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "Submission"
        WHERE "requirementId" = ${input.requirementId}
          AND "teamId" = ${input.teamId}
        LIMIT 1 FOR UPDATE
      `);
      const latestHistory = await transaction.submissionHistory.findFirst({
        where: {
          submission: {
            requirementId: input.requirementId,
            teamId: input.teamId,
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { createdAt: true },
      });
      const submittedAt = this.nextHistoryCreatedAt(
        input.submittedAt,
        latestHistory?.createdAt ?? null,
      );
      const latestReview = await transaction.submissionHistory.findFirst({
        where: {
          event: { in: SUBMISSION_REVIEW_EVENTS },
          submission: {
            requirementId: input.requirementId,
            teamId: input.teamId,
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      if ((latestReview?.id ?? null) !== input.expectedLatestReviewId) {
        throw new RequirementReviewChangedError();
      }
      if (
        input.expectedRevision !== undefined ||
        (afterDeadline && input.deadline !== undefined)
      ) {
        const current = await transaction.submission.findUnique({
          where: {
            requirementId_teamId: {
              requirementId: input.requirementId,
              teamId: input.teamId,
            },
          },
          select: { status: true, revision: true },
        });
        if (
          input.expectedRevision !== undefined &&
          (current?.revision ?? 0) !== input.expectedRevision
        ) {
          throw new RequirementRevisionChangedError();
        }
        if (
          afterDeadline &&
          input.deadline !== undefined &&
          (current?.status ?? null) !== input.deadline.expectedSubmissionStatus
        )
          throw new SubmissionChangedError();
      }
      const submission = await transaction.submission.upsert({
        where: {
          requirementId_teamId: {
            requirementId: input.requirementId,
            teamId: input.teamId,
          },
        },
        update: {
          status: SubmissionStatus.SUBMITTED,
          content: input.content,
          submittedById: input.submittedById,
          submittedAt,
          revision: { increment: 1 },
        },
        create: {
          requirementId: input.requirementId,
          teamId: input.teamId,
          status: SubmissionStatus.SUBMITTED,
          content: input.content,
          submittedById: input.submittedById,
          submittedAt,
        },
        select: {
          id: true,
          status: true,
          content: true,
          submittedAt: true,
          revision: true,
        },
      });
      const history = await transaction.submissionHistory.create({
        data: {
          submissionId: submission.id,
          event:
            submission.revision === 1
              ? SubmissionHistoryEvent.SUBMITTED
              : SubmissionHistoryEvent.RESUBMITTED,
          revision: submission.revision,
          actorId: input.submittedById,
          content: input.content,
          createdAt: submittedAt,
          ...(input.comment === undefined ? {} : { comment: input.comment }),
        },
        select: { id: true },
      });
      if (input.attachFile !== null) {
        const attached = await transaction.file.updateMany({
          where: {
            id: input.attachFile.fileId,
            uploaderId: input.attachFile.uploaderId,
            kind: 'SUBMISSION',
            teamId: input.teamId,
            requirementId: input.requirementId,
            lifecycle: FileLifecycle.PENDING,
            pendingExpiresAt: { gt: input.submittedAt },
          },
          data: {
            submissionId: submission.id,
            submissionHistoryId: history.id,
            lifecycle: FileLifecycle.ATTACHED,
            pendingExpiresAt: null,
          },
        });
        if (attached.count !== 1) {
          throw new RequirementPendingFileMissingError();
        }
      }
      const files = await this.boundedReads.readCapped(
        READ_CAP.filesPerSubmission,
        'File per submission',
        (take) =>
          transaction.file.findMany({
            take,
            where: {
              submissionHistoryId: history.id,
              lifecycle: FileLifecycle.ATTACHED,
            },
            orderBy: { createdAt: 'desc' },
            select: attachedFileSelect,
          }),
      );
      return {
        id: submission.id,
        status: submission.status,
        content: submission.content,
        submittedAt: submission.submittedAt,
        files: files.map(this.fileMetadata.read),
      };
    });
  }
}
export type { SubmissionReviewDecision };
export interface UpsertSubmissionInput {
  readonly requirementId: string;
  readonly teamId: string;
  readonly submittedById: string;
  readonly submittedAt: Date;
  readonly comment?: string | null;
  readonly expectedRevision?: number;
  readonly deadline?: {
    readonly milestoneId: string;
    readonly allowAfterDeadline: boolean;
    readonly expectedSubmissionStatus: SubmissionStatus | null;
  };
  readonly expectedLatestReviewId: string | null;
  readonly content: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  readonly attachFile: {
    readonly fileId: string;
    readonly uploaderId: string;
    readonly milestoneId: string;
  } | null;
}
const attachedFileSelect = {
  id: true,
  originalFileName: true,
  mimeType: true,
  sizeBytes: true,
} satisfies Prisma.FileSelect;
export interface SubmissionDashboardMilestoneSummary {
  readonly id: string;
  readonly name: string;
  readonly startAt: string;
  readonly dueAt: string;
  readonly submittedTeams: number | null;
  readonly totalTeams: number | null;
}
export interface SubmissionDashboardProgramSummary {
  readonly programId: string;
  readonly milestones: number;
  readonly milestoneSummaries: readonly SubmissionDashboardMilestoneSummary[];
  readonly total: number;
  readonly notSubmitted: number;
  readonly submitted: number;
  readonly approved: number;
  readonly changesRequested: number;
  readonly rejected: number;
}
export interface SubmissionDashboardSummaryRepositoryPort {
  summarizePrograms(
    programIds: readonly string[],
  ): Promise<readonly SubmissionDashboardProgramSummary[]>;
}
@Injectable()
export class SubmissionDashboardSummaryRepository implements SubmissionDashboardSummaryRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}
  async summarizePrograms(
    programIds: readonly string[],
  ): Promise<readonly SubmissionDashboardProgramSummary[]> {
    if (programIds.length === 0) return [];
    return this.prisma.$queryRaw<SubmissionDashboardProgramSummary[]>`
      WITH program_ids AS (
        SELECT DISTINCT unnest(ARRAY[${Prisma.join(programIds)}]::text[]) AS "programId"
      ),
      milestones AS (
        SELECT milestone."id", milestone."programId", milestone."name",
          milestone."startAt", milestone."dueAt"
        FROM "Milestone" AS milestone
        JOIN program_ids USING ("programId")
      ),
      ${Prisma.raw(SUBMISSION_DASHBOARD_STAGE_COUNT_CTES)}
      SELECT
        program_ids."programId",
        COUNT(milestone_counts."milestoneId")::int AS milestones,
        COALESCE(SUM(milestone_counts."totalTeams"), 0)::int AS total,
        COALESCE(SUM(milestone_counts."notSubmitted"), 0)::int AS "notSubmitted",
        COALESCE(SUM(milestone_counts.submitted), 0)::int AS submitted,
        COALESCE(SUM(milestone_counts.approved), 0)::int AS approved,
        COALESCE(SUM(milestone_counts."changesRequested"), 0)::int AS "changesRequested",
        COALESCE(SUM(milestone_counts.rejected), 0)::int AS rejected,
        COALESCE(
          jsonb_agg(jsonb_build_object(
            'id', milestone."id",
            'name', milestone."name",
            'startAt', to_char(milestone."startAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'dueAt', to_char(milestone."dueAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'submittedTeams', milestone_counts."submittedTeams",
            'totalTeams', milestone_counts."totalTeams"
          ) ORDER BY milestone."dueAt", milestone."id") FILTER (WHERE milestone."id" IS NOT NULL),
          '[]'::jsonb
        ) AS "milestoneSummaries"
      FROM program_ids
      LEFT JOIN milestones AS milestone USING ("programId")
      LEFT JOIN milestone_counts ON milestone_counts."milestoneId" = milestone."id"
      GROUP BY program_ids."programId"
      LIMIT ${programIds.length}
    `;
  }
}
export type MatrixApplicationMode = (typeof MATRIX_APPLICATION_MODES)[number];
export type MatrixCellStatus = (typeof MATRIX_CELL_STATUSES)[number];
export type MatrixStatusCounts = Readonly<Record<MatrixCellStatus, number>>;
export type MatrixSort = 'team' | 'progress' | `milestone:${string}`;
export type MatrixSortDirection = 'asc' | 'desc';

export interface SubmissionMatrixFilter {
  readonly q: string;
  readonly applicationMode: MatrixApplicationMode | null;
  readonly status?: MatrixCellStatus;
  readonly sort?: MatrixSort;
  readonly direction?: MatrixSortDirection;
}
export interface MatrixDocumentFirstSubmission {
  readonly teamId: string;
  readonly requirementId: string;
  readonly firstSubmittedAt: Date;
}
async function findMatrixDocumentFirstSubmissions(
  prisma: Prisma.TransactionClient,
  scope: {
    readonly teamIds: readonly string[];
    readonly documentIds: readonly string[];
  },
): Promise<readonly MatrixDocumentFirstSubmission[]> {
  if (scope.teamIds.length === 0 || scope.documentIds.length === 0) {
    return [];
  }
  const submissions = await prisma.submission.findMany({
    take: scope.teamIds.length * scope.documentIds.length,
    where: {
      teamId: { in: [...scope.teamIds] },
      requirementId: { in: [...scope.documentIds] },
    },
    select: {
      teamId: true,
      requirementId: true,
      createdAt: true,
      histories: {
        where: { event: 'SUBMITTED', revision: 1 },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  return submissions.map((submission) => ({
    teamId: submission.teamId,
    requirementId: submission.requirementId,
    firstSubmittedAt:
      submission.histories[0]?.createdAt ?? submission.createdAt,
  }));
}
export interface MatrixMilestoneRecord {
  readonly id: string;
  readonly name: string;
  readonly dueAt: Date;
  readonly requiredDocumentIds: readonly string[];
}
export interface MatrixApplicationRecord {
  readonly id: string;
  readonly leaderName: string | null;
  readonly applicant: {
    readonly name: string | null;
    readonly nickname: string;
  };
  readonly team: {
    readonly name: string;
    readonly memberNicknames: readonly string[];
  } | null;
}
export interface MatrixSubmissionRecord {
  readonly id: string;
  readonly teamId: string;
  readonly milestoneId: string;
  readonly requirementId: string;
  readonly status: SubmissionStatus;
  readonly currentRevision: number;
  readonly submittedAt: Date | null;
}
export interface MatrixApplicationPage {
  readonly items: readonly MatrixApplicationRecord[];
  readonly total: number;
  readonly statusCounts: MatrixStatusCounts;
}
type MatrixPageSelection = MatrixStatusCounts & {
  readonly teamIds: string[];
  readonly total: number;
};
export interface SubmissionMatrixRepositoryPort {
  programExists(programId: string): Promise<boolean>;
  findMilestones(programId: string): Promise<readonly MatrixMilestoneRecord[]>;
  findApprovedApplications(
    programId: string,
    filter: SubmissionMatrixFilter,
    skip: number,
    take: number,
  ): Promise<MatrixApplicationPage>;
  findCurrentSubmissions(
    teamIds: readonly string[],
    programId: string,
  ): Promise<readonly MatrixSubmissionRecord[]>;
  findDocumentFirstSubmissions(
    teamIds: readonly string[],
    documentIds: readonly string[],
  ): Promise<readonly MatrixDocumentFirstSubmission[]>;
  findDocumentChangeRequests(
    teamIds: readonly string[],
    programId: string,
  ): Promise<readonly MatrixDocumentChangeRequest[]>;
}
export interface MatrixDocumentChangeRequest {
  readonly teamId: string;
  readonly milestoneId: string;
}
const matrixApplicationSelect = {
  id: true,
  applicant: {
    select: {
      nickname: true,
      ...USER_PROFILE_NAME_SELECT,
    },
  },
  leader: { select: USER_PROFILE_NAME_SELECT },
  name: true,
  members: {
    take: READ_CAP.membersPerTeam + 1,
    orderBy: { createdAt: 'asc' },
    select: { user: { select: { nickname: true } } },
  },
} satisfies Prisma.TeamSelect;
type MatrixApplicationRow = Prisma.TeamGetPayload<{
  select: typeof matrixApplicationSelect;
}>;
function toMatrixApplication(
  application: MatrixApplicationRow,
): MatrixApplicationRecord {
  return {
    id: application.id,
    leaderName: application.leader.name,
    applicant: {
      name: application.applicant.name ?? null,
      nickname: application.applicant.nickname,
    },
    team: {
      name: application.name,
      memberNicknames: application.members.map(
        (member) => member.user.nickname,
      ),
    },
  };
}
@Injectable()
export class SubmissionMatrixRepository implements SubmissionMatrixRepositoryPort {
  private readonly boundedReads = new BoundedReadRepository();

  constructor(private readonly prisma: PrismaService) {}
  async programExists(programId: string): Promise<boolean> {
    const program = await this.prisma.program.findUnique({
      where: { id: programId },
      select: { id: true },
    });
    return program !== null;
  }
  async findMilestones(
    programId: string,
  ): Promise<readonly MatrixMilestoneRecord[]> {
    const milestones = await this.boundedReads.readCapped(
      READ_CAP.milestonesPerProgram,
      'Milestone per program',
      (take) =>
        this.prisma.milestone
          .findMany({
            take,
            where: { programId },
            orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              name: true,
              dueAt: true,
              requirements: {
                take: READ_CAP.requirementsPerMilestone + 1,
                where: { required: true },
                select: { id: true },
              },
            },
          })
          .then((result) =>
            this.boundedReads.assertNestedWithin(
              result,
              { requirements: READ_CAP.requirementsPerMilestone },
              'Milestone.findMany',
            ),
          ),
    );
    return milestones.map(({ requirements: documents, ...milestone }) => ({
      ...milestone,
      requiredDocumentIds: documents.map((document) => document.id),
    }));
  }
  findDocumentFirstSubmissions(
    teamIds: readonly string[],
    documentIds: readonly string[],
  ): Promise<readonly MatrixDocumentFirstSubmission[]> {
    return findMatrixDocumentFirstSubmissions(this.prisma, {
      teamIds,
      documentIds,
    });
  }
  async findApprovedApplications(
    programId: string,
    filter: SubmissionMatrixFilter,
    skip: number,
    take: number,
  ): Promise<MatrixApplicationPage> {
    const { teamIds, total, ...statusCounts } = await this.selectMatrixPage(
      programId,
      filter,
      skip,
      take,
    );
    if (teamIds.length === 0) return { items: [], total, statusCounts };

    const applications = this.boundedReads.assertNestedWithin(
      await this.prisma.team.findMany({
        where: {
          id: { in: teamIds },
          programId,
          status: ApplicationStatus.APPROVED,
          archivedAt: null,
        },
        take: teamIds.length,
        select: matrixApplicationSelect,
      }),
      { members: READ_CAP.membersPerTeam },
      'Team.findMany',
    );
    const byId = new Map(applications.map((row) => [row.id, row]));
    return {
      items: teamIds.flatMap((id) => {
        const row = byId.get(id);
        return row === undefined ? [] : [toMatrixApplication(row)];
      }),
      total,
      statusCounts,
    };
  }

  private async selectMatrixPage(
    programId: string,
    filter: SubmissionMatrixFilter,
    skip: number,
    take: number,
  ): Promise<MatrixPageSelection> {
    const contains = `%${filter.q}%`;
    const search = filter.q
      ? Prisma.sql`AND (
          applicant."name" ILIKE ${contains}
          OR applicant."login" ILIKE ${contains}
          OR team."name" ILIKE ${contains}
          OR EXISTS (
            SELECT 1 FROM "TeamMember" AS member
            JOIN "User" AS member_user ON member_user."id" = member."userId"
            WHERE member."teamId" = team."id" AND member_user."login" ILIKE ${contains}
          )
        )`
      : Prisma.empty;
    const displayName =
      filter.sort === 'team'
        ? Prisma.sql`, CASE WHEN EXISTS (
          SELECT 1 FROM "TeamMember" AS member
          WHERE member."teamId" = team."id" OFFSET 1
        ) THEN team."name" ELSE COALESCE(applicant."name", applicant."login") END AS "displayName"`
        : Prisma.empty;
    const milestoneId = filter.sort?.startsWith('milestone:')
      ? filter.sort.slice('milestone:'.length)
      : null;
    const direction =
      filter.direction === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    const order =
      filter.sort === 'team'
        ? Prisma.sql`LOWER(matching."displayName") ${direction},`
        : filter.sort === 'progress'
          ? Prisma.sql`matching."progress" ${direction},`
          : milestoneId !== null
            ? Prisma.sql`matching."milestoneRank" ${direction},`
            : Prisma.empty;

    const [selection] = await this.prisma.$queryRaw<
      readonly [MatrixPageSelection]
    >`
      WITH scoped_teams AS (
        SELECT team."id", team."createdAt" ${displayName}
        FROM "Team" AS team
        JOIN "User" AS applicant ON applicant."id" = team."applicantId"
        WHERE team."programId" = ${programId}
          AND team."status" = 'APPROVED'
          AND team."archivedAt" IS NULL
          ${search}
      ), documents AS (
        SELECT document."id", document."milestoneId", document."required"
        FROM "Requirement" AS document
        JOIN "Milestone" AS milestone ON milestone."id" = document."milestoneId"
        WHERE milestone."programId" = ${programId}
      ), required_by_milestone AS (
        SELECT "milestoneId", COUNT(*) AS "total"
        FROM documents
        WHERE "required"
        GROUP BY "milestoneId"
      ), submitted_by_milestone AS (
        SELECT submission."teamId", document."milestoneId",
          COUNT(*) FILTER (WHERE document."required") AS "requiredSubmitted",
          COUNT(*) FILTER (WHERE submission."status" = 'SUBMITTED') AS "SUBMITTED",
          COUNT(*) FILTER (WHERE submission."status" = 'CHANGES_REQUESTED') AS "CHANGES_REQUESTED",
          COUNT(*) FILTER (WHERE submission."status" = 'REJECTED') AS "REJECTED",
          COUNT(*) FILTER (WHERE submission."status" = 'APPROVED') AS "APPROVED",
          MIN(CASE submission."status"
            WHEN 'REJECTED' THEN 0
            WHEN 'CHANGES_REQUESTED' THEN 1
            WHEN 'SUBMITTED' THEN 3
            WHEN 'APPROVED' THEN 4
          END) FILTER (WHERE document."required") AS "requiredRank"
        FROM scoped_teams AS team
        JOIN "Submission" AS submission ON submission."teamId" = team."id"
        JOIN documents AS document ON document."id" = submission."requirementId"
        GROUP BY submission."teamId", document."milestoneId"
      ), submitted_by_team AS (
        SELECT submitted."teamId",
          SUM("requiredSubmitted") AS "requiredSubmitted",
          SUM("SUBMITTED") AS "SUBMITTED",
          SUM("CHANGES_REQUESTED") AS "CHANGES_REQUESTED",
          SUM("REJECTED") AS "REJECTED",
          SUM("APPROVED") AS "APPROVED",
          COUNT(*) FILTER (WHERE "requiredRank" = 4 AND "requiredSubmitted" = required."total") AS "progress",
          MIN(LEAST(COALESCE("requiredRank", 2),
            CASE WHEN "requiredSubmitted" = required."total" THEN 4 ELSE 2 END
          )) FILTER (WHERE submitted."milestoneId" = ${milestoneId}::text) AS "milestoneRank"
        FROM submitted_by_milestone AS submitted
        LEFT JOIN required_by_milestone AS required ON required."milestoneId" = submitted."milestoneId"
        GROUP BY submitted."teamId"
      ), team_slots AS (
        SELECT team.*,
          (SELECT COUNT(*) FROM documents WHERE "required") - COALESCE("requiredSubmitted", 0) AS "NOT_SUBMITTED",
          COALESCE("SUBMITTED", 0) AS "SUBMITTED",
          COALESCE("CHANGES_REQUESTED", 0) AS "CHANGES_REQUESTED",
          COALESCE("REJECTED", 0) AS "REJECTED",
          COALESCE("APPROVED", 0) AS "APPROVED",
          COALESCE("progress", 0) AS "progress",
          COALESCE("milestoneRank", 2) AS "milestoneRank"
        FROM scoped_teams AS team
        LEFT JOIN submitted_by_team AS submitted ON submitted."teamId" = team."id"
      ), matching AS (
        SELECT * FROM team_slots
        WHERE CASE ${filter.status ?? null}::text
          WHEN 'NOT_SUBMITTED' THEN "NOT_SUBMITTED"
          WHEN 'SUBMITTED' THEN "SUBMITTED"
          WHEN 'CHANGES_REQUESTED' THEN "CHANGES_REQUESTED"
          WHEN 'REJECTED' THEN "REJECTED"
          WHEN 'APPROVED' THEN "APPROVED"
          ELSE 1
        END > 0
      )
      SELECT ARRAY(
          SELECT matching."id" FROM matching
          ORDER BY ${order} matching."createdAt" ASC, matching."id" ASC
          LIMIT ${take} OFFSET ${skip}
        ) AS "teamIds",
        (SELECT COUNT(*)::int FROM matching) AS "total",
        COALESCE(SUM("NOT_SUBMITTED"), 0)::int AS "NOT_SUBMITTED",
        COALESCE(SUM("SUBMITTED"), 0)::int AS "SUBMITTED",
        COALESCE(SUM("CHANGES_REQUESTED"), 0)::int AS "CHANGES_REQUESTED",
        COALESCE(SUM("REJECTED"), 0)::int AS "REJECTED",
        COALESCE(SUM("APPROVED"), 0)::int AS "APPROVED"
      FROM team_slots
      LIMIT 1
    `;
    return selection;
  }

  async findDocumentChangeRequests(
    teamIds: readonly string[],
    programId: string,
  ): Promise<readonly MatrixDocumentChangeRequest[]> {
    if (teamIds.length === 0) return [];
    const submissions = await this.boundedReads.readCapped(
      READ_CAP.requirementsPerProgram * teamIds.length,
      'Submission per team',
      (take) =>
        this.prisma.submission.findMany({
          take,
          where: {
            teamId: { in: [...teamIds] },
            status: SubmissionStatus.CHANGES_REQUESTED,
            requirement: { milestone: { programId } },
          },
          select: {
            teamId: true,
            requirement: { select: { milestoneId: true } },
          },
        }),
    );
    return submissions.map((submission) => ({
      teamId: submission.teamId,
      milestoneId: submission.requirement.milestoneId,
    }));
  }
  async findCurrentSubmissions(
    teamIds: readonly string[],
    programId: string,
  ): Promise<readonly MatrixSubmissionRecord[]> {
    if (teamIds.length === 0) return [];
    const submissions = await this.boundedReads.readCapped(
      READ_CAP.requirementsPerProgram * teamIds.length,
      'Submission per team',
      (take) =>
        this.prisma.submission.findMany({
          take,
          where: {
            teamId: { in: [...teamIds] },
            requirement: { required: true, milestone: { programId } },
          },
          select: {
            id: true,
            requirementId: true,
            teamId: true,
            status: true,
            revision: true,
            submittedAt: true,
            requirement: { select: { milestoneId: true } },
          },
        }),
    );
    return submissions.map((submission) => ({
      id: submission.id,
      teamId: submission.teamId,
      milestoneId: submission.requirement.milestoneId,
      requirementId: submission.requirementId,
      status: submission.status,
      currentRevision: submission.revision,
      submittedAt: submission.submittedAt,
    }));
  }
}
type JsonObject = {
  [key in string]?: JsonValue;
};
type JsonArray = JsonValue[];
type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
export type SubmissionRevisionContent = JsonValue;
interface SubmissionFile {
  readonly id: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}
export interface SubmissionDetail {
  readonly id: string;
  readonly status: SubmissionStatus;
  readonly content: JsonValue | null;
  readonly submittedAt: Date;
  readonly files: readonly SubmissionFile[];
}
type ApplicationMode = 'PERSONAL' | 'TEAM';
export interface SubmissionReviewRecord {
  readonly id: string;
  readonly decision: SubmissionReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
}
export interface SubmissionReviewFileRecord {
  readonly fileId: string;
  readonly fileName: string;
  readonly size: number;
  readonly downloadUrl: string;
}
export interface SubmissionRevisionRecord {
  readonly number: number;
  readonly content: SubmissionRevisionContent;
  readonly comment: string | null;
  readonly submittedAt: Date;
  readonly files: readonly SubmissionReviewFileRecord[];
  readonly review: SubmissionReviewRecord | null;
}
export interface SubmissionReviewContext {
  readonly latestReviewId: string | null;
  readonly requirementId: string;
  readonly submissionId: string;
  readonly application: {
    readonly id: string;
    readonly applicationMode: ApplicationMode;
    readonly displayName: string;
  };
  readonly milestone: {
    readonly id: string;
    readonly name: string;
  };
  readonly currentRevision: SubmissionRevisionRecord;
  readonly history: readonly SubmissionRevisionRecord[];
  readonly unversionedReviews?: readonly SubmissionReviewRecord[];
  readonly repository: {
    readonly id: string;
    readonly url: string;
    readonly visibility: RepositoryVisibility;
    readonly publishEligible: boolean;
    readonly blockedReasons: readonly PublishBlockedReason[];
  } | null;
}
export interface CreateSubmissionReviewInput {
  readonly revision: number;
  readonly decision: SubmissionReviewDecision;
  readonly comment: string | null;
}
interface SubmissionReviewTarget {
  readonly id: string;
  readonly currentRevision: number;
  readonly status: SubmissionStatus;
  readonly revision: {
    readonly id: string;
    readonly reviewId: string | null;
  };
}
export interface SubmissionReviewResult {
  readonly reviewId: string;
  readonly submissionStatus: SubmissionStatus;
}
export interface PublishEligibilitySource {
  readonly submissions: readonly SubmissionCompletionTargetRow[];
  readonly isRepositoryPublicationPlanned: boolean;
  readonly provisionJob: {
    readonly status: RepositoryProvisionJobStatus;
    readonly repoId: bigint | null;
  } | null;
  readonly program: {
    readonly endAt: Date;
    readonly milestones: readonly {
      readonly id: string;
      readonly requirements: readonly {
        readonly id: string;
      }[];
    }[];
  };
}
export interface PublishEligibilityRow {
  readonly githubRepositoryId: bigint;
  readonly visibility: RepositoryVisibility;
  readonly application: PublishEligibilitySource;
}
export type ReviewContextRow = Prisma.SubmissionGetPayload<{
  select: SubmissionReviewsRepository['REVIEW_CONTEXT_SELECT'];
}>;
interface CreateReviewRecordInput {
  readonly submissionHistoryId: string;
  readonly submissionId: string;
  readonly revision: number;
  readonly reviewerId: string;
  readonly decision: SubmissionReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
}
interface TransitionSubmissionInput {
  readonly submissionId: string;
  readonly expectedRevision: number;
  readonly nextStatus: SubmissionStatus;
}
export interface SubmissionReviewTransactionStore {
  isSubmissionParticipant(
    submissionId: string,
    userId: string,
  ): Promise<boolean>;
  findReviewTarget(
    submissionId: string,
  ): Promise<SubmissionReviewTarget | null>;
  createReview(input: CreateReviewRecordInput): Promise<{
    readonly id: string;
  }>;
  transitionSubmission(input: TransitionSubmissionInput): Promise<boolean>;
}
export interface SubmissionReviewsRepositoryPort {
  withTransaction<T>(
    operation: (store: SubmissionReviewTransactionStore) => Promise<T>,
  ): Promise<T>;
  findReviewContext(submissionId: string): Promise<ReviewContextRow | null>;
  findPublishEligibility(
    githubRepositoryId: bigint,
  ): Promise<PublishEligibilityRow | null>;
}
@Injectable()
export class SubmissionReviewsRepository implements SubmissionReviewsRepositoryPort {
  private readonly boundedReads = new BoundedReadRepository();

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRepository: PlatformRepository,
  ) {}
  async withTransaction<T>(
    operation: (store: SubmissionReviewTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(this.submissionReviewTransactionStore(transaction)),
    );
  }
  async findReviewContext(
    submissionId: string,
  ): Promise<ReviewContextRow | null> {
    return this.prisma.submission
      .findUnique({
        where: {
          id: submissionId,
          team: { program: { lifecycle: { not: 'DELETED' } } },
        },
        select: this.REVIEW_CONTEXT_SELECT,
      })
      .then((result) =>
        this.boundedReads.assertNestedWithin(
          result,
          {
            team: {
              nested: {
                program: {
                  nested: {
                    milestones: {
                      cap: READ_CAP.milestonesPerProgram,
                      nested: {
                        requirements: READ_CAP.requirementsPerMilestone,
                      },
                    },
                  },
                },
                submissions: READ_CAP.requirementsPerProgram,
              },
            },
            histories: {
              cap: READ_CAP.historiesPerSubmission,
              nested: { files: READ_CAP.filesPerSubmission },
            },
          },
          'Submission.findUnique',
        ),
      );
  }
  async findPublishEligibility(
    githubRepositoryId: bigint,
  ): Promise<PublishEligibilityRow | null> {
    const link = await this.prisma.teamRepo
      .findFirst({
        where: {
          repoId: githubRepositoryId,
          validTo: null,
          team: { program: { lifecycle: { not: 'DELETED' } } },
        },
        select: {
          repo: { select: { visibility: true } },
          team: {
            select: {
              isRepositoryPublicationPlanned: true,
              provisionJob: { select: { status: true, repoId: true } },
              program: {
                select: {
                  endAt: true,
                  milestones: {
                    take: READ_CAP.milestonesPerProgram + 1,
                    select: {
                      id: true,
                      requirements: {
                        take: READ_CAP.requirementsPerMilestone + 1,
                        where: {
                          required: true,
                        },
                        select: { id: true },
                      },
                    },
                  },
                },
              },
              submissions: {
                take: READ_CAP.requirementsPerProgram + 1,
                select: {
                  status: true,
                  requirement: {
                    select: { id: true, milestoneId: true },
                  },
                },
              },
            },
          },
        },
      })
      .then((result) =>
        this.boundedReads.assertNestedWithin(
          result,
          {
            team: {
              nested: {
                program: {
                  nested: {
                    milestones: {
                      cap: READ_CAP.milestonesPerProgram,
                      nested: {
                        requirements: READ_CAP.requirementsPerMilestone,
                      },
                    },
                  },
                },
                submissions: READ_CAP.requirementsPerProgram,
              },
            },
          },
          'TeamRepo.findFirst',
        ),
      );

    if (link === null) return null;
    return {
      githubRepositoryId,
      visibility: link.repo.visibility,
      application: link.team,
    };
  }
  readonly REVIEW_CONTEXT_SELECT = {
    id: true,
    revision: true,
    team: {
      select: {
        id: true,
        applicant: {
          select: { nickname: true, ...USER_PROFILE_NAME_SELECT },
        },
        name: true,
        isRepositoryPublicationPlanned: true,
        provisionJob: { select: { status: true, repoId: true } },
        program: {
          select: {
            endAt: true,
            milestones: {
              take: READ_CAP.milestonesPerProgram + 1,
              select: {
                id: true,
                requirements: {
                  take: READ_CAP.requirementsPerMilestone + 1,
                  where: {
                    required: true,
                  },
                  select: { id: true },
                },
              },
            },
          },
        },
        submissions: {
          take: READ_CAP.requirementsPerProgram + 1,
          select: {
            status: true,
            requirement: {
              select: { id: true, milestoneId: true },
            },
          },
        },
        teamRepos: {
          where: { validTo: null },
          take: 1,
          select: {
            repo: {
              select: { githubRepoId: true, ownerName: true, visibility: true },
            },
          },
        },
      },
    },
    requirement: {
      select: { id: true, milestone: { select: { id: true, name: true } } },
    },
    histories: {
      take: READ_CAP.historiesPerSubmission + 1,
      orderBy: [
        { revision: 'desc' as const },
        { createdAt: 'desc' as const },
        { id: 'desc' as const },
      ],
      select: {
        id: true,
        event: true,
        revision: true,
        content: true,
        comment: true,
        createdAt: true,
        files: {
          take: READ_CAP.filesPerSubmission + 1,
          orderBy: { id: 'asc' as const },
          select: {
            id: true,
            originalFileName: true,
            mimeType: true,
            sizeBytes: true,
            expiresAt: true,
            lifecycle: true,
          },
        },
      },
    },
  } satisfies Prisma.SubmissionSelect;
  private submissionReviewTransactionStore(
    transaction: PrismaTypes.TransactionClient,
  ): SubmissionReviewTransactionStore {
    return {
      isSubmissionParticipant: this.isSubmissionParticipantIn.bind(
        this,
        transaction,
      ),
      findReviewTarget: this.findReviewTargetIn.bind(this, transaction),
      createReview: this.createReviewIn.bind(this, transaction),
      transitionSubmission: this.transitionSubmissionIn.bind(this, transaction),
    };
  }
  private async isSubmissionParticipantIn(
    transaction: PrismaTypes.TransactionClient,
    submissionId: string,
    userId: string,
  ): Promise<boolean> {
    const submission = await transaction.submission.findFirst({
      where: {
        id: submissionId,
        team: this.platformRepository.programApplicationParticipantWhere(
          userId,
        ),
      },
      select: { id: true },
    });
    return submission !== null;
  }
  private async findReviewTargetIn(
    transaction: PrismaTypes.TransactionClient,
    submissionId: string,
  ): Promise<SubmissionReviewTarget | null> {
    const resolved = await transaction.submission.findUnique({
      where: {
        id: submissionId,
      },
      select: { id: true, team: { select: { programId: true } } },
    });
    if (resolved === null) return null;
    const targetId = resolved.id;
    const programs = await transaction.$queryRaw<
      readonly {
        id: string;
      }[]
    >(Prisma.sql`
        SELECT "id"
        FROM "Program"
        WHERE "id" = ${resolved.team.programId}
          AND "lifecycle" <> 'DELETED'
        LIMIT 1 FOR SHARE
      `);
    if (programs.length === 0) return null;
    await transaction.$queryRaw<
      readonly {
        id: string;
      }[]
    >(Prisma.sql`
      SELECT "id"
      FROM "Submission"
      WHERE "id" = ${targetId}
      LIMIT 1 FOR UPDATE
    `);
    const submission = await transaction.submission.findUnique({
      where: {
        id: targetId,
        team: { program: { lifecycle: { not: 'DELETED' } } },
      },
      select: { id: true, revision: true, status: true },
    });
    if (submission === null) return null;
    const history = await transaction.submissionHistory.findFirst({
      where: {
        submissionId: targetId,
        revision: submission.revision,
        event: {
          in: [
            SubmissionHistoryEvent.SUBMITTED,
            SubmissionHistoryEvent.RESUBMITTED,
          ],
        },
      },
      orderBy: { id: 'desc' },
      select: {
        id: true,
      },
    });
    if (history === null) return null;
    const review = await transaction.submissionHistory.findFirst({
      where: {
        submissionId: targetId,
        revision: submission.revision,
        event: { in: SUBMISSION_REVIEW_EVENTS },
      },
      select: { id: true },
    });
    return {
      id: submission.id,
      currentRevision: submission.revision,
      status: submission.status,
      revision: {
        id: history.id,
        reviewId: review?.id ?? null,
      },
    };
  }
  private async createReviewIn(
    transaction: PrismaTypes.TransactionClient,
    input: CreateReviewRecordInput,
  ): Promise<{
    readonly id: string;
  }> {
    return this.platformRepository.appendSubmissionReviewEvent(
      transaction,
      input,
    );
  }
  private async transitionSubmissionIn(
    transaction: PrismaTypes.TransactionClient,
    input: TransitionSubmissionInput,
  ): Promise<boolean> {
    const result = await transaction.submission.updateMany({
      where: {
        id: input.submissionId,
        revision: input.expectedRevision,
      },
      data: { status: input.nextStatus },
    });
    return result.count === 1;
  }
}
