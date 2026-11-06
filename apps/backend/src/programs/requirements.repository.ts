import { Injectable, Inject } from '@nestjs/common';
import {
  ApplicationStatus,
  SubmissionStatus,
  Prisma,
  ReviewDecision,
  RequirementSubmissionType,
  AccountStatus,
  SubmissionHistoryEvent,
  FileLifecycle,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import {
  USER_PROFILE_NAME_SELECT,
  USER_AUTHORITY_SELECT,
  STUDENT_MEMBER_WHERE,
} from '../platform/user-profile-read.config';
import { FileMetadataRepository } from './files.repository';
import { SUBMISSION_REVIEW_EVENTS } from './submission-history.config';
import { PlatformRepository } from '../platform/platform.repository';
import {
  LockProgramTreeRepository,
  type MilestoneLock,
} from '../platform/lock-program-tree.repository';
import {
  type MilestoneDocumentSubmissionDetail,
  type UpsertMilestoneDocumentSubmissionInput,
  SubmissionsRepository,
} from './submissions.repository';
import { InvalidMilestoneDocumentHistoryCursorError } from './submissions.error';
export interface MilestoneDocumentArchiveDocument {
  readonly id: string;
  readonly name: string;
  readonly required: boolean;
}
export interface ArchiveProgram {
  readonly name: string;
  readonly milestones: readonly {
    readonly id: string;
    readonly name: string;
    readonly dueAt: Date;
    readonly requirements: readonly MilestoneDocumentArchiveDocument[];
  }[];
}
export interface MilestoneDocumentArchiveTeam {
  readonly teamId: string;
  readonly teamName: string;
  readonly applicantName: string | null;
  readonly memberNicknames: readonly string[];
}
export interface MilestoneDocumentArchiveSubmission {
  readonly teamId: string;
  readonly milestoneDocumentId: string;
  readonly submittedAt: Date;
  readonly status: SubmissionStatus;
  readonly content: unknown;
  readonly hasCurrentFileEvidence: boolean;
  readonly file: {
    readonly storageKey: string;
    readonly originalFileName: string;
    readonly sizeBytes: number;
  } | null;
}
export interface ProgramArchiveReader {
  findProgram(programId: string): Promise<ArchiveProgram | null>;
  findApprovedTeams(
    programId: string,
    teamId?: string,
  ): Promise<readonly MilestoneDocumentArchiveTeam[]>;
}
@Injectable()
export class MilestoneDocumentArchiveRepository implements ProgramArchiveReader {
  constructor(private readonly prisma: PrismaService) {}
  async findProgram(programId: string): Promise<ArchiveProgram | null> {
    return this.prisma.program.findUnique({
      where: { id: programId, lifecycle: { not: 'DELETED' } },
      select: {
        name: true,
        milestones: {
          orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            name: true,
            dueAt: true,
            requirements: {
              where: {},
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
              select: { id: true, name: true, required: true },
            },
          },
        },
      },
    });
  }
  async findApprovedTeams(
    programId: string,
    teamId?: string,
  ): Promise<readonly MilestoneDocumentArchiveTeam[]> {
    const applications = await this.prisma.team.findMany({
      where: {
        programId,
        status: ApplicationStatus.APPROVED,
        ...(teamId === undefined ? {} : { id: teamId }),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        applicant: { select: USER_PROFILE_NAME_SELECT },
        name: true,
        members: {
          orderBy: { createdAt: 'asc' },
          select: { user: { select: { nickname: true } } },
        },
      },
    });
    return applications.map((application) => ({
      teamId: application.id,
      teamName: application.name,
      applicantName: application.applicant.name ?? null,
      memberNicknames: application.members.map(
        (member) => member.user.nickname,
      ),
    }));
  }
}
export type DocumentDeliveryStatus =
  'MISSING' | 'LATE' | 'COMPLETE' | 'NO_REQUIRED_ITEMS';
export type MilestoneDocumentContentInput = {
  readonly text: string | null;
  readonly fileId: string | null;
  readonly comment?: string | null;
  readonly expectedRevision?: number;
};
export type MilestoneDocumentSubmittedContent = {
  readonly type: typeof RequirementSubmissionType.TEXT;
  readonly text: string;
};
export interface CreateMilestoneDocumentReviewInput {
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly expectedRevision: number;
  readonly expectedLatestReviewId: string | null;
}
interface MilestoneDocumentReviewRecord {
  readonly id: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
}
export type ProgramDocumentChangeRequestScope =
  | {
      readonly kind: 'PROGRAM';
    }
  | {
      readonly kind: 'TEAM';
      readonly teamId: string;
    };
export interface ProgramDocumentChangeRequestInput {
  readonly scope: ProgramDocumentChangeRequestScope;
  readonly includeFinalDecisions: boolean;
  readonly comment: string | null;
  readonly expectedVersion: string;
}
export interface ProgramDocumentChangeRequestCandidate {
  readonly milestoneDocumentId: string;
  readonly teamId: string;
  readonly status: SubmissionStatus;
}
export interface ProgramDocumentChangeRequestPreview {
  readonly counts: Readonly<Record<SubmissionStatus, number>>;
  readonly version: string;
}
type JsonValue =
  | string
  | number
  | boolean
  | {
      [key: string]: JsonValue | undefined;
    }
  | JsonValue[]
  | null;
