import { Inject, Injectable } from '@nestjs/common';
import { UsersAuthorityService } from '../users/service/authority.service';
import {
  MilestoneDocumentSubmissionHistoryEvent,
  MilestoneSubmissionType,
  Prisma,
} from '@prisma/client';
import { DomainException } from '../common/error-code';
import { SubmissionMembershipChangedError } from '../submissions/domain/submission-membership-changed.error';
import { buildMilestoneDocumentCollectionPage } from './domain/milestone-document-collection-page';
import type { MilestoneDocumentCollectionQuery } from './domain/milestone-document-collection-query';
import {
  type MilestoneDocumentContentInput,
  readMilestoneDocumentSubmittedContent,
} from './domain/milestone-document-content';
import {
  isPostDeadlineResubmissionOpen,
  milestoneDocumentSubmissionBlock,
} from './domain/milestone-document-submission-window';
import { MilestoneDocumentCollectionResponseDto } from './dto/milestone-document-collection-response.dto';
import type { MilestoneDocumentHistoryPageResponseDto } from './dto/milestone-document-history-response.dto';
import { MilestoneDocumentResponseDto } from './dto/milestone-document-response.dto';
import { MilestoneDocumentSubmissionResponseDto } from './dto/milestone-document-submission-response.dto';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './domain/milestone-documents-error-code.enum';
import {
  InvalidMilestoneDocumentHistoryCursorError,
  MilestoneDocumentDeadlineClosedError,
  MilestoneDocumentMissingError,
  MilestoneDocumentPendingFileMissingError,
  MilestoneDocumentReviewChangedError,
  MilestoneDocumentsRepository,
  MilestoneDocumentSubmissionChangedError,
  type UpdateMilestoneDocumentInput,
} from './repository/milestone-documents.repository';
import type { UpsertMilestoneDocumentSubmissionInput } from './milestone-document-submission.repository';
import type {
  MilestoneDocumentRecord,
  UpsertMilestoneDocumentInput,
} from './domain/milestone-document-record';

