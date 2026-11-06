import { FileMetadataRepository } from './files.repository';
import { SUBMISSION_REVIEW_EVENTS } from './submission-history.config';
import { Injectable, Inject } from '@nestjs/common';
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
  MilestoneDocumentPendingFileMissingError,
  MilestoneDocumentReviewChangedError,
  MilestoneDocumentDeadlineClosedError,
  MilestoneDocumentSubmissionChangedError,
  MilestoneDocumentRevisionChangedError,
  MilestoneDocumentMissingError,
  SubmissionMembershipChangedError,
} from './submissions.error';
import { USER_PROFILE_NAME_SELECT } from '../platform/user-profile-read.config';
import { MATRIX_APPLICATION_MODES } from './submission-matrix.config';
import type { PublishBlockedReason } from '../github/repository-publish.config';
import type { SubmissionCompletionTargetRow } from './submission-completion.config';
@Injectable()
export class SubmissionsRepository {
  constructor(
    private readonly platformRepository: PlatformRepository,
    private readonly fileMetadata: FileMetadataRepository,
  ) {}
  nextHistoryCreatedAt(requested: Date, latest: Date | null): Date {
    return latest === null || requested.getTime() > latest.getTime()
      ? requested
      : new Date(latest.getTime() + 1);
  }
  milestoneDocumentSubmissionContent(
    text: string | null,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    return text === null
      ? Prisma.JsonNull
      : { type: RequirementSubmissionType.TEXT, text };
  }
  upsertMilestoneDocumentSubmission(
    prisma: PrismaService,
    input: UpsertMilestoneDocumentSubmissionInput,
  ): Promise<MilestoneDocumentSubmissionDetail> {
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
          FOR SHARE
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
      WHERE "id" = ${input.milestoneDocumentId}
      FOR UPDATE
    `);
      const document = documents[0];
      if (document === undefined) throw new MilestoneDocumentMissingError();
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
        throw new MilestoneDocumentDeadlineClosedError();
      }
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "Submission"
        WHERE "requirementId" = ${input.milestoneDocumentId}
          AND "teamId" = ${input.teamId}
        FOR UPDATE
      `);
      const latestHistory = await transaction.submissionHistory.findFirst({
        where: {
          submission: {
            requirementId: input.milestoneDocumentId,
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
            requirementId: input.milestoneDocumentId,
            teamId: input.teamId,
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      if ((latestReview?.id ?? null) !== input.expectedLatestReviewId) {
        throw new MilestoneDocumentReviewChangedError();
      }
      if (
        input.expectedRevision !== undefined ||
        (afterDeadline && input.deadline !== undefined)
      ) {
        const current = await transaction.submission.findUnique({
          where: {
            requirementId_teamId: {
              requirementId: input.milestoneDocumentId,
              teamId: input.teamId,
            },
          },
          select: { status: true, revision: true },
        });
        if (
          input.expectedRevision !== undefined &&
          (current?.revision ?? 0) !== input.expectedRevision
        ) {
          throw new MilestoneDocumentRevisionChangedError();
        }
        if (
          afterDeadline &&
          input.deadline !== undefined &&
          (current?.status ?? null) !== input.deadline.expectedSubmissionStatus
        )
          throw new MilestoneDocumentSubmissionChangedError();
      }
      const submission = await transaction.submission.upsert({
        where: {
          requirementId_teamId: {
            requirementId: input.milestoneDocumentId,
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
          requirementId: input.milestoneDocumentId,
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
            requirementId: input.milestoneDocumentId,
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
          throw new MilestoneDocumentPendingFileMissingError();
        }
      }
      const files = await transaction.file.findMany({
        where: {
          submissionHistoryId: history.id,
          lifecycle: FileLifecycle.ATTACHED,
        },
        orderBy: { createdAt: 'desc' },
        select: attachedFileSelect,
      });
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
export type SubmissionReviewDecision =
  'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';
export interface UpsertMilestoneDocumentSubmissionInput {
  readonly milestoneDocumentId: string;
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
const dashboardApplicationSelect = {
  id: true,
  programId: true,
} satisfies Prisma.TeamSelect;
const dashboardMilestoneSelect = {
  id: true,
  programId: true,
} satisfies Prisma.MilestoneSelect;
const dashboardMilestoneDocumentSelect = {
  id: true,
  milestoneId: true,
  milestone: { select: { programId: true } },
} satisfies Prisma.RequirementSelect;
const dashboardDocumentSubmissionSelect = {
  teamId: true,
  requirementId: true,
  status: true,
  team: { select: { programId: true } },
  requirement: {
    select: {
      milestoneId: true,
      milestone: { select: { programId: true } },
    },
  },
} satisfies Prisma.SubmissionSelect;
export type DashboardApplicationRow = Prisma.TeamGetPayload<{
  select: typeof dashboardApplicationSelect;
}>;
export type DashboardMilestoneRow = Prisma.MilestoneGetPayload<{
  select: typeof dashboardMilestoneSelect;
}>;
export type DashboardMilestoneDocumentRow = Prisma.RequirementGetPayload<{
  select: typeof dashboardMilestoneDocumentSelect;
}>;
export type DashboardDocumentSubmissionRow = Prisma.SubmissionGetPayload<{
  select: typeof dashboardDocumentSubmissionSelect;
}>;
export interface SubmissionDashboardSummaryDataSource {
  readonly team: {
    findMany(args: {
      readonly where: Prisma.TeamWhereInput;
      readonly select: typeof dashboardApplicationSelect;
    }): Promise<readonly DashboardApplicationRow[]>;
  };
  readonly milestone: {
    findMany(args: {
      readonly where: Prisma.MilestoneWhereInput;
      readonly select: typeof dashboardMilestoneSelect;
    }): Promise<readonly DashboardMilestoneRow[]>;
  };
  readonly requirement: {
    findMany(args: {
      readonly where: Prisma.RequirementWhereInput;
      readonly select: typeof dashboardMilestoneDocumentSelect;
    }): Promise<readonly DashboardMilestoneDocumentRow[]>;
  };
  readonly submission: {
    findMany(args: {
      readonly where: Prisma.SubmissionWhereInput;
      readonly select: typeof dashboardDocumentSubmissionSelect;
    }): Promise<readonly DashboardDocumentSubmissionRow[]>;
  };
}
export interface SubmissionDashboardApplicationRecord {
  readonly id: string;
  readonly programId: string;
}
export interface SubmissionDashboardMilestoneRecord {
  readonly id: string;
  readonly programId: string;
}
interface SubmissionDashboardSubmissionRecord {
  readonly teamId: string;
  readonly applicationProgramId: string;
  readonly milestoneId: string;
  readonly milestoneProgramId: string;
  readonly status: SubmissionStatus;
}
export interface SubmissionDashboardMilestoneDocumentRecord {
  readonly id: string;
  readonly milestoneId: string;
  readonly milestoneProgramId: string;
}
export interface SubmissionDashboardDocumentSubmissionRecord {
  readonly teamId: string;
  readonly applicationProgramId: string;
  readonly milestoneDocumentId: string;
  readonly milestoneId: string;
  readonly milestoneProgramId: string;
  readonly status: SubmissionStatus;
}
export interface SubmissionDashboardSummaryRecords {
  readonly applications: readonly SubmissionDashboardApplicationRecord[];
  readonly milestones: readonly SubmissionDashboardMilestoneRecord[];
  readonly submissions: readonly SubmissionDashboardSubmissionRecord[];
  readonly milestoneDocuments: readonly SubmissionDashboardMilestoneDocumentRecord[];
  readonly documentSubmissions: readonly SubmissionDashboardDocumentSubmissionRecord[];
}
export interface SubmissionDashboardSummaryRepositoryPort {
  listRecords(
    programIds: readonly string[],
  ): Promise<SubmissionDashboardSummaryRecords>;
}
@Injectable()
export class SubmissionDashboardSummaryRepository implements SubmissionDashboardSummaryRepositoryPort {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: SubmissionDashboardSummaryDataSource,
  ) {}
  async listRecords(
    programIds: readonly string[],
  ): Promise<SubmissionDashboardSummaryRecords> {
    if (programIds.length === 0) {
      return {
        applications: [],
        milestones: [],
        submissions: [],
        milestoneDocuments: [],
        documentSubmissions: [],
      };
    }
    const programFilter = { in: [...programIds] };
    const [applications, milestones, milestoneDocuments, targetSubmissions] =
      await Promise.all([
        this.prisma.team.findMany({
          where: {
            programId: programFilter,
            status: ApplicationStatus.APPROVED,
          },
          select: dashboardApplicationSelect,
        }),
        this.prisma.milestone.findMany({
          where: { programId: programFilter },
          select: dashboardMilestoneSelect,
        }),
        this.prisma.requirement.findMany({
          where: {
            required: true,
            milestone: { is: { programId: programFilter } },
          },
          select: dashboardMilestoneDocumentSelect,
        }),
        this.prisma.submission.findMany({
          where: {
            team: {
              is: {
                programId: programFilter,
                status: ApplicationStatus.APPROVED,
              },
            },
            requirement: {
              is: {
                milestone: { is: { programId: programFilter } },
                required: true,
              },
            },
          },
          select: dashboardDocumentSubmissionSelect,
        }),
      ]);
    const submissions: SubmissionDashboardSubmissionRecord[] = [];
    const documentSubmissions: SubmissionDashboardDocumentSubmissionRecord[] =
      [];
    for (const submission of targetSubmissions) {
      const { requirement: milestoneDocument } = submission;
      documentSubmissions.push({
        teamId: submission.teamId,
        applicationProgramId: submission.team.programId,
        milestoneDocumentId: submission.requirementId,
        milestoneId: milestoneDocument.milestoneId,
        milestoneProgramId: milestoneDocument.milestone.programId,
        status: submission.status,
      });
    }
    return {
      applications,
      milestones,
      submissions,
      milestoneDocuments: milestoneDocuments.map((document) => ({
        id: document.id,
        milestoneId: document.milestoneId,
        milestoneProgramId: document.milestone.programId,
      })),
      documentSubmissions,
    };
  }
}
export type MatrixApplicationMode = (typeof MATRIX_APPLICATION_MODES)[number];
export interface SubmissionMatrixFilter {
  readonly q: string;
  readonly applicationMode: MatrixApplicationMode | null;
}
export interface MatrixDocumentFirstSubmission {
  readonly teamId: string;
  readonly milestoneDocumentId: string;
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
    milestoneDocumentId: submission.requirementId,
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
  readonly milestoneDocumentId: string;
  readonly status: SubmissionStatus;
  readonly currentRevision: number;
  readonly submittedAt: Date | null;
}
export interface MatrixApplicationPage {
  readonly items: readonly MatrixApplicationRecord[];
  readonly total: number;
}
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
  ): Promise<readonly MatrixSubmissionRecord[]>;
  findDocumentFirstSubmissions(
    teamIds: readonly string[],
    documentIds: readonly string[],
  ): Promise<readonly MatrixDocumentFirstSubmission[]>;
  findDocumentChangeRequests(
    teamIds: readonly string[],
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
  name: true,
  members: {
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRepository: PlatformRepository,
  ) {}
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
    const milestones = await this.prisma.milestone.findMany({
      where: { programId },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        dueAt: true,
        requirements: {
          where: { required: true },
          select: { id: true },
        },
      },
    });
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
    const where = this.submissionMatrixApplicationWhere(programId, filter);
    const [applications, total] = await Promise.all([
      this.prisma.team.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip,
        take,
        select: matrixApplicationSelect,
      }),
      this.prisma.team.count({ where }),
    ]);
    return { items: applications.map(toMatrixApplication), total };
  }
  async findDocumentChangeRequests(
    teamIds: readonly string[],
  ): Promise<readonly MatrixDocumentChangeRequest[]> {
    if (teamIds.length === 0) return [];
    const submissions = await this.prisma.submission.findMany({
      where: {
        teamId: { in: [...teamIds] },
        status: SubmissionStatus.CHANGES_REQUESTED,
        requirement: {},
      },
      select: {
        teamId: true,
        requirement: { select: { milestoneId: true } },
      },
    });
    return submissions.map((submission) => ({
      teamId: submission.teamId,
      milestoneId: submission.requirement.milestoneId,
    }));
  }
  async findCurrentSubmissions(
    teamIds: readonly string[],
  ): Promise<readonly MatrixSubmissionRecord[]> {
    if (teamIds.length === 0) return [];
    const submissions = await this.prisma.submission.findMany({
      where: {
        teamId: { in: [...teamIds] },
        requirement: { required: true },
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
    });
    return submissions.map((submission) => ({
      id: submission.id,
      teamId: submission.teamId,
      milestoneId: submission.requirement.milestoneId,
      milestoneDocumentId: submission.requirementId,
      status: submission.status,
      currentRevision: submission.revision,
      submittedAt: submission.submittedAt,
    }));
  }
  submissionMatrixApplicationWhere(
    programId: string,
    filter: SubmissionMatrixFilter,
  ): Prisma.TeamWhereInput {
    const where: Prisma.TeamWhereInput = {
      programId,
      status: ApplicationStatus.APPROVED,
    };
    if (filter.q.length > 0) {
      const contains = { contains: filter.q, mode: 'insensitive' as const };
      where.OR = [
        { applicant: this.platformRepository.userProfileNameWhere(filter.q) },
        { applicant: { nickname: contains } },
        { name: contains },
        { members: { some: { user: { nickname: contains } } } },
      ];
    }
    return where;
  }
}
type JsonObject = {
  [key in string]?: JsonValue;
};
type JsonArray = JsonValue[];
type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
export type SubmissionRevisionContent = JsonValue;
interface MilestoneDocumentSubmissionFile {
  readonly id: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}
export interface MilestoneDocumentSubmissionDetail {
  readonly id: string;
  readonly status: SubmissionStatus;
  readonly content: JsonValue | null;
  readonly submittedAt: Date;
  readonly files: readonly MilestoneDocumentSubmissionFile[];
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
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: Date;
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
export interface RepositoryPublishResult {
  readonly repositoryId: string;
  readonly visibility: typeof RepositoryVisibility.PUBLIC;
  readonly publishedAt: Date;
}
export interface PublishEligibilitySource {
  readonly submissions: readonly SubmissionCompletionTargetRow[];
  readonly isRepositoryPublicationPlanned: boolean;
  readonly provisionJob: {
    readonly status: RepositoryProvisionJobStatus;
    readonly repositoryId: string | null;
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
  readonly id: string;
  readonly visibility: RepositoryVisibility;
  readonly application: PublishEligibilitySource;
}
export type ReviewContextRow = Prisma.SubmissionGetPayload<{
  select: SubmissionReviewsRepository['REVIEW_CONTEXT_SELECT'];
}>;
interface CreateReviewRecordInput {
  readonly submissionHistoryId: string;
  readonly milestoneDocumentSubmissionId: string;
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
    repositoryId: string,
  ): Promise<PublishEligibilityRow | null>;
}
@Injectable()
export class SubmissionReviewsRepository implements SubmissionReviewsRepositoryPort {
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
    return this.prisma.submission.findUnique({
      where: {
        id: submissionId,
        team: { program: { lifecycle: { not: 'DELETED' } } },
      },
      select: this.REVIEW_CONTEXT_SELECT,
    });
  }
  async findPublishEligibility(
    repositoryId: string,
  ): Promise<PublishEligibilityRow | null> {
    const repository = await this.prisma.githubRepository.findUnique({
      where: {
        id: repositoryId,
        team: { program: { lifecycle: { not: 'DELETED' } } },
      },
      select: {
        id: true,
        visibility: true,
        team: {
          select: {
            isRepositoryPublicationPlanned: true,
            provisionJob: { select: { status: true, repositoryId: true } },
            program: {
              select: {
                endAt: true,
                milestones: {
                  select: {
                    id: true,
                    requirements: {
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
    });

    if (repository === null || repository.team === null) return null;
    return { ...repository, application: repository.team };
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
        provisionJob: { select: { status: true, repositoryId: true } },
        program: {
          select: {
            endAt: true,
            milestones: {
              select: {
                id: true,
                requirements: {
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
          select: {
            status: true,
            requirement: {
              select: { id: true, milestoneId: true },
            },
          },
        },
        repository: {
          select: {
            id: true,
            nameWithOwner: true,
            visibility: true,
          },
        },
      },
    },
    requirement: {
      select: { id: true, milestone: { select: { id: true, name: true } } },
    },
    histories: {
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
        FOR SHARE
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
      FOR UPDATE
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