export interface MilestoneDocumentRecord {
  id: string;
  milestoneId: string;
  name: string;
  required: boolean;
  submissionType: RequirementSubmissionType;
  sortOrder: number;
  graceDueAt: Date | null;
  templateFileId: string | null;
  templateFileName: string | null;
}
export interface MilestoneContext {
  readonly id: string;
  readonly programId: string;
  readonly name: string;
  readonly dueAt: Date;
}
export interface MilestoneDocumentCollectionApplication {
  readonly teamId: string;
  readonly teamName: string;
  readonly applicantName: string | null;
  readonly memberNicknames: readonly string[];
}
export interface MilestoneDocumentCollectionSubmission {
  readonly milestoneDocumentId: string;
  readonly teamId: string;
  readonly submittedAt: Date;
  readonly revision: number;
  readonly status: SubmissionStatus;
  readonly file: {
    readonly originalFileName: string;
    readonly sizeBytes: number;
  } | null;
  readonly content: JsonValue | null;
  readonly review: MilestoneDocumentReviewRecord | null;
}
export interface CreatedMilestoneDocumentReview {
  readonly id: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
  readonly reviewerNickname: string;
}
export interface UpsertMilestoneDocumentInput {
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
}
export interface DocumentDeliveryCoordinate {
  readonly teamId: string;
  readonly milestoneDocumentId: string;
  readonly firstSubmittedAt: Date;
}
@Injectable()
export class MilestoneDocumentCollectionReadRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileMetadata: FileMetadataRepository,
  ) {}
  withSnapshot<T>(
    operation: (
      store: MilestoneDocumentCollectionReadStoreRepository,
    ) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      (transaction) =>
        operation(
          new MilestoneDocumentCollectionReadStoreRepository(
            transaction,
            this,
            this.fileMetadata,
          ),
        ),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  readonly milestoneDocumentHistoryDescendingOrderBy = [
    { createdAt: 'desc' },
    { id: 'desc' },
  ] satisfies Prisma.SubmissionHistoryOrderByWithRelationInput[];
  readonly boundedReviewHistoryQuery = {
    where: { event: { in: SUBMISSION_REVIEW_EVENTS } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 50,
    select: {
      id: true,
      event: true,
      comment: true,
      createdAt: true,
      actor: { select: { nickname: true } },
      revision: true,
    },
  } satisfies Prisma.Submission$historiesArgs;
}
@Injectable()
export class MilestoneDocumentCollectionReadStoreRepository {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly milestoneDocumentCollectionReadRepository: MilestoneDocumentCollectionReadRepository,
    private readonly fileMetadata: FileMetadataRepository,
  ) {}
  findMilestone(milestoneId: string): Promise<MilestoneContext | null> {
    return this.transaction.milestone.findUnique({
      where: { id: milestoneId },
      select: { id: true, programId: true, name: true, dueAt: true },
    });
  }
  async findDocuments(
    milestoneId: string,
  ): Promise<readonly MilestoneDocumentRecord[]> {
    const documents = await this.transaction.requirement.findMany({
      where: {
        milestoneId,
      },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        milestoneId: true,
        name: true,
        required: true,
        submissionType: true,
        sortOrder: true,
        graceDueAt: true,
        files: {
          where: { kind: 'TEMPLATE', lifecycle: 'ATTACHED' },
          take: 1,
          select: { id: true, originalFileName: true },
        },
      },
    });
    return documents.map(({ files, ...document }) => ({
      ...document,
      templateFileId: files[0]?.id ?? null,
      templateFileName: files[0]?.originalFileName ?? null,
    }));
  }
  async findApplications(
    programId: string,
  ): Promise<readonly MilestoneDocumentCollectionApplication[]> {
    const applications = await this.transaction.team.findMany({
      where: { programId, status: 'APPROVED' },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        applicant: { select: USER_PROFILE_NAME_SELECT },
        name: true,
        members: {
          orderBy: { createdAt: 'asc' },
          select: { user: { select: { nickname: true } } },
        },
      },
    });
    return applications.map((application) => ({
      teamId: application.id,
      teamName: application.name,
      applicantName: application.applicant.name ?? null,
      memberNicknames: application.members.map(
        (member) => member.user.nickname,
      ),
    }));
  }
  async findCoordinates(
    documentIds: readonly string[],
    teamIds: readonly string[],
  ): Promise<readonly DocumentDeliveryCoordinate[]> {
    if (documentIds.length === 0 || teamIds.length === 0) return [];
    const submissions = await this.transaction.submission.findMany({
      where: {
        requirementId: { in: [...documentIds] },
        teamId: { in: [...teamIds] },
      },
      select: {
        requirementId: true,
        teamId: true,
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
      milestoneDocumentId: submission.requirementId,
      teamId: submission.teamId,

      firstSubmittedAt:
        submission.histories[0]?.createdAt ?? submission.createdAt,
    }));
  }
  async findDetails(
    documentIds: readonly string[],
    teamIds: readonly string[],
    now: Date,
  ): Promise<readonly MilestoneDocumentCollectionSubmission[]> {
    if (documentIds.length === 0 || teamIds.length === 0) return [];
    const submissions = await this.transaction.submission.findMany({
      where: {
        requirementId: { in: [...documentIds] },
        teamId: { in: [...teamIds] },
      },
      select: {
        requirementId: true,
        teamId: true,
        submittedAt: true,
        revision: true,
        status: true,
        content: true,
        files: {
          where: { lifecycle: 'ATTACHED', expiresAt: { gt: now } },
          orderBy: [
            {
              submissionHistory: {
                revision: { sort: 'desc', nulls: 'last' },
              },
            },
            { createdAt: 'desc' },
          ],
          take: 1,
          select: {
            originalFileName: true,
            mimeType: true,
            sizeBytes: true,
            submissionHistory: { select: { revision: true } },
          },
        },
        histories: {
          ...this.milestoneDocumentCollectionReadRepository
            .boundedReviewHistoryQuery,
          take: 1,
        },
      },
    });
    return submissions.map(
      ({ files, histories, requirementId, ...submission }) => {
        const selectedFile =
          files[0] === undefined ? undefined : this.fileMetadata.read(files[0]);
        const review = histories[0];
        return {
          milestoneDocumentId: requirementId,
          ...submission,
          file:
            selectedFile?.submissionHistory?.revision === submission.revision
              ? {
                  originalFileName: selectedFile.originalFileName,
                  sizeBytes: selectedFile.sizeBytes,
                }
              : null,
          review:
            review === undefined
              ? null
              : {
                  id: review.id,
                  decision: submissionReviewDecision(review.event),
                  comment: review.comment,
                  reviewedAt: review.createdAt,
                },
        };
      },
    );
  }
}
function submissionReviewDecision(event: string): ReviewDecision {
  if (
    event === 'APPROVED' ||
    event === 'REJECTED' ||
    event === 'CHANGES_REQUESTED'
  )
    return event;
  throw new TypeError('Expected a submission review event');
}
export type MilestoneDocumentViewer = Prisma.UserGetPayload<{
  select: typeof USER_AUTHORITY_SELECT & {
    id: true;
    accountStatus: true;
  };
}> & {
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};
export interface MilestoneDocumentContext {
  readonly id: string;
  readonly milestoneId: string;
  readonly programId: string;
  readonly name: string;
  readonly dueAt: Date;
  readonly graceDueAt: Date | null;
  readonly required: boolean;
  readonly submissionType: RequirementSubmissionType;
}
export interface StudentApplicationContext {
  readonly teamId: string;
  readonly approved: boolean;
  readonly programEndAt: Date;
}
export interface MilestoneDocumentSubmissionSummary {
  readonly milestoneDocumentId: string;
  readonly submittedAt: Date;
  readonly revision: number;
  readonly status: SubmissionStatus;
  readonly hasCurrentFile: boolean;
  readonly currentFileName: string | null;
  readonly historyComplete: boolean;
  readonly review: MilestoneDocumentReviewRecord | null;
}
export interface MilestoneDocumentSubmissionCoordinate {
  readonly milestoneDocumentId: string;
  readonly teamId: string;
}
interface MilestoneDocumentCollectionHistoryRecord {
  readonly event: SubmissionHistoryEvent;
  readonly revision: number | null;
  readonly actorNickname: string;
  readonly comment: string | null;
  readonly createdAt: Date;
  readonly fileName: string | null;
  readonly downloadableFileId: string | null;
  readonly content: Prisma.JsonValue | null;
}
export interface MilestoneDocumentHistoryPage {
  readonly items: readonly (MilestoneDocumentCollectionHistoryRecord & {
    readonly id: string;
  })[];
  readonly nextCursor: string | null;
  readonly isComplete: boolean;
}
export interface MilestoneDocumentArchiveSubmissionRecord {
  readonly milestoneDocumentId: string;
  readonly teamId: string;
  readonly submittedAt: Date;
  readonly status: SubmissionStatus;
  readonly content: Prisma.JsonValue | null;
  readonly hasCurrentFileEvidence: boolean;
  readonly file: {
    readonly storageKey: string;
    readonly originalFileName: string;
    readonly sizeBytes: number;
  } | null;
}
interface CreateMilestoneDocumentReviewRecordInput {
  readonly milestoneDocumentSubmissionId: string;
  readonly submissionHistoryId: string;
  readonly revision: number;
  readonly reviewerId: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
}
export interface LatestMilestoneDocumentReview {
  readonly id: string;
  readonly decision: ReviewDecision;
}
export interface StaffDownloadableMilestoneDocumentFile {
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly teamName: string;
}
interface MilestoneDocumentTemplateInput {
  readonly milestoneDocumentId: string;
  readonly uploadedById: string;
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly uploadedAt: Date;
}
export interface DownloadableMilestoneDocumentTemplate {
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}
export interface UpdateMilestoneDocumentInput {
  readonly name: string;
  readonly required: boolean;
}
interface LockedMilestone {
  readonly id: string;
  readonly dueAt: Date;
}
interface LockedMilestoneDocument {
  readonly id: string;
  readonly milestoneId: string;
}
export interface MilestoneDocumentWriteStore {
  lockProgramForReview(programId: string): Promise<boolean>;
  lockMilestoneForGrace(milestoneId: string): Promise<
    | (LockedMilestone & {
        readonly programEndAt: Date;
      })
    | null
  >;
  updateGraceDueAt(documentId: string, graceDueAt: Date | null): Promise<void>;

