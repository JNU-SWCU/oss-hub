import {
  MilestoneDocumentSubmissionHistoryEvent,
  SubmissionStatus,
} from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { DomainException } from '../platform/error-code.error';
import { SubmissionMembershipChangedError } from './submission-membership-changed.error';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.error';
import {
  MilestoneDocumentsRepository,
  type UpdateMilestoneDocumentInput,
} from './milestone-documents.repository';
import {
  type UpsertMilestoneDocumentSubmissionInput,
  MilestoneDocumentSubmissionRepository,
} from './milestone-document-submission.repository';
import {
  MilestoneDocumentDeadlineClosedError,
  MilestoneDocumentMissingError,
  MilestoneDocumentPendingFileMissingError,
  MilestoneDocumentReviewChangedError,
  MilestoneDocumentSubmissionChangedError,
} from './milestone-document-submission.error';
import { InvalidMilestoneDocumentHistoryCursorError } from './milestone-documents.error';
import {
  MilestoneDocumentRecord,
  MilestoneDocumentCollectionApplication,
  MilestoneContext,
  MilestoneDocumentSubmittedContent,
  MilestoneDocumentContentInput,
  type MilestoneDocumentSubmissionDetail,
  type UpsertMilestoneDocumentInput,
} from './milestone-document-collection-read.repository';
import {
  MilestoneDocumentRulesService,
  MilestoneDocumentCollectionPage,
  MilestoneDocumentCollectionCell,
  MilestoneDocumentCollectionQuery,
} from './milestone-document-rules.service';
import { SubmissionFileRulesService } from './submission-file-rules.service';

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
    readonly resubmissionDueAt: Date | null;
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
    readonly event: MilestoneDocumentSubmissionHistoryEvent;
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
export class MilestoneDocumentsService {
  constructor(
    private readonly repository: MilestoneDocumentsRepository,
    private readonly milestoneDocumentRulesService: MilestoneDocumentRulesService,
    private readonly submissionFileRulesService: SubmissionFileRulesService,
  ) {}

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

    const counts = new Map<string, { submitted: number; total: number }>();
    if (viewer?.hasStaffAccess === true || viewer?.hasAdminAccess === true) {
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
      ((!viewer.hasStaffAccess && !viewer.hasAdminAccess) ||
        (await this.repository.findActiveStudentByGithubId(sessionGithubId)) !==
          null)
    ) {
      const application = await this.repository.findStudentApplication(
        viewer.id,
        milestone.programId,
      );
      if (application !== null) {
        const summaries = await this.repository.findSubmittedSummaries(
          application.applicationId,
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
                      resubmissionDueAt: summary.review.resubmissionDueAt,
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
        this.milestoneDocumentRulesService.buildMilestoneDocumentCollectionPage(
          documents,
          applications,
          coordinates,
          query,
        );
      const pageApplicationIds = coordinatePage.rows.map(
        (row) => row.application.applicationId,
      );
      const submissions = await store.findSubmissionsForCollection(
        documentIds,
        now,
        pageApplicationIds,
      );
      const detailByCell = new Map(
        submissions.map((submission) => [
          `${submission.applicationId}::${submission.milestoneDocumentId}`,
          this.milestoneDocumentRulesService.toMilestoneDocumentCollectionCell(
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
              detailByCell.get(
                `${row.application.applicationId}::${document.id}`,
              ) ?? null,
          ),
        })),
      };
      return { milestone, documents, ...collection };
    });
  }

  async historyForStaff(
    milestoneId: string,
    documentId: string,
    applicationId: string,
    query: { readonly cursor: string | null; readonly limit: number },
  ): Promise<MilestoneDocumentHistoryResult> {
    const document = await this.repository.findDocumentContext(documentId);
    if (document === null || document.milestoneId !== milestoneId) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }
    const applicationProgramId =
      await this.repository.findApplicationProgramId(applicationId);
    if (applicationProgramId !== document.programId) {
      throw this.error(MilestoneDocumentsErrorCode.SUBMISSION_NOT_FOUND);
    }
    const page = await this.findHistoryPage(documentId, applicationId, query);
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
          this.milestoneDocumentRulesService.readMilestoneDocumentSubmittedContent(
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
    query: { readonly cursor: string | null; readonly limit: number },
  ): Promise<MilestoneDocumentHistoryResult> {
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
      application.applicationId,
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
          this.milestoneDocumentRulesService.readMilestoneDocumentSubmittedContent(
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
            this.submissionFileRulesService
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

    const latestReview = await this.repository.findLatestReview(
      documentId,
      application.applicationId,
    );
    const currentSubmission = await this.repository.findMySubmission(
      documentId,
      application.applicationId,
    );
    const latestDecision = latestReview?.decision ?? null;
    const submissionStatus = currentSubmission?.status ?? null;
    const blocked =
      this.milestoneDocumentRulesService.milestoneDocumentSubmissionBlock({
        dueAt: documentContext.dueAt,
        graceDueAt: documentContext.graceDueAt,
        now,
        hasSubmission: currentSubmission !== null,
        latestDecision,
        submissionStatus,
        resubmissionDueAt: latestReview?.resubmissionDueAt ?? null,
      });
    if (blocked !== null) {
      throw this.error(MilestoneDocumentsErrorCode[blocked]);
    }

    const attachFile: UpsertMilestoneDocumentSubmissionInput['attachFile'] =
      content.fileId === null
        ? null
        : {
            fileId: content.fileId,
            uploaderId: viewer.id,
            milestoneId,
          };
    const submissionContent =
      MilestoneDocumentSubmissionRepository.milestoneDocumentSubmissionContent(
        content.text,
      );

    try {
      const detail = await this.repository.upsertSubmission({
        milestoneDocumentId: documentId,
        applicationId: application.applicationId,
        submittedById: viewer.id,
        submittedAt: now,
        deadline: {
          milestoneId,

          allowAfterDeadline:
            this.milestoneDocumentRulesService.isPostDeadlineResubmissionOpen({
              latestDecision,
              submissionStatus,
              resubmissionDueAt: latestReview?.resubmissionDueAt ?? null,
              now,
            }),

          expectedSubmissionStatus: submissionStatus,
        },
        content: submissionContent,
        attachFile,

        expectedLatestReviewId: latestReview?.id ?? null,
      });
      return detail;
    } catch (error) {
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
    applicationId: string,
    query: { readonly cursor: string | null; readonly limit: number },
  ) {
    const page = await this.repository
      .findSubmissionHistoryPage(
        documentId,
        applicationId,
        query.cursor,
        query.limit,
      )
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
  event: MilestoneDocumentSubmissionHistoryEvent,
  actorNickname: string,
): string {
  return event === MilestoneDocumentSubmissionHistoryEvent.SUBMITTED ||
    event === MilestoneDocumentSubmissionHistoryEvent.RESUBMITTED
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