@Injectable()
export class MilestoneDocumentsService {
  constructor(
    private readonly repository: MilestoneDocumentsRepository,
    @Inject(UsersAuthorityService)
    private readonly authority: Pick<
      UsersAuthorityService,
      'assertActiveStaff'
    >,
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
  ): Promise<MilestoneDocumentResponseDto[]> {
    const milestone = await this.repository.findMilestone(milestoneId);
    if (milestone === null) {
      throw this.error(MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND);
    }
    const documents = await this.repository.findByMilestoneId(milestoneId);
    const documentIds = documents.map((document) => document.id);
    const viewer = await this.repository.findActiveUser(sessionGithubId);

    if (viewer?.hasStaffAccess === true || viewer?.hasAdminAccess === true) {
      const [total, submittedByDocument] = await Promise.all([
        this.repository.countApprovedApplications(milestone.programId),
        this.repository.countSubmissionsByDocument(
          milestone.programId,
          documentIds,
        ),
      ]);
      return documents.map((document) =>
        MilestoneDocumentResponseDto.from(document, {
          teamSubmissionCount: {
            submitted: submittedByDocument.get(document.id) ?? 0,
            total,
          },
        }),
      );
    }

    if (viewer !== null && !viewer.hasStaffAccess && !viewer.hasAdminAccess) {
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
          return MilestoneDocumentResponseDto.from(document, {
            viewerSubmission: {
              submitted: summary !== null,
              submittedAt: summary?.submittedAt.toISOString() ?? null,
              revision: summary?.revision ?? null,
              status: summary?.status ?? null,
              hasCurrentFile: summary?.hasCurrentFile ?? false,
              currentFileName: summary?.currentFileName ?? null,
              review:
                summary?.review == null
                  ? null
                  : {
                      comment: summary.review.comment,
                      reviewedAt: summary.review.reviewedAt.toISOString(),
                      resubmissionDueAt:
                        summary.review.resubmissionDueAt?.toISOString() ?? null,
                    },
              history: {
                hasHistory: summary !== null,
                isComplete: summary?.historyComplete ?? true,
              },
            },
          });
        });
      }
    }

    return documents.map((document) =>
      MilestoneDocumentResponseDto.from(document),
    );
  }

  async collectForStaff(
    sessionGithubId: bigint,
    milestoneId: string,
    query: MilestoneDocumentCollectionQuery,
    now: Date = new Date(),
  ): Promise<MilestoneDocumentCollectionResponseDto> {
    await this.authority.assertActiveStaff(sessionGithubId, () =>
      this.error(MilestoneDocumentsErrorCode.STAFF_ONLY),
    );
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
      const coordinatePage = buildMilestoneDocumentCollectionPage(
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
          submission,
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
      return MilestoneDocumentCollectionResponseDto.from(
        milestone,
        documents,
        collection,
      );
    });
  }

  async historyForStaff(
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
    applicationId: string,
    query: { readonly cursor: string | null; readonly limit: number },
  ): Promise<MilestoneDocumentHistoryPageResponseDto> {
    await this.authority.assertActiveStaff(sessionGithubId, () =>
      this.error(MilestoneDocumentsErrorCode.STAFF_ONLY),
    );
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
        createdAt: item.createdAt.toISOString(),
        fileName: item.fileName,
        downloadUrl: submissionFileDownloadUrl(item.downloadableFileId),
        content: readMilestoneDocumentSubmittedContent(item.content),
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
  ): Promise<MilestoneDocumentHistoryPageResponseDto> {
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
        createdAt: item.createdAt.toISOString(),
        fileName: item.fileName,
        downloadUrl: submissionFileDownloadUrl(item.downloadableFileId),
        content: readMilestoneDocumentSubmittedContent(item.content),
      })),
      nextCursor: page.nextCursor,
      isComplete: page.isComplete,
    };
  }

  async createDocument(
    sessionGithubId: bigint,
    milestoneId: string,
    input: UpsertMilestoneDocumentInput,
  ): Promise<MilestoneDocumentResponseDto> {
    await this.authority.assertActiveStaff(sessionGithubId, () =>
      this.error(MilestoneDocumentsErrorCode.STAFF_ONLY),
    );
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
    return MilestoneDocumentResponseDto.from(record);
  }

  async updateDocument(
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
    input: UpsertMilestoneDocumentInput,
  ): Promise<MilestoneDocumentResponseDto> {
    await this.authority.assertActiveStaff(sessionGithubId, () =>
      this.error(MilestoneDocumentsErrorCode.STAFF_ONLY),
    );
    const record = await this.repository.withTransaction(async (store) => {
      const locked = await store.lockDocument(documentId);
      if (locked === null || locked.milestoneId !== milestoneId) {
        throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
      }
      return store.updateDocument(documentId, toUpdateInput(input));
    });
    return MilestoneDocumentResponseDto.from(record);
  }

  async reorderDocuments(
    sessionGithubId: bigint,
    milestoneId: string,
    documentIds: readonly string[],
  ): Promise<MilestoneDocumentResponseDto[]> {
    await this.authority.assertActiveStaff(sessionGithubId, () =>
      this.error(MilestoneDocumentsErrorCode.STAFF_ONLY),
    );
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
    return records.map((record) => MilestoneDocumentResponseDto.from(record));
  }

  async deleteDocument(
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
  ): Promise<void> {
    await this.authority.assertActiveStaff(sessionGithubId, () =>
      this.error(MilestoneDocumentsErrorCode.STAFF_ONLY),
    );
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
  ): Promise<MilestoneDocumentSubmissionResponseDto> {
    const viewer = await this.repository.findActiveUser(sessionGithubId);
    if (viewer === null || viewer.hasStaffAccess || viewer.hasAdminAccess) {
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
    const blocked = milestoneDocumentSubmissionBlock({
      dueAt: documentContext.dueAt,
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
    const submissionContent: Prisma.InputJsonValue | typeof Prisma.JsonNull =
      content.text === null
        ? Prisma.JsonNull
        : { type: MilestoneSubmissionType.TEXT, text: content.text };

    try {
      const detail = await this.repository.upsertSubmission({
        milestoneDocumentId: documentId,
        applicationId: application.applicationId,
        submittedById: viewer.id,
        submittedAt: now,
        deadline: {
          milestoneId,

          allowAfterDeadline: isPostDeadlineResubmissionOpen({
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
      return MilestoneDocumentSubmissionResponseDto.from(detail);
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

function submissionFileDownloadUrl(fileId: string | null): string | null {
  return fileId === null ? null : `/api/v1/submission-files/${fileId}`;
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