  isApplicationParticipant(teamId: string, userId: string): Promise<boolean>;

  lockMilestone(milestoneId: string): Promise<LockedMilestone | null>;
  lockDocument(documentId: string): Promise<LockedMilestoneDocument | null>;
  upsertTemplateFile(input: MilestoneDocumentTemplateInput): Promise<void>;
  lockDocumentIdsOfMilestone(milestoneId: string): Promise<readonly string[]>;
  countSubmissionsForDocument(documentId: string): Promise<number>;
  createDocument(
    milestoneId: string,
    input: UpdateMilestoneDocumentInput,
  ): Promise<MilestoneDocumentRecord>;
  updateDocument(
    documentId: string,
    input: UpdateMilestoneDocumentInput,
  ): Promise<MilestoneDocumentRecord>;
  applyDocumentOrder(
    milestoneId: string,
    documentIds: readonly string[],
  ): Promise<MilestoneDocumentRecord[]>;
  deleteDocument(documentId: string): Promise<void>;
  findSubmissionForReview(
    milestoneDocumentId: string,
    teamId: string,
  ): Promise<{
    readonly id: string;
    readonly revision: number;
    readonly submissionHistoryId: string;
    readonly latestHistoryCreatedAt: Date | null;
  } | null>;
  findLatestReviewIdForSubmission(submissionId: string): Promise<string | null>;
  createReview(
    input: CreateMilestoneDocumentReviewRecordInput,
  ): Promise<CreatedMilestoneDocumentReview>;
  updateSubmissionStatus(
    submissionId: string,
    status: SubmissionStatus,
  ): Promise<void>;
  lockProgramDocumentIds(programId: string): Promise<readonly string[]>;
  lockApprovedApplicationIds(
    programId: string,
    teamId: string | undefined,
  ): Promise<readonly string[]>;
  findChangeRequestCandidates(input: {
    readonly documentIds: readonly string[];
    readonly teamIds: readonly string[];
  }): Promise<readonly ProgramDocumentChangeRequestCandidate[]>;
}
export interface MilestoneDocumentCollectionReadStore {
  findMilestone(milestoneId: string): Promise<MilestoneContext | null>;
  findByMilestoneId(
    milestoneId: string,
  ): Promise<readonly MilestoneDocumentRecord[]>;
  findApprovedApplicationsForCollection(
    programId: string,
  ): Promise<readonly MilestoneDocumentCollectionApplication[]>;
  findSubmissionCoordinatesForCollection(
    documentIds: readonly string[],
  ): Promise<readonly MilestoneDocumentSubmissionCoordinate[]>;
  findSubmissionsForCollection(
    documentIds: readonly string[],
    now: Date,
    teamIds: readonly string[],
  ): Promise<readonly MilestoneDocumentCollectionSubmission[]>;
}
const attachedFileSelect = {
  id: true,
  originalFileName: true,
  mimeType: true,
  sizeBytes: true,
} satisfies Prisma.FileSelect;
const documentRecordSelect = {
  id: true,
  milestoneId: true,
  name: true,
  required: true,
  submissionType: true,
  sortOrder: true,
  graceDueAt: true,
  files: {
    where: { kind: 'TEMPLATE', lifecycle: 'ATTACHED' },
    take: 1,
    select: { id: true, originalFileName: true },
  },
} satisfies Prisma.RequirementSelect;
function toDocumentRecord(row: {
  id: string;
  milestoneId: string;
  name: string;
  required: boolean;
  submissionType: RequirementSubmissionType;
  sortOrder: number;
  graceDueAt: Date | null;
  files: { id: string; originalFileName: string | null }[];
}): MilestoneDocumentRecord {
  return {
    id: row.id,
    milestoneId: row.milestoneId,
    name: row.name,
    required: row.required,
    submissionType: row.submissionType,
    sortOrder: row.sortOrder,
    graceDueAt: row.graceDueAt,
    templateFileId: row.files[0]?.id ?? null,
    templateFileName: row.files[0]?.originalFileName ?? null,
  };
}
const collectionApplicationSelect = {
  id: true,
  applicant: { select: USER_PROFILE_NAME_SELECT },
  name: true,
  members: {
    orderBy: { createdAt: 'asc' },
    select: { user: { select: { nickname: true } } },
  },
} satisfies Prisma.TeamSelect;
function unexpiredAttachedFileWhere(now: Date) {
  return {
    lifecycle: FileLifecycle.ATTACHED,
    expiresAt: { gt: now },
  } as const;
}
function isDownloadableSubmissionFile(
  file: {
    readonly lifecycle: FileLifecycle;
    readonly expiresAt: Date | null;
  } | null,
  now: Date,
): boolean {
  return (
    file !== null &&
    file.lifecycle === FileLifecycle.ATTACHED &&
    file.expiresAt !== null &&
    file.expiresAt.getTime() > now.getTime()
  );
}
const currentRevisionFileOrderBy: Prisma.FileOrderByWithRelationInput[] = [
  {
    submissionHistory: {
      revision: { sort: 'desc', nulls: 'last' },
    },
  },
  { createdAt: 'desc' },
];
function countSubmissionsForDocumentWith(
  client: Prisma.TransactionClient,
  documentId: string,
): Promise<number> {
  return client.submission.count({
    where: { requirementId: documentId },
  });
}
type MilestoneDocumentWriteScope = {
  readonly transaction: Prisma.TransactionClient;
  milestoneLock: MilestoneLock | null;
};
@Injectable()
export class RequirementsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: LockProgramTreeRepository,
    private readonly platformRepository: PlatformRepository,
    private readonly milestoneDocumentSubmissionRepository: SubmissionsRepository,
    private readonly milestoneDocumentCollectionReadRepository: MilestoneDocumentCollectionReadRepository,
    private readonly fileMetadata: FileMetadataRepository,
  ) {}
  withTransaction<T>(
    operation: (store: MilestoneDocumentWriteStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(this.milestoneDocumentWriteStore(transaction)),
    );
  }
  findChangeRequestCandidates(
    programId: string,
    teamIds: readonly string[],
  ): Promise<readonly ProgramDocumentChangeRequestCandidate[]> {
    if (teamIds.length === 0) return Promise.resolve([]);
    return this.prisma.submission
      .findMany({
        where: {
          teamId: { in: [...teamIds] },
          requirement: {
            milestone: { programId },
          },
        },
        orderBy: { id: 'asc' },
        select: { requirementId: true, teamId: true, status: true },
      })
      .then((rows) =>
        rows.map(({ requirementId, teamId, status }) => ({
          milestoneDocumentId: requirementId,
          teamId,
          status,
        })),
      );
  }
  withCollectionSnapshot<T>(
    operation: (store: MilestoneDocumentCollectionReadStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      (transaction) =>
        operation(this.milestoneDocumentCollectionReadStore(transaction)),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async findByMilestoneId(
    milestoneId: string,
  ): Promise<MilestoneDocumentRecord[]> {
    const documents = await this.prisma.requirement.findMany({
      where: {
        milestoneId,
      },
      orderBy: { sortOrder: 'asc' },
      select: documentRecordSelect,
    });
    return documents.map(toDocumentRecord);
  }
  async findActiveUser(
    githubId: bigint,
  ): Promise<MilestoneDocumentViewer | null> {
    const user = await this.prisma.user.findFirst({
      where: { githubId, accountStatus: AccountStatus.ACTIVE },
      select: { id: true, accountStatus: true, ...USER_AUTHORITY_SELECT },
    });
    return user === null
      ? null
      : {
          ...user,
          hasStaffAccess:
            user.type === 'STAFF' && user.approvalStatus === 'APPROVED',
          hasAdminAccess: user.admin !== null,
        };
  }
  async findActiveStudentByGithubId(githubId: bigint): Promise<{
    readonly id: string;
  } | null> {
    return this.prisma.user.findFirst({
      where: {
        githubId,
        accountStatus: AccountStatus.ACTIVE,
        ...STUDENT_MEMBER_WHERE,
      },
      select: { id: true },
    });
  }
  async findMilestone(milestoneId: string): Promise<MilestoneContext | null> {
    return this.prisma.milestone.findUnique({
      where: { id: milestoneId },
      select: { id: true, programId: true, name: true, dueAt: true },
    });
  }
  async findDocumentContext(
    documentId: string,
  ): Promise<MilestoneDocumentContext | null> {
    const document = await this.prisma.requirement.findFirst({
      where: { id: documentId },
      select: {
        id: true,
        milestoneId: true,
        name: true,
        required: true,
        submissionType: true,
        graceDueAt: true,
        milestone: { select: { programId: true, dueAt: true } },
      },
    });
    if (document === null) return null;
    return {
      id: document.id,
      milestoneId: document.milestoneId,
      programId: document.milestone.programId,
      name: document.name,
      dueAt: document.milestone.dueAt,
      graceDueAt: document.graceDueAt,
      required: document.required,
      submissionType: document.submissionType,
    };
  }
  async findStudentApplication(
    userId: string,
    programId: string,
  ): Promise<StudentApplicationContext | null> {
    const application = await this.prisma.team.findFirst({
      where: {
        programId,
        ...this.platformRepository.programApplicationParticipantWhere(userId),
      },
      select: {
        id: true,
        status: true,
        program: { select: { endAt: true } },
      },
    });
    if (application === null) return null;
    return {
      teamId: application.id,
      approved: application.status === ApplicationStatus.APPROVED,
      programEndAt: application.program.endAt,
    };
  }
  async findSubmittedSummaries(
    teamId: string,
    documentIds: readonly string[],
    now: Date = new Date(),
  ): Promise<readonly MilestoneDocumentSubmissionSummary[]> {
    if (documentIds.length === 0) return [];
    const submissions = await this.prisma.submission.findMany({
      where: {
        teamId,
        requirementId: { in: [...documentIds] },
      },
      select: {
        requirementId: true,
        submittedAt: true,
        revision: true,
        status: true,
        _count: {
          select: {
            histories: {
              where: {
                event: {
                  in: [
                    SubmissionHistoryEvent.SUBMITTED,
                    SubmissionHistoryEvent.RESUBMITTED,
                  ],
                },
              },
            },
          },
        },
        files: {
          where: unexpiredAttachedFileWhere(now),
          orderBy: currentRevisionFileOrderBy,
          take: 1,
          select: {
            originalFileName: true,
            submissionHistory: { select: { revision: true } },
          },
        },
        histories: {
          ...this.milestoneDocumentCollectionReadRepository
            .boundedReviewHistoryQuery,
          take: 1,
        },
      },
    });
    return submissions.map((submission) => {
      const review = submission.histories[0] ?? null;
      const currentFile =
        submission.files[0]?.submissionHistory?.revision === submission.revision
          ? (submission.files[0] ?? null)
          : null;
      return {
        milestoneDocumentId: submission.requirementId,
        submittedAt: submission.submittedAt,
        revision: submission.revision,
        status: submission.status,
        hasCurrentFile: currentFile !== null,
        currentFileName: currentFile?.originalFileName ?? null,
        historyComplete: submission._count.histories === submission.revision,
        review:
          review === null
            ? null
            : {
                id: review.id,
                decision: submissionReviewDecision(review.event),
                comment: review.comment,
                reviewedAt: review.createdAt,
              },
      };
    });
  }
  async findLatestReview(
    milestoneDocumentId: string,
    teamId: string,
  ): Promise<LatestMilestoneDocumentReview | null> {
    const review = await this.prisma.submissionHistory.findFirst({
      where: {
        submission: { requirementId: milestoneDocumentId, teamId },
        event: { in: SUBMISSION_REVIEW_EVENTS },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, event: true },
    });
    return review === null
      ? null
      : {
          id: review.id,
          decision: submissionReviewDecision(review.event),
        };
  }
  async findSubmissionHistoryPage(
    milestoneDocumentId: string,
    teamId: string,
    cursor: string | null,
    limit: number,
    now: Date = new Date(),
  ): Promise<MilestoneDocumentHistoryPage | null> {
    const submission = await this.prisma.submission.findUnique({
      where: {
        requirementId_teamId: {
          requirementId: milestoneDocumentId,
          teamId,
        },
      },
      select: {
        id: true,
        revision: true,
        _count: {
          select: {
            histories: {
              where: {
                event: {
                  in: [
                    SubmissionHistoryEvent.SUBMITTED,
                    SubmissionHistoryEvent.RESUBMITTED,
                  ],
                },
              },
            },
          },
        },
      },
    });
    if (submission === null) return null;
    if (cursor !== null) {
      const scopedCursor = await this.prisma.submissionHistory.findFirst({
        where: {
          id: cursor,
          submissionId: submission.id,
        },
        select: { id: true },
      });
      if (scopedCursor === null) {
        throw new InvalidMilestoneDocumentHistoryCursorError();
      }
    }
    const rows = await this.prisma.submissionHistory.findMany({
      where: { submissionId: submission.id },
      orderBy:
        this.milestoneDocumentCollectionReadRepository
          .milestoneDocumentHistoryDescendingOrderBy,
      take: limit + 1,
      ...(cursor === null ? {} : { cursor: { id: cursor }, skip: 1 }),
      select: {
        id: true,
        event: true,
        revision: true,
        comment: true,
        content: true,
        createdAt: true,
        actor: { select: { nickname: true } },
        files: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            originalFileName: true,
            lifecycle: true,
            expiresAt: true,
          },
        },
      },
    });
    const hasMore = rows.length > limit;
    const visible = rows.slice(0, limit);
    const nextCursor = hasMore ? (visible.at(-1)?.id ?? null) : null;
    return {
      items: visible.toReversed().map((row) => {
        const file = row.files[0] ?? null;
        return {
          id: row.id,
          event: row.event,
          revision: row.revision,
          actorNickname: row.actor.nickname,
          comment: row.comment,
          createdAt: row.createdAt,
          fileName: file?.originalFileName ?? null,
          downloadableFileId: isDownloadableSubmissionFile(file, now)
            ? (file?.id ?? null)
            : null,
          content: row.content,
        };
      }),
      nextCursor,
      isComplete: submission._count.histories === submission.revision,
    };
  }
  async countApprovedApplications(programId: string): Promise<number> {
    return this.prisma.team.count({
      where: { programId, status: ApplicationStatus.APPROVED },
    });
  }
  async countSubmissionsByDocument(
    programId: string,
    documentIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>> {
    if (documentIds.length === 0) return new Map();
    const grouped = await this.prisma.submission.groupBy({
      by: ['requirementId'],
      where: {
        requirementId: { in: [...documentIds] },
        team: { programId, status: ApplicationStatus.APPROVED },
      },
      _count: { _all: true },
    });
    return new Map(grouped.map((row) => [row.requirementId, row._count._all]));
  }
  async findApprovedApplicationsForCollection(
    programId: string,
  ): Promise<readonly MilestoneDocumentCollectionApplication[]> {
    const applications = await this.prisma.team.findMany({
      where: { programId, status: ApplicationStatus.APPROVED },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: collectionApplicationSelect,
    });
    return applications.map((application) => ({
      teamId: application.id,
      teamName: application.name,
      applicantName: application.applicant.name ?? null,
      memberNicknames: application.members.map(
        (member) => member.user.nickname,
      ),
    }));
  }
  async findSubmissionCoordinatesForCollection(
    documentIds: readonly string[],
  ): Promise<readonly MilestoneDocumentSubmissionCoordinate[]> {
    if (documentIds.length === 0) return [];
    const rows = await this.prisma.submission.findMany({
      where: { requirementId: { in: [...documentIds] } },
      select: { requirementId: true, teamId: true },
    });
    return rows.map(({ requirementId, teamId }) => ({
      milestoneDocumentId: requirementId,
      teamId,
    }));
  }
  async findSubmissionsForCollection(
    documentIds: readonly string[],
    now: Date,
    teamIds?: readonly string[],
  ): Promise<readonly MilestoneDocumentCollectionSubmission[]> {
    if (documentIds.length === 0 || teamIds?.length === 0) return [];
    const submissions = await this.prisma.submission.findMany({
      where: {
        requirementId: { in: [...documentIds] },
        ...(teamIds === undefined ? {} : { teamId: { in: [...teamIds] } }),
      },
      select: {
        requirementId: true,
        teamId: true,
        submittedAt: true,
        revision: true,
        status: true,
        content: true,
        files: {
          where: unexpiredAttachedFileWhere(now),
          orderBy: currentRevisionFileOrderBy,
          take: 1,
          select: {
            originalFileName: true,
            mimeType: true,
            sizeBytes: true,
            submissionHistory: { select: { revision: true } },
          },
        },
        histories: {
          ...this.milestoneDocumentCollectionReadRepository
            .boundedReviewHistoryQuery,
          take: 1,
        },
      },
    });
    return submissions.map((submission) => {
      const review = submission.histories[0] ?? null;
      const selectedFile =
        submission.files[0] === undefined
          ? undefined
          : this.fileMetadata.read(submission.files[0]);
      const file =
        selectedFile !== undefined &&
        selectedFile.submissionHistory !== null &&
        selectedFile.submissionHistory.revision === submission.revision
          ? {
              originalFileName: selectedFile.originalFileName,
              sizeBytes: selectedFile.sizeBytes,
            }
          : null;
      return {
        milestoneDocumentId: submission.requirementId,
        teamId: submission.teamId,
        submittedAt: submission.submittedAt,
        revision: submission.revision,
        status: submission.status,
        content: submission.content,
        file,
        review:
          review === null
            ? null
            : {
                id: review.id,
                decision: submissionReviewDecision(review.event),
                comment: review.comment,
                reviewedAt: review.createdAt,
              },
      };
    });
  }
  async findSubmissionsForArchive(
    documentIds: readonly string[],
    now: Date,
  ): Promise<readonly MilestoneDocumentArchiveSubmissionRecord[]> {
    if (documentIds.length === 0) return [];
    const submissions = await this.prisma.submission.findMany({
      where: { requirementId: { in: [...documentIds] } },
      select: {
        requirementId: true,
        teamId: true,
        submittedAt: true,
        revision: true,
        status: true,
        content: true,
        files: {
          orderBy: currentRevisionFileOrderBy,
          take: 1,
          select: {
            storageKey: true,
            originalFileName: true,
            mimeType: true,
            sizeBytes: true,
            lifecycle: true,
            expiresAt: true,
            submissionHistory: { select: { revision: true } },
          },
        },
      },
    });
    return submissions.map((submission) => {
      const selectedFile =
        submission.files[0] === undefined
          ? undefined
          : this.fileMetadata.read(submission.files[0]);
      const hasCurrentFileEvidence =
        selectedFile !== undefined &&
        selectedFile.submissionHistory?.revision === submission.revision;
      const file =
        selectedFile !== undefined &&
        hasCurrentFileEvidence &&
        selectedFile.lifecycle === FileLifecycle.ATTACHED &&
        selectedFile.expiresAt !== null &&
        selectedFile.expiresAt > now
          ? {
              storageKey: selectedFile.storageKey,
              originalFileName: selectedFile.originalFileName,
              sizeBytes: selectedFile.sizeBytes,
            }
          : null;
      return {
        milestoneDocumentId: submission.requirementId,
        teamId: submission.teamId,
        submittedAt: submission.submittedAt,
        status: submission.status,
        content: submission.content,
        hasCurrentFileEvidence,
        file,
      };
    });
  }

  async findApplicationProgramId(teamId: string): Promise<string | null> {
    const application = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { programId: true },
    });
    return application?.programId ?? null;
  }
  async findSubmissionFileForStaffDownload(
    milestoneDocumentId: string,
    teamId: string,
    now: Date,
  ): Promise<StaffDownloadableMilestoneDocumentFile | null> {
    const submission = await this.prisma.submission.findUnique({
      where: {
        requirementId_teamId: {
          requirementId: milestoneDocumentId,
          teamId,
        },
      },
      select: {
        team: { select: { name: true } },
        revision: true,
        files: {
          where: unexpiredAttachedFileWhere(now),
          orderBy: currentRevisionFileOrderBy,
          take: 1,
          select: {
            storageKey: true,
            originalFileName: true,
            mimeType: true,
            sizeBytes: true,
            submissionHistory: { select: { revision: true } },
          },
        },
      },
    });
    const rawFile = submission?.files[0];
    const file =
      rawFile === undefined ? undefined : this.fileMetadata.read(rawFile);
    if (
      submission == null ||
      file == null ||
      file.submissionHistory?.revision !== submission.revision
    ) {
      return null;
    }
    return {
      storageKey: file.storageKey,
      originalFileName: file.originalFileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      teamName: submission.team.name,
    };
  }
  async findTemplateForDownload(
    documentId: string,
  ): Promise<DownloadableMilestoneDocumentTemplate | null> {
    const file = await this.prisma.file.findFirst({
      where: {
        requirementId: documentId,
        kind: 'TEMPLATE',
        lifecycle: 'ATTACHED',
        requirement: {
          milestone: { program: { lifecycle: { not: 'DELETED' } } },
        },
      },
      select: {
        storageKey: true,
        originalFileName: true,
        mimeType: true,
        sizeBytes: true,
      },
    });
    return file === null ? null : this.fileMetadata.read(file);
  }
  async upsertSubmission(
    input: UpsertMilestoneDocumentSubmissionInput,
  ): Promise<MilestoneDocumentSubmissionDetail> {
    return this.milestoneDocumentSubmissionRepository.upsertMilestoneDocumentSubmission(
      this.prisma,
      input,
    );
  }
  async findMySubmission(
    milestoneDocumentId: string,
    teamId: string,
  ): Promise<MilestoneDocumentSubmissionDetail | null> {
    const submission = await this.prisma.submission.findUnique({
      where: {
        requirementId_teamId: {
          requirementId: milestoneDocumentId,
          teamId,
        },
      },
      select: {
        id: true,
        status: true,
        content: true,
        submittedAt: true,
        revision: true,
        files: {
          where: { lifecycle: FileLifecycle.ATTACHED },
          orderBy: currentRevisionFileOrderBy,
          take: 1,
          select: {
            ...attachedFileSelect,
            submissionHistory: { select: { revision: true } },
          },
        },
      },
    });
    if (submission === null) return null;
    const rawFile = submission.files[0];
    const file =
      rawFile === undefined ? undefined : this.fileMetadata.read(rawFile);
    return {
      id: submission.id,
      status: submission.status,
      content: submission.content,
      submittedAt: submission.submittedAt,
      files:
        file?.submissionHistory?.revision === submission.revision
          ? [
              {
                id: file.id,
                originalFileName: file.originalFileName,
                mimeType: file.mimeType,
                sizeBytes: file.sizeBytes,
              },
            ]
          : [],
    };
  }
  private milestoneDocumentWriteStore(
    transaction: Prisma.TransactionClient,
  ): MilestoneDocumentWriteStore {
    const scope: MilestoneDocumentWriteScope = {
      transaction,
      milestoneLock: null,
    };
    return {
      lockProgramForReview: this.lockProgramForReviewIn.bind(this, scope),
      isApplicationParticipant: this.isApplicationParticipantIn.bind(
        this,
        scope,
      ),
      lockMilestone: this.lockMilestoneIn.bind(this, scope),
      lockMilestoneForGrace: this.lockMilestoneForGraceIn.bind(this, scope),
      lockDocument: this.lockDocumentIn.bind(this, scope),
      updateGraceDueAt: this.updateGraceDueAtIn.bind(this, scope),
      upsertTemplateFile: this.upsertTemplateFileIn.bind(this, scope),
      lockDocumentIdsOfMilestone: this.lockDocumentIdsOfMilestoneIn.bind(
        this,
        scope,
      ),
      countSubmissionsForDocument: this.countSubmissionsForDocumentIn.bind(
        this,
        scope,
      ),
      createDocument: this.createDocumentIn.bind(this, scope),
      updateDocument: this.updateDocumentIn.bind(this, scope),
      applyDocumentOrder: this.applyDocumentOrderIn.bind(this, scope),
      deleteDocument: this.deleteDocumentIn.bind(this, scope),
      findSubmissionForReview: this.findSubmissionForReviewIn.bind(this, scope),
      findLatestReviewIdForSubmission:
        this.findLatestReviewIdForSubmissionIn.bind(this, scope),
      createReview: this.createReviewIn.bind(this, scope),
      updateSubmissionStatus: this.updateSubmissionStatusIn.bind(this, scope),
      lockProgramDocumentIds: this.lockProgramDocumentIdsIn.bind(this, scope),
      lockApprovedApplicationIds: this.lockApprovedApplicationIdsIn.bind(
        this,
        scope,
      ),
      findChangeRequestCandidates: this.findChangeRequestCandidatesIn.bind(
        this,
        scope,
      ),
    };
  }
  private async lockProgramForReviewIn(
    scope: MilestoneDocumentWriteScope,
    programId: string,
  ): Promise<boolean> {
    const rows = await scope.transaction.$queryRaw<
      readonly {
        id: string;
      }[]
    >(Prisma.sql`
      SELECT "id" FROM "Program"
      WHERE "id" = ${programId} AND "lifecycle" <> 'DELETED'
      FOR SHARE
    `);
    return rows.length === 1;
  }
  private async isApplicationParticipantIn(
    scope: MilestoneDocumentWriteScope,
    teamId: string,
    userId: string,
  ): Promise<boolean> {
    const application = await scope.transaction.team.findFirst({
      where: {
        id: teamId,
        ...this.platformRepository.programApplicationParticipantWhere(userId),
      },
      select: { id: true },
    });
    return application !== null;
  }
  private async lockMilestoneIn(
    scope: MilestoneDocumentWriteScope,
    milestoneId: string,
  ): Promise<LockedMilestone | null> {
    scope.milestoneLock = await this.locks.lockProgramTree(scope.transaction, {
      stage: 'milestone',
      milestoneId,
    });
    if (scope.milestoneLock === null) return null;
    return scope.transaction.milestone.findUniqueOrThrow({
      where: { id: scope.milestoneLock.id },
      select: { id: true, dueAt: true },
    });
  }
  private async lockMilestoneForGraceIn(
    scope: MilestoneDocumentWriteScope,
    milestoneId: string,
  ) {
    const initial = await scope.transaction.milestone.findUnique({
      where: { id: milestoneId },
      select: { programId: true },
    });
    if (initial === null) return null;
    const program = await this.locks.lockProgramTree(scope.transaction, {
      stage: 'program',
      programId: initial.programId,
    });
    if (program === null) return null;
    scope.milestoneLock = await this.locks.lockProgramTree(scope.transaction, {
      stage: 'milestone',
      milestoneId,
      after: program,
    });
    if (scope.milestoneLock === null) return null;
    const milestone = await scope.transaction.milestone.findUniqueOrThrow({
      where: { id: milestoneId },
      select: { id: true, dueAt: true, program: { select: { endAt: true } } },
    });
    return {
      id: milestone.id,
      dueAt: milestone.dueAt,
      programEndAt: milestone.program.endAt,
    };
  }
  private async lockDocumentIn(
    scope: MilestoneDocumentWriteScope,
    documentId: string,
  ): Promise<LockedMilestoneDocument | null> {
    const rows = await scope.transaction.$queryRaw<
      readonly LockedMilestoneDocument[]
    >(Prisma.sql`
      SELECT "id", "milestoneId"
      FROM "Requirement"
      WHERE "id" = ${documentId}
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }
  private async updateGraceDueAtIn(
    scope: MilestoneDocumentWriteScope,
    documentId: string,
    graceDueAt: Date | null,
  ): Promise<void> {
    await scope.transaction.requirement.update({
      where: { id: documentId },
      data: { graceDueAt },
      select: { id: true },
    });
  }
  private async upsertTemplateFileIn(
    scope: MilestoneDocumentWriteScope,
    input: MilestoneDocumentTemplateInput,
  ): Promise<void> {
    await scope.transaction.file.updateMany({
      where: {
        requirementId: input.milestoneDocumentId,
        kind: 'TEMPLATE',
        lifecycle: 'ATTACHED',
      },
      data: {
        lifecycle: 'DELETE_PENDING',
        nextDeleteAttemptAt: input.uploadedAt,
      },
    });
    await scope.transaction.file.create({
      data: {
        kind: 'TEMPLATE',
        lifecycle: 'ATTACHED',
        requirementId: input.milestoneDocumentId,
        storageKey: input.storageKey,
        originalFileName: input.originalFileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        uploaderId: input.uploadedById,
        createdAt: input.uploadedAt,
        attachedAt: input.uploadedAt,
      },
    });
  }

  private async lockDocumentIdsOfMilestoneIn(
    scope: MilestoneDocumentWriteScope,
    milestoneId: string,
  ): Promise<readonly string[]> {
    if (
      scope.milestoneLock === null ||
      scope.milestoneLock.id !== milestoneId
    ) {
      throw new Error('Milestone must be locked before its documents.');
    }
    const result = await this.locks.lockProgramTree(scope.transaction, {
      stage: 'documents',
      after: scope.milestoneLock,
      documentKind: 'DOCUMENT',
    });
    return result.documentIds;
  }
  private countSubmissionsForDocumentIn(
    scope: MilestoneDocumentWriteScope,
    documentId: string,
  ): Promise<number> {
    return countSubmissionsForDocumentWith(scope.transaction, documentId);
  }
  private async createDocumentIn(
    scope: MilestoneDocumentWriteScope,
    milestoneId: string,
    input: UpdateMilestoneDocumentInput,
  ): Promise<MilestoneDocumentRecord> {
    const last = await scope.transaction.requirement.aggregate({
      where: { milestoneId },
      _max: { sortOrder: true },
    });
    const sortOrder = (last._max.sortOrder ?? 0) + 1;
    const created = await scope.transaction.requirement.create({
      data: {
        milestoneId,
        ...input,
        sortOrder,
      },
      select: {
        id: true,
        milestoneId: true,
        name: true,
        required: true,
        sortOrder: true,
        graceDueAt: true,
        submissionType: true,
      },
    });
    return {
      ...created,
      templateFileId: null,
      templateFileName: null,
    };
  }
  private async updateDocumentIn(
    scope: MilestoneDocumentWriteScope,
    documentId: string,
    input: UpdateMilestoneDocumentInput,
  ): Promise<MilestoneDocumentRecord> {
    const updated = await scope.transaction.requirement.update({
      where: { id: documentId },
      data: input,
      select: documentRecordSelect,
    });
    return toDocumentRecord(updated);
  }
  private async applyDocumentOrderIn(
    scope: MilestoneDocumentWriteScope,
    milestoneId: string,
    documentIds: readonly string[],
  ): Promise<MilestoneDocumentRecord[]> {
    for (const [index, documentId] of documentIds.entries()) {
      await scope.transaction.requirement.update({
        where: {
          id: documentId,
          milestoneId,
        },
        data: { sortOrder: index + 1 },
        select: { id: true },
      });
    }
    const documents = await scope.transaction.requirement.findMany({
      where: { milestoneId },
      orderBy: { sortOrder: 'asc' },
      select: documentRecordSelect,
    });
    return documents.map(toDocumentRecord);
  }
  private async deleteDocumentIn(
    scope: MilestoneDocumentWriteScope,
    documentId: string,
  ): Promise<void> {
    await scope.transaction.file.updateMany({
      where: { requirementId: documentId, lifecycle: { not: 'DELETED' } },
      data: { lifecycle: 'DELETE_PENDING', nextDeleteAttemptAt: new Date() },
    });
    await scope.transaction.file.updateMany({
      where: { requirementId: documentId },
      data: { requirementId: null },
    });
    await scope.transaction.requirement.delete({
      where: { id: documentId },
    });
  }
  private findSubmissionForReviewIn(
    scope: MilestoneDocumentWriteScope,
    milestoneDocumentId: string,
    teamId: string,
  ): Promise<{
    readonly id: string;
    readonly revision: number;
    readonly submissionHistoryId: string;
    readonly latestHistoryCreatedAt: Date | null;
  } | null> {
    return this.findSubmissionForReviewWithHistoryIn(
      scope,
      milestoneDocumentId,
      teamId,
    );
  }
  private async findSubmissionForReviewWithHistoryIn(
    scope: MilestoneDocumentWriteScope,
    milestoneDocumentId: string,
    teamId: string,
  ): Promise<{
    readonly id: string;
    readonly revision: number;
    readonly submissionHistoryId: string;
    readonly latestHistoryCreatedAt: Date | null;
  } | null> {
    await scope.transaction.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "Submission"
      WHERE "requirementId" = ${milestoneDocumentId}
        AND "teamId" = ${teamId}
      FOR UPDATE
    `);
    const submission = await scope.transaction.submission.findUnique({
      where: {
        requirementId_teamId: {
          requirementId: milestoneDocumentId,
          teamId,
        },
      },
      select: {
        id: true,
        revision: true,
        histories: {
          where: {
            event: {
              in: [
                SubmissionHistoryEvent.SUBMITTED,
                SubmissionHistoryEvent.RESUBMITTED,
              ],
            },
          },
          orderBy: [{ revision: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          select: { id: true, revision: true },
        },
      },
    });
    const history = submission?.histories[0];
    if (
      submission === null ||
      history === undefined ||
      history.revision !== submission.revision
    ) {
      return null;
    }
    const latestHistory = await scope.transaction.submissionHistory.findFirst({
      where: { submissionId: submission.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { createdAt: true },
    });
    return {
      id: submission.id,
      revision: submission.revision,
      submissionHistoryId: history.id,
      latestHistoryCreatedAt: latestHistory?.createdAt ?? null,
    };
  }
  private async findLatestReviewIdForSubmissionIn(
    scope: MilestoneDocumentWriteScope,
    submissionId: string,
  ): Promise<string | null> {
    const review = await scope.transaction.submissionHistory.findFirst({
      where: {
        submissionId: submissionId,
        event: { in: SUBMISSION_REVIEW_EVENTS },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    return review?.id ?? null;
  }
  private async createReviewIn(
    scope: MilestoneDocumentWriteScope,
    input: CreateMilestoneDocumentReviewRecordInput,
  ): Promise<CreatedMilestoneDocumentReview> {
    const created = await this.platformRepository.appendSubmissionReviewEvent(
      scope.transaction,
      input,
    );
    return {
      id: created.id,
      decision: submissionReviewDecision(created.event),
      comment: created.comment,
      reviewedAt: created.createdAt,
      reviewerNickname: created.actor.nickname,
    };
  }
  private async updateSubmissionStatusIn(
    scope: MilestoneDocumentWriteScope,
    submissionId: string,
    status: SubmissionStatus,
  ): Promise<void> {
    await scope.transaction.submission.update({
      where: { id: submissionId },
      data: { status },
      select: { id: true },
    });
  }
  private async lockProgramDocumentIdsIn(
    scope: MilestoneDocumentWriteScope,
    programId: string,
  ): Promise<readonly string[]> {
    const rows = await scope.transaction.$queryRaw<
      readonly {
        id: string;
      }[]
    >(Prisma.sql`
        SELECT document."id"
        FROM "Requirement" document
        JOIN "Milestone" milestone ON milestone."id" = document."milestoneId"
        WHERE milestone."programId" = ${programId}
        ORDER BY document."id"
        FOR UPDATE OF document
      `);
    return rows.map((row) => row.id);
  }
  private async lockApprovedApplicationIdsIn(
    scope: MilestoneDocumentWriteScope,
    programId: string,
    teamId: string | undefined,
  ): Promise<readonly string[]> {
    const rows = await scope.transaction.$queryRaw<
      readonly {
        id: string;
        status: ApplicationStatus;
      }[]
    >(Prisma.sql`
        SELECT "id", "status"
        FROM "Team"
        WHERE "programId" = ${programId}
        ORDER BY "id"
        FOR SHARE
      `);
    return rows
      .filter(
        (row) =>
          row.status === ApplicationStatus.APPROVED &&
          (teamId === undefined || row.id === teamId),
      )
      .map((row) => row.id);
  }
  private findChangeRequestCandidatesIn(
    scope: MilestoneDocumentWriteScope,
    input: {
      readonly documentIds: readonly string[];
      readonly teamIds: readonly string[];
    },
  ): Promise<readonly ProgramDocumentChangeRequestCandidate[]> {
    if (input.documentIds.length === 0 || input.teamIds.length === 0) {
      return Promise.resolve([]);
    }
    return scope.transaction.submission
      .findMany({
        where: {
          requirementId: { in: [...input.documentIds] },
          teamId: { in: [...input.teamIds] },
        },
        orderBy: { id: 'asc' },
        select: { requirementId: true, teamId: true, status: true },
      })
      .then((rows) =>
        rows.map(({ requirementId, teamId, status }) => ({
          milestoneDocumentId: requirementId,
          teamId,
          status,
        })),
      );
  }
  private milestoneDocumentCollectionReadStore(
    transaction: Prisma.TransactionClient,
  ): MilestoneDocumentCollectionReadStore {
    return {
      findMilestone: this.findMilestoneIn.bind(this, transaction),
      findByMilestoneId: this.findByMilestoneIdIn.bind(this, transaction),
      findApprovedApplicationsForCollection:
        this.findApprovedApplicationsForCollectionIn.bind(this, transaction),
      findSubmissionCoordinatesForCollection:
        this.findSubmissionCoordinatesForCollectionIn.bind(this, transaction),
      findSubmissionsForCollection: this.findSubmissionsForCollectionIn.bind(
        this,
        transaction,
      ),
    };
  }
  private async findMilestoneIn(
    transaction: Prisma.TransactionClient,
    milestoneId: string,
  ): Promise<MilestoneContext | null> {
    return transaction.milestone.findUnique({
      where: { id: milestoneId },
      select: { id: true, programId: true, name: true, dueAt: true },
    });
  }
  private async findByMilestoneIdIn(
    transaction: Prisma.TransactionClient,
    milestoneId: string,
  ): Promise<readonly MilestoneDocumentRecord[]> {
    const documents = await transaction.requirement.findMany({
      where: { milestoneId },
      orderBy: { sortOrder: 'asc' },
      select: documentRecordSelect,
    });
    return documents.map(toDocumentRecord);
  }
  private async findApprovedApplicationsForCollectionIn(
    transaction: Prisma.TransactionClient,
    programId: string,
  ): Promise<readonly MilestoneDocumentCollectionApplication[]> {
    const applications = await transaction.team.findMany({
      where: { programId, status: ApplicationStatus.APPROVED },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: collectionApplicationSelect,
    });
    return applications.map((application) => ({
      teamId: application.id,
      teamName: application.name,
      applicantName: application.applicant.name ?? null,
      memberNicknames: application.members.map(
        (member) => member.user.nickname,
      ),
    }));
  }
  private async findSubmissionCoordinatesForCollectionIn(
    transaction: Prisma.TransactionClient,
    documentIds: readonly string[],
  ): Promise<readonly MilestoneDocumentSubmissionCoordinate[]> {
    if (documentIds.length === 0) return [];
    const rows = await transaction.submission.findMany({
      where: { requirementId: { in: [...documentIds] } },
      select: { requirementId: true, teamId: true },
    });
    return rows.map(({ requirementId, teamId }) => ({
      milestoneDocumentId: requirementId,
      teamId,
    }));
  }
  private async findSubmissionsForCollectionIn(
    transaction: Prisma.TransactionClient,
    documentIds: readonly string[],
    now: Date,
    teamIds: readonly string[],
  ): Promise<readonly MilestoneDocumentCollectionSubmission[]> {
    if (documentIds.length === 0 || teamIds.length === 0) return [];
    const submissions = await transaction.submission.findMany({
      where: {
        requirementId: { in: [...documentIds] },
        teamId: { in: [...teamIds] },
      },
      select: {
        requirementId: true,
        teamId: true,
        submittedAt: true,
        revision: true,
        status: true,
        content: true,
        files: {
          where: unexpiredAttachedFileWhere(now),
          orderBy: currentRevisionFileOrderBy,
          take: 1,
          select: {
            originalFileName: true,
            mimeType: true,
            sizeBytes: true,
            submissionHistory: { select: { revision: true } },
          },
        },
        histories: {
          ...this.milestoneDocumentCollectionReadRepository
            .boundedReviewHistoryQuery,
          take: 1,
        },
      },
    });
    return submissions.map((submission) => {
      const review = submission.histories[0] ?? null;
      const selectedFile =
        submission.files[0] === undefined
          ? undefined
          : this.fileMetadata.read(submission.files[0]);
      const file =
        selectedFile !== undefined &&
        selectedFile.submissionHistory !== null &&
        selectedFile.submissionHistory.revision === submission.revision
          ? {
              originalFileName: selectedFile.originalFileName,
              sizeBytes: selectedFile.sizeBytes,
            }
          : null;
      return {
        milestoneDocumentId: submission.requirementId,
        teamId: submission.teamId,
        submittedAt: submission.submittedAt,
        revision: submission.revision,
        status: submission.status,
        content: submission.content,
        file,
        review:
          review === null
            ? null
            : {
                id: review.id,
                decision: submissionReviewDecision(review.event),
                comment: review.comment,
                reviewedAt: review.createdAt,
              },
      };
    });
  }
}
const currentFileSelect = {
  revision: true,
  files: {
    select: {
      storageKey: true,
      originalFileName: true,
      mimeType: true,
      sizeBytes: true,
      submissionHistory: { select: { revision: true } },
    },
  },
} satisfies Prisma.SubmissionSelect;

type CurrentFileRow = Prisma.SubmissionGetPayload<{
  select: typeof currentFileSelect;
}>;

interface CurrentFilePrisma {
  readonly submission: {
    findFirst(
      args: Prisma.SubmissionFindFirstArgs,
    ): Promise<CurrentFileRow | null>;
  };
}

export interface CurrentMilestoneDocumentFile {
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export interface MilestoneDocumentCurrentFileReader {
  findForParticipant(
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
  ): Promise<CurrentMilestoneDocumentFile | null>;
}

@Injectable()
export class MilestoneDocumentCurrentFileRepository implements MilestoneDocumentCurrentFileReader {
  constructor(
    @Inject(PrismaService) private readonly prisma: CurrentFilePrisma,
    private readonly fileMetadata: FileMetadataRepository,
  ) {}

  async findForParticipant(
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
  ): Promise<CurrentMilestoneDocumentFile | null> {
    const activeStudent = {
      githubId: sessionGithubId,
      accountStatus: AccountStatus.ACTIVE,
      ...STUDENT_MEMBER_WHERE,
    } satisfies Prisma.UserWhereInput;
    const submission = await this.prisma.submission.findFirst({
      where: {
        requirementId: documentId,
        requirement: {
          is: {
            milestoneId,
          },
        },
        team: {
          is: {
            program: { is: { milestones: { some: { id: milestoneId } } } },
            members: { some: { user: { is: activeStudent } } },
          },
        },
      },
      select: {
        revision: true,
        files: {
          where: {
            lifecycle: FileLifecycle.ATTACHED,
            expiresAt: { gt: new Date() },
          },
          orderBy: [
            {
              submissionHistory: {
                revision: { sort: 'desc', nulls: 'last' },
              },
            },
            { createdAt: 'desc' },
          ],
          take: 1,
          select: currentFileSelect.files.select,
        },
      },
    });
    const rawFile = submission?.files[0];
    const file =
      rawFile === undefined ? undefined : this.fileMetadata.read(rawFile);
    if (
      submission == null ||
      file == null ||
      file.submissionHistory?.revision !== submission.revision
    ) {
      return null;
    }
    return {
      storageKey: file.storageKey,
      originalFileName: file.originalFileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    };
  }
}
