import { UserProfileService } from '../users/user-profile.service';
import {
  SubmissionHistoryEvent,
  RequirementSubmissionType,
  SubmissionStatus,
} from '@prisma/client';
import { Injectable, Inject } from '@nestjs/common';
import { DomainException } from '../platform/error-code.error';
import {
  SubmissionMembershipChangedError,
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
  MilestoneDocumentDeadlineClosedError,
  MilestoneDocumentMissingError,
  MilestoneDocumentPendingFileMissingError,
  MilestoneDocumentReviewChangedError,
  MilestoneDocumentSubmissionChangedError,
  MilestoneDocumentRevisionChangedError,
  InvalidMilestoneDocumentHistoryCursorError,
} from './submissions.error';
import {
  RequirementsRepository,
  type UpdateMilestoneDocumentInput,
  MilestoneDocumentRecord,
  MilestoneDocumentCollectionApplication,
  MilestoneContext,
  MilestoneDocumentSubmittedContent,
  MilestoneDocumentContentInput,
  type UpsertMilestoneDocumentInput,
  type ProgramDocumentChangeRequestCandidate,
  type ProgramDocumentChangeRequestInput,
  type ProgramDocumentChangeRequestPreview,
  type ProgramDocumentChangeRequestScope,
  MilestoneDocumentArchiveRepository,
  type ProgramArchiveReader,
} from './requirements.repository';
import {
  type MilestoneDocumentSubmissionDetail,
  type UpsertMilestoneDocumentSubmissionInput,
  SubmissionsRepository,
} from './submissions.repository';
import {
  MilestoneDocumentCollectionService,
  type MilestoneDocumentCollectionPage,
  type MilestoneDocumentCollectionCell,
  type MilestoneDocumentCollectionQuery,
} from './requirement-archive.service';
import { MilestoneDocumentSubmissionWindowService } from './files.service';
import { ProgramScheduleService } from './program-schedule.service';
import { createHash } from 'node:crypto';
interface MilestoneDocumentViewerSubmissionResult {
  readonly submitted: boolean;
  readonly submittedAt: Date | null;
  readonly submittedLate: boolean;
  readonly revision: number | null;
  readonly status: SubmissionStatus | null;
  readonly hasCurrentFile: boolean;
  readonly currentFileName: string | null;
  readonly review: {
    readonly comment: string | null;
    readonly reviewedAt: Date;
  } | null;
  readonly history: {
    readonly hasHistory: boolean;
    readonly isComplete: boolean;
  };
}
export interface MilestoneDocumentViewerResult extends MilestoneDocumentRecord {
  readonly viewerSubmission?: MilestoneDocumentViewerSubmissionResult;
  readonly teamSubmissionCount?: {
    readonly submitted: number;
    readonly total: number;
  };
}
export interface MilestoneDocumentCollectionResult extends MilestoneDocumentCollectionPage<
  MilestoneDocumentCollectionApplication,
  MilestoneDocumentCollectionCell
> {
  readonly milestone: MilestoneContext;
  readonly documents: readonly MilestoneDocumentRecord[];
}
export interface MilestoneDocumentHistoryResult {
  readonly items: readonly {
    readonly event: SubmissionHistoryEvent;
    readonly revision: number | null;
    readonly actorNickname: string;
    readonly comment: string | null;
    readonly createdAt: Date;
    readonly fileName: string | null;
    readonly downloadableFileId: string | null;
    readonly content: MilestoneDocumentSubmittedContent | null;
  }[];
  readonly nextCursor: string | null;
  readonly isComplete: boolean;
}
@Injectable()
export class RequirementsService {
  constructor(
    private readonly repository: RequirementsRepository,
    private readonly milestoneDocumentSubmissionWindowService: MilestoneDocumentSubmissionWindowService,
    private readonly milestoneDocumentCollectionService: MilestoneDocumentCollectionService,
    private readonly programScheduleService: ProgramScheduleService,
    private readonly milestoneDocumentSubmissionRepository: SubmissionsRepository,
    private readonly userProfileService: UserProfileService,
  ) {}
  parseMilestoneDocumentContent(input: {
    readonly fileId?: string;
    readonly text?: string;
  }): MilestoneDocumentContentInput {
    const text = input.text?.trim() || null;
    const fileId = input.fileId?.trim() || null;
    if (text === null && fileId === null) throw contentRequired();
    return { text, fileId };
  }
  async listByMilestone(
    milestoneId: string,
  ): Promise<MilestoneDocumentRecord[]> {
    return this.repository.findByMilestoneId(milestoneId);
  }
  async listForViewer(
    sessionGithubId: bigint,
    milestoneId: string,
    now: Date = new Date(),
  ): Promise<MilestoneDocumentViewerResult[]> {
    const milestone = await this.repository.findMilestone(milestoneId);
    if (milestone === null) {
      throw this.error(MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND);
    }
    const documents = await this.repository.findByMilestoneId(milestoneId);
    const documentIds = documents.map((document) => document.id);
    const viewer = await this.repository.findActiveUser(sessionGithubId);
    const isStaff =
      viewer !== null &&
      this.userProfileService.isStaffEligible({
        accountStatus: viewer.accountStatus,
        memberKind: viewer.type === 'UNSELECTED' ? null : viewer.type,
        hasStaffAccess:
          viewer.type === 'STAFF' && viewer.approvalStatus === 'APPROVED',
        isProfileComplete:
          viewer.profileCreatedAt !== null &&
          this.userProfileService.isCompleteProfileFields(
            { ...viewer, studentId: null },
            'STAFF',
          ),
      });
    const counts = new Map<
      string,
      {
        submitted: number;
        total: number;
      }
    >();
    if (isStaff) {
      const [total, submittedByDocument] = await Promise.all([
        this.repository.countApprovedApplications(milestone.programId),
        this.repository.countSubmissionsByDocument(
          milestone.programId,
          documentIds,
        ),
      ]);
      for (const document of documents) {
        counts.set(document.id, {
          submitted: submittedByDocument.get(document.id) ?? 0,
          total,
        });
      }
    }
    if (
      viewer !== null &&
      (!isStaff ||
        (await this.repository.findActiveStudentByGithubId(sessionGithubId)) !==
          null)
    ) {
      const application = await this.repository.findStudentApplication(
        viewer.id,
        milestone.programId,
      );
      if (application !== null) {
        const summaries = await this.repository.findSubmittedSummaries(
          application.teamId,
          documentIds,
          now,
        );
        const summaryByDocument = new Map(
          summaries.map((summary) => [summary.milestoneDocumentId, summary]),
        );
        return documents.map((document) => {
          const summary = summaryByDocument.get(document.id) ?? null;
          return {
            ...document,
            teamSubmissionCount: counts.get(document.id),
            viewerSubmission: {
              submitted: summary !== null,
              submittedAt: summary?.submittedAt ?? null,
              submittedLate:
                summary !== null &&
                summary.submittedAt.getTime() > milestone.dueAt.getTime(),
              revision: summary?.revision ?? null,
              status: summary?.status ?? null,
              hasCurrentFile: summary?.hasCurrentFile ?? false,
              currentFileName: summary?.currentFileName ?? null,
              review:
                summary?.review == null
                  ? null
                  : {
                      comment: summary.review.comment,
                      reviewedAt: summary.review.reviewedAt,
                    },
              history: {
                hasHistory: summary !== null,
                isComplete: summary?.historyComplete ?? true,
              },
            },
          };
        });
      }
    }
    return documents.map((document) => ({
      ...document,
      teamSubmissionCount: counts.get(document.id),
    }));
  }
  async collectForStaff(
    milestoneId: string,
    query: MilestoneDocumentCollectionQuery,
    now: Date = new Date(),
  ): Promise<MilestoneDocumentCollectionResult> {
    return this.repository.withCollectionSnapshot(async (store) => {
      const milestone = await store.findMilestone(milestoneId);
      if (milestone === null) {
        throw this.error(MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND);
      }
      const [documents, applications] = await Promise.all([
        store.findByMilestoneId(milestoneId),
        store.findApprovedApplicationsForCollection(milestone.programId),
      ]);
      const documentIds = documents.map((document) => document.id);
      const coordinates =
        await store.findSubmissionCoordinatesForCollection(documentIds);
      const coordinatePage =
        this.milestoneDocumentCollectionService.buildMilestoneDocumentCollectionPage(
          documents,
          applications,
          coordinates,
          query,
        );
      const pageApplicationIds = coordinatePage.rows.map(
        (row) => row.application.teamId,
      );
      const submissions = await store.findSubmissionsForCollection(
        documentIds,
        now,
        pageApplicationIds,
      );
      const detailByCell = new Map(
        submissions.map((submission) => [
          `${submission.teamId}::${submission.milestoneDocumentId}`,
          this.milestoneDocumentCollectionService.toMilestoneDocumentCollectionCell(
            submission,
          ),
        ]),
      );
      const collection = {
        ...coordinatePage,
        rows: coordinatePage.rows.map((row) => ({
          application: row.application,
          cells: documents.map(
            (document) =>
              detailByCell.get(`${row.application.teamId}::${document.id}`) ??
              null,
          ),
        })),
      };
      return { milestone, documents, ...collection };
    });
  }
  historyQueryFromRequest(request: {
    readonly cursor?: string | null;
    readonly limit?: number;
  }): {
    readonly cursor: string | null;
    readonly limit: number;
  } {
    return { cursor: request.cursor ?? null, limit: request.limit ?? 20 };
  }
  async historyForStaff(
    milestoneId: string,
    documentId: string,
    teamId: string,
    request: {
      readonly cursor?: string | null;
      readonly limit?: number;
    },
  ): Promise<MilestoneDocumentHistoryResult> {
    const query = this.historyQueryFromRequest(request);
    const document = await this.repository.findDocumentContext(documentId);
    if (document === null || document.milestoneId !== milestoneId) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }
    const applicationProgramId =
      await this.repository.findApplicationProgramId(teamId);
    if (applicationProgramId !== document.programId) {
      throw this.error(MilestoneDocumentsErrorCode.SUBMISSION_NOT_FOUND);
    }
    const page = await this.findHistoryPage(documentId, teamId, query);
    return {
      items: page.items.map((item) => ({
        event: item.event,
        revision: item.revision,
        actorNickname: item.actorNickname,
        comment: item.comment,
        createdAt: item.createdAt,
        fileName: item.fileName,
        downloadableFileId: item.downloadableFileId,
        content:
          this.milestoneDocumentCollectionService.readMilestoneDocumentSubmittedContent(
            item.content,
          ),
      })),
      nextCursor: page.nextCursor,
      isComplete: page.isComplete,
    };
  }
  async historyForParticipant(
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
    request: {
      readonly cursor?: string | null;
      readonly limit?: number;
    },
  ): Promise<MilestoneDocumentHistoryResult> {
    const query = this.historyQueryFromRequest(request);
    const viewer = await this.repository.findActiveUser(sessionGithubId);
    if (viewer === null) {
      throw this.error(MilestoneDocumentsErrorCode.NOT_APPLICATION_MEMBER);
    }
    const document = await this.repository.findDocumentContext(documentId);
    if (document === null || document.milestoneId !== milestoneId) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }
    const application = await this.repository.findStudentApplication(
      viewer.id,
      document.programId,
    );
    if (application === null) {
      throw this.error(MilestoneDocumentsErrorCode.NOT_APPLICATION_MEMBER);
    }
    const page = await this.findHistoryPage(
      documentId,
      application.teamId,
      query,
    );
    return {
      items: page.items.map((item) => ({
        event: item.event,
        revision: item.revision,
        actorNickname: studentHistoryActorLabel(item.event, item.actorNickname),
        comment: item.comment,
        createdAt: item.createdAt,
        fileName: item.fileName,
        downloadableFileId: item.downloadableFileId,
        content:
          this.milestoneDocumentCollectionService.readMilestoneDocumentSubmittedContent(
            item.content,
          ),
      })),
      nextCursor: page.nextCursor,
      isComplete: page.isComplete,
    };
  }
  async createDocument(
    milestoneId: string,
    input: UpsertMilestoneDocumentInput,
  ): Promise<MilestoneDocumentRecord> {
    const record = await this.repository.withTransaction(async (store) => {
      const milestone = await store.lockMilestone(milestoneId);
      if (milestone === null) {
        throw this.error(MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND);
      }
      return store.createDocument(milestoneId, {
        name: input.name,
        required: input.required,
      });
    });
    return record;
  }
  async updateDocument(
    milestoneId: string,
    documentId: string,
    input: UpsertMilestoneDocumentInput,
  ): Promise<MilestoneDocumentRecord> {
    const record = await this.repository.withTransaction(async (store) => {
      const locked = await store.lockDocument(documentId);
      if (locked === null || locked.milestoneId !== milestoneId) {
        throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
      }
      return store.updateDocument(documentId, toUpdateInput(input));
    });
    return record;
  }
  updateGraceDueAtFromRequest(
    milestoneId: string,
    documentId: string,
    request: {
      readonly graceDueAt: string | null;
    },
  ): Promise<void> {
    return this.updateGraceDueAt(
      milestoneId,
      documentId,
      request.graceDueAt === null ? null : new Date(request.graceDueAt),
    );
  }
  async updateGraceDueAt(
    milestoneId: string,
    documentId: string,
    graceDueAt: Date | null,
  ): Promise<void> {
    await this.repository.withTransaction(async (store) => {
      const milestone = await store.lockMilestoneForGrace(milestoneId);
      if (milestone === null)
        throw this.error(MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND);
      const document = await store.lockDocument(documentId);
      if (document === null || document.milestoneId !== milestoneId)
        throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
      if (
        graceDueAt !== null &&
        (!Number.isFinite(graceDueAt.getTime()) ||
          graceDueAt.getTime() <= milestone.dueAt.getTime() ||
          graceDueAt.getTime() >=
            this.programScheduleService
              .addOneCalendarYear(milestone.programEndAt)
              .getTime())
      )
        throw this.error(MilestoneDocumentsErrorCode.INVALID_GRACE_DUE_AT);
      await store.updateGraceDueAt(documentId, graceDueAt);
    });
  }
  async reorderDocuments(
    milestoneId: string,
    documentIds: readonly string[],
  ): Promise<MilestoneDocumentRecord[]> {
    const records = await this.repository.withTransaction(async (store) => {
      const milestone = await store.lockMilestone(milestoneId);
      if (milestone === null) {
        throw this.error(MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND);
      }
      const lockedIds = await store.lockDocumentIdsOfMilestone(milestoneId);
      if (!isExactDocumentIdSet(lockedIds, documentIds)) {
        throw this.error(MilestoneDocumentsErrorCode.INVALID_REQUEST);
      }
      return store.applyDocumentOrder(milestoneId, documentIds);
    });
    return records;
  }
  async deleteDocument(milestoneId: string, documentId: string): Promise<void> {
    await this.repository.withTransaction(async (store) => {
      const milestone = await store.lockMilestone(milestoneId);
      if (milestone === null) {
        throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
      }
      const lockedIds = await store.lockDocumentIdsOfMilestone(milestoneId);
      if (!lockedIds.includes(documentId)) {
        throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
      }
      if (lockedIds.length === 1) {
        throw this.error(MilestoneDocumentsErrorCode.LAST_DOCUMENT_REQUIRED);
      }
      const locked = await store.lockDocument(documentId);
      if (locked === null || locked.milestoneId !== milestoneId) {
        throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
      }
      const submissionCount =
        await store.countSubmissionsForDocument(documentId);
      if (submissionCount > 0) {
        throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_HAS_SUBMISSIONS);
      }
      await store.deleteDocument(documentId);
    });
  }
  submitFromRequest(
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
    request: {
      readonly comment?: string | null;
      readonly expectedRevision?: number;
      readonly content: Parameters<
        RequirementsService['parseMilestoneDocumentContent']
      >[0];
    },
  ): ReturnType<RequirementsService['submit']> {
    return this.submit(sessionGithubId, milestoneId, documentId, {
      ...this.parseMilestoneDocumentContent(request.content),
      ...(request.comment === undefined
        ? {}
        : { comment: request.comment?.trim() || null }),
      ...(request.expectedRevision === undefined
        ? {}
        : { expectedRevision: request.expectedRevision }),
    });
  }
  async submit(
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
    content: MilestoneDocumentContentInput,
    now: Date = new Date(),
  ): Promise<MilestoneDocumentSubmissionDetail> {
    const viewer =
      await this.repository.findActiveStudentByGithubId(sessionGithubId);
    if (viewer === null) {
      throw this.error(MilestoneDocumentsErrorCode.STUDENT_ONLY);
    }
    const documentContext =
      await this.repository.findDocumentContext(documentId);
    if (
      documentContext === null ||
      documentContext.milestoneId !== milestoneId
    ) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }
    const application = await this.repository.findStudentApplication(
      viewer.id,
      documentContext.programId,
    );
    if (application === null) {
      throw this.error(MilestoneDocumentsErrorCode.NOT_APPLICATION_MEMBER);
    }
    if (!application.approved) {
      throw this.error(
        MilestoneDocumentsErrorCode.APPLICATION_APPROVAL_REQUIRED,
      );
    }
    let acceptedContent = content;
    switch (documentContext.submissionType) {
      case RequirementSubmissionType.FILE:
        if (content.fileId === null) {
          throw this.error(MilestoneDocumentsErrorCode.CONTENT_TYPE_MISMATCH);
        }
        acceptedContent = { ...content, text: null };
        break;
      case RequirementSubmissionType.TEXT:
        if (content.text === null) {
          throw this.error(MilestoneDocumentsErrorCode.CONTENT_TYPE_MISMATCH);
        }
        acceptedContent = { ...content, fileId: null };
        break;
      case RequirementSubmissionType.FILE_OR_TEXT:
        break;
      default:
        throw new TypeError(
          `Unknown requirement input rule: ${String(documentContext.submissionType satisfies never)}`,
        );
    }
    const latestReview = await this.repository.findLatestReview(
      documentId,
      application.teamId,
    );
    const currentSubmission = await this.repository.findMySubmission(
      documentId,
      application.teamId,
    );
    const latestDecision = latestReview?.decision ?? null;
    const submissionStatus = currentSubmission?.status ?? null;
    const blocked =
      this.milestoneDocumentSubmissionWindowService.milestoneDocumentSubmissionBlock(
        {
          dueAt: documentContext.dueAt,
          graceDueAt: documentContext.graceDueAt,
          now,
          hasSubmission: currentSubmission !== null,
          latestDecision,
          submissionStatus,
        },
      );
    if (blocked !== null) {
      throw this.error(MilestoneDocumentsErrorCode[blocked]);
    }
    const attachFile: UpsertMilestoneDocumentSubmissionInput['attachFile'] =
      acceptedContent.fileId === null
        ? null
        : {
            fileId: acceptedContent.fileId,
            uploaderId: viewer.id,
            milestoneId,
          };
    const submissionContent =
      documentContext.submissionType === RequirementSubmissionType.FILE
        ? { type: RequirementSubmissionType.FILE }
        : this.milestoneDocumentSubmissionRepository.milestoneDocumentSubmissionContent(
            acceptedContent.text,
          );
    try {
      const detail = await this.repository.upsertSubmission({
        milestoneDocumentId: documentId,
        teamId: application.teamId,
        submittedById: viewer.id,
        submittedAt: now,
        deadline: {
          milestoneId,
          allowAfterDeadline:
            this.milestoneDocumentSubmissionWindowService.isChangeRequestResubmissionOpen(
              {
                latestDecision,
                submissionStatus,
              },
            ),
          expectedSubmissionStatus: submissionStatus,
        },
        content: submissionContent,
        ...(acceptedContent.expectedRevision === undefined
          ? {}
          : { expectedRevision: acceptedContent.expectedRevision }),
        ...(acceptedContent.comment === undefined
          ? {}
          : { comment: acceptedContent.comment }),
        attachFile,
        expectedLatestReviewId: latestReview?.id ?? null,
      });
      return detail;
    } catch (error) {
      if (error instanceof MilestoneDocumentRevisionChangedError) {
        throw this.error(
          MilestoneDocumentsErrorCode.SUBMISSION_REVISION_CHANGED,
        );
      }
      if (error instanceof SubmissionMembershipChangedError) {
        throw this.error(MilestoneDocumentsErrorCode.NOT_APPLICATION_MEMBER);
      }
      if (error instanceof MilestoneDocumentMissingError) {
        throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
      }
      if (error instanceof MilestoneDocumentPendingFileMissingError) {
        throw this.error(MilestoneDocumentsErrorCode.PENDING_FILE_NOT_FOUND);
      }
      if (error instanceof MilestoneDocumentReviewChangedError) {
        throw this.error(MilestoneDocumentsErrorCode.REVIEW_CHANGED);
      }
      if (error instanceof MilestoneDocumentSubmissionChangedError) {
        throw this.error(MilestoneDocumentsErrorCode.RESUBMISSION_ALREADY_USED);
      }
      if (error instanceof MilestoneDocumentDeadlineClosedError) {
        throw this.error(
          currentSubmission === null
            ? MilestoneDocumentsErrorCode.MILESTONE_CLOSED
            : MilestoneDocumentsErrorCode.SUBMISSION_REPLACEMENT_CLOSED,
        );
      }
      throw error;
    }
  }
  private error(code: MilestoneDocumentsErrorCode): DomainException {
    return new DomainException(MILESTONE_DOCUMENTS_ERROR_CODES[code]);
  }
  private async findHistoryPage(
    documentId: string,
    teamId: string,
    query: {
      readonly cursor: string | null;
      readonly limit: number;
    },
  ) {
    const page = await this.repository
      .findSubmissionHistoryPage(documentId, teamId, query.cursor, query.limit)
      .catch((error: unknown) => {
        if (error instanceof InvalidMilestoneDocumentHistoryCursorError) {
          throw this.error(MilestoneDocumentsErrorCode.INVALID_REQUEST);
        }
        throw error;
      });
    if (page === null) {
      throw this.error(MilestoneDocumentsErrorCode.SUBMISSION_NOT_FOUND);
    }
    return page;
  }
}
function studentHistoryActorLabel(
  event: SubmissionHistoryEvent,
  actorNickname: string,
): string {
  return event === SubmissionHistoryEvent.SUBMITTED ||
    event === SubmissionHistoryEvent.RESUBMITTED
    ? actorNickname
    : '담당 교직원';
}
function toUpdateInput(
  input: UpsertMilestoneDocumentInput,
): UpdateMilestoneDocumentInput {
  return {
    name: input.name,
    required: input.required,
  };
}
function isExactDocumentIdSet(
  existingIds: readonly string[],
  documentIds: readonly string[],
): boolean {
  const existing = new Set(existingIds);
  const requested = new Set(documentIds);
  return (
    documentIds.length === existingIds.length &&
    requested.size === documentIds.length &&
    [...requested].every((documentId) => existing.has(documentId))
  );
}
function contentRequired(): DomainException {
  return new DomainException(
    MILESTONE_DOCUMENTS_ERROR_CODES[
      MilestoneDocumentsErrorCode.CONTENT_REQUIRED
    ],
  );
}
@Injectable()
export class ProgramDocumentChangeRequestsService {
  constructor(
    private readonly repository: RequirementsRepository,
    @Inject(MilestoneDocumentArchiveRepository)
    private readonly programs: ProgramArchiveReader,
    private readonly milestoneDocumentSubmissionRepository: SubmissionsRepository,
  ) {}
  changeRequestTargetStatuses(
    includeFinalDecisions: boolean,
  ): readonly SubmissionStatus[] {
    return includeFinalDecisions
      ? [...OPEN_STATUSES, ...FINAL_STATUSES]
      : OPEN_STATUSES;
  }
  changeRequestTargetsVersion(
    candidates: readonly ProgramDocumentChangeRequestCandidate[],
  ): string {
    const lines = candidates
      .map(
        (candidate) =>
          `${candidate.milestoneDocumentId}:${candidate.teamId}:${
            OPEN_STATUSES.includes(candidate.status) ? 'open' : 'final'
          }`,
      )
      .sort();
    return createHash('sha256').update(lines.join('\n')).digest('hex');
  }
  toProgramDocumentChangeRequestScope(
    scope: ProgramDocumentChangeRequestScope['kind'],
    teamId: string | null | undefined,
  ): ProgramDocumentChangeRequestScope {
    if (scope === 'PROGRAM' && teamId === undefined) return { kind: 'PROGRAM' };
    if (scope === 'TEAM' && typeof teamId === 'string') {
      return { kind: 'TEAM', teamId };
    }
    throw new DomainException(
      MILESTONE_DOCUMENTS_ERROR_CODES[
        MilestoneDocumentsErrorCode.INVALID_REQUEST
      ],
    );
  }
  toProgramDocumentChangeRequestInput(body: {
    readonly scope: ProgramDocumentChangeRequestScope['kind'];
    readonly teamId?: string | null;
    readonly includeFinalDecisions: boolean;
    readonly comment?: string;
    readonly expectedVersion: string;
  }): ProgramDocumentChangeRequestInput {
    const comment = body.comment?.trim() || null;
    return {
      scope: this.toProgramDocumentChangeRequestScope(body.scope, body.teamId),
      includeFinalDecisions: body.includeFinalDecisions,
      comment,
      expectedVersion: body.expectedVersion,
    };
  }
  targetsFromRequest(
    programId: string,
    request: {
      readonly scope: ProgramDocumentChangeRequestScope['kind'];
      readonly teamId?: string | null;
    },
  ): Promise<ProgramDocumentChangeRequestPreview> {
    return this.targets(
      programId,
      this.toProgramDocumentChangeRequestScope(request.scope, request.teamId),
    );
  }
  requestChangesFromRequest(
    reviewerId: string,
    programId: string,
    request: Parameters<
      ProgramDocumentChangeRequestsService['toProgramDocumentChangeRequestInput']
    >[0],
  ): Promise<{
    readonly requestedCount: number;
  }> {
    return this.requestChanges(
      reviewerId,
      programId,
      this.toProgramDocumentChangeRequestInput(request),
    );
  }
  async targets(
    programId: string,
    scope: ProgramDocumentChangeRequestScope,
  ): Promise<ProgramDocumentChangeRequestPreview> {
    const teamIds = await this.teamIdsInScope(programId, scope);
    const candidates = await this.repository.findChangeRequestCandidates(
      programId,
      teamIds,
    );
    const count = (status: SubmissionStatus) =>
      candidates.filter((candidate) => candidate.status === status).length;
    return {
      counts: {
        [SubmissionStatus.SUBMITTED]: count(SubmissionStatus.SUBMITTED),
        [SubmissionStatus.CHANGES_REQUESTED]: count(
          SubmissionStatus.CHANGES_REQUESTED,
        ),
        [SubmissionStatus.APPROVED]: count(SubmissionStatus.APPROVED),
        [SubmissionStatus.REJECTED]: count(SubmissionStatus.REJECTED),
      },
      version: this.changeRequestTargetsVersion(candidates),
    };
  }
  async requestChanges(
    reviewerId: string,
    programId: string,
    input: ProgramDocumentChangeRequestInput,
    now: () => Date = () => new Date(),
  ): Promise<{
    readonly requestedCount: number;
  }> {
    await this.assertProgram(programId);
    const requestedCount = await this.repository.withTransaction(
      async (store) => {
        if (!(await store.lockProgramForReview(programId))) {
          throw this.error(MilestoneDocumentsErrorCode.PROGRAM_NOT_FOUND);
        }
        const documentIds = await store.lockProgramDocumentIds(programId);
        const teamIds = await store.lockApprovedApplicationIds(
          programId,
          input.scope.kind === 'TEAM' ? input.scope.teamId : undefined,
        );
        const candidates = await store.findChangeRequestCandidates({
          documentIds,
          teamIds,
        });
        if (
          this.changeRequestTargetsVersion(candidates) !== input.expectedVersion
        ) {
          throw this.error(MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED);
        }
        const statuses = this.changeRequestTargetStatuses(
          input.includeFinalDecisions,
        );
        const targets = candidates.filter((candidate) =>
          statuses.includes(candidate.status),
        );
        for (const target of targets) {
          const submission = await store.findSubmissionForReview(
            target.milestoneDocumentId,
            target.teamId,
          );
          if (submission === null) {
            throw this.error(MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED);
          }
          const reviewedAt =
            this.milestoneDocumentSubmissionRepository.nextHistoryCreatedAt(
              now(),
              submission.latestHistoryCreatedAt,
            );
          await store.createReview({
            milestoneDocumentSubmissionId: submission.id,
            submissionHistoryId: submission.submissionHistoryId,
            revision: submission.revision,
            reviewerId,
            decision: 'CHANGES_REQUESTED',
            comment: input.comment,
            reviewedAt,
          });
          await store.updateSubmissionStatus(
            submission.id,
            SubmissionStatus.CHANGES_REQUESTED,
          );
        }
        return targets.length;
      },
    );
    return { requestedCount };
  }
  private async assertProgram(programId: string): Promise<void> {
    if ((await this.programs.findProgram(programId)) === null) {
      throw this.error(MilestoneDocumentsErrorCode.PROGRAM_NOT_FOUND);
    }
  }

  private async teamIdsInScope(
    programId: string,
    scope: ProgramDocumentChangeRequestScope,
  ): Promise<readonly string[]> {
    await this.assertProgram(programId);
    const teams = await this.programs.findApprovedTeams(
      programId,
      scope.kind === 'TEAM' ? scope.teamId : undefined,
    );
    return teams.map((team) => team.teamId);
  }
  private error(code: MilestoneDocumentsErrorCode): DomainException {
    return new DomainException(MILESTONE_DOCUMENTS_ERROR_CODES[code]);
  }
}
const OPEN_STATUSES: readonly SubmissionStatus[] = [
  SubmissionStatus.SUBMITTED,
  SubmissionStatus.CHANGES_REQUESTED,
];
const FINAL_STATUSES: readonly SubmissionStatus[] = [
  SubmissionStatus.APPROVED,
  SubmissionStatus.REJECTED,
];
