import { Inject, Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { DomainException } from '../platform/error-code.error';
import {
  safeSubmissionFileContentType,
  sanitizeSubmissionFileOriginalName,
} from './submission-file.policy';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../platform/object-storage.types';
import {
  MilestoneDocumentCurrentFileRepository,
  type MilestoneDocumentCurrentFileReader,
} from './milestone-document-current-file.repository';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.error';
import { UsersAuthorityService } from '../users/users-authority.service';
import type { MilestoneDocumentDeliveryCollectionResult } from './milestone-document-result.types';
import { MilestoneDocumentCollectionReadRepository } from './milestone-document-collection-read.repository';
import {
  buildMilestoneDocumentDeliveryPage,
  type MilestoneDocumentDeliveryQuery,
} from './milestone-document-delivery-page.policy';

export interface DownloadedMilestoneDocumentCurrentFile {
  readonly body: Readable;
  readonly fileName: string;
  readonly contentType: string;
  readonly contentLength: number;
}

@Injectable()
export class MilestoneDocumentCurrentFileService {
  constructor(
    @Inject(MilestoneDocumentCurrentFileRepository)
    private readonly repository: MilestoneDocumentCurrentFileReader,
    @Inject(OBJECT_STORAGE)
    private readonly storage: ObjectStoragePort,
  ) {}

  async download(
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
  ): Promise<DownloadedMilestoneDocumentCurrentFile> {
    const file = await this.repository.findForParticipant(
      sessionGithubId,
      milestoneId,
      documentId,
    );
    if (file === null) {
      throw this.error(MilestoneDocumentsErrorCode.SUBMISSION_FILE_NOT_FOUND);
    }

    let body: Readable;
    try {
      body = await this.storage.get(file.storageKey);
    } catch {
      throw this.error(MilestoneDocumentsErrorCode.FILE_STORAGE_UNAVAILABLE);
    }

    const fileName = sanitizeSubmissionFileOriginalName(file.originalFileName);
    return {
      body,
      fileName,
      contentType: safeSubmissionFileContentType(fileName),
      contentLength: file.sizeBytes,
    };
  }

  private error(code: MilestoneDocumentsErrorCode): DomainException {
    return new DomainException(MILESTONE_DOCUMENTS_ERROR_CODES[code]);
  }
}

@Injectable()
export class MilestoneDocumentCollectionService {
  constructor(
    private readonly repository: MilestoneDocumentCollectionReadRepository,
    @Inject(UsersAuthorityService)
    private readonly authority: Pick<
      UsersAuthorityService,
      'assertActiveStaff'
    >,
  ) {}

  async collectForStaff(
    sessionGithubId: bigint,
    milestoneId: string,
    query: MilestoneDocumentDeliveryQuery,
    now = new Date(),
  ): Promise<MilestoneDocumentDeliveryCollectionResult> {
    await this.authority.assertActiveStaff(
      sessionGithubId,
      () =>
        new DomainException(
          MILESTONE_DOCUMENTS_ERROR_CODES[
            MilestoneDocumentsErrorCode.STAFF_ONLY
          ],
        ),
    );
    return this.repository.withSnapshot(async (store) => {
      const milestone = await store.findMilestone(milestoneId);
      if (milestone === null)
        throw new DomainException(
          MILESTONE_DOCUMENTS_ERROR_CODES[
            MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND
          ],
        );
      const [documents, applications] = await Promise.all([
        store.findDocuments(milestoneId),
        store.findApplications(milestone.programId),
      ]);
      if (
        query.document !== undefined &&
        !documents.some((document) => document.id === query.document?.id)
      )
        throw new DomainException(
          MILESTONE_DOCUMENTS_ERROR_CODES[
            MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND
          ],
        );
      const documentIds = documents.map((document) => document.id);
      const coordinates = await store.findCoordinates(
        documentIds,
        applications.map((application) => application.applicationId),
      );
      const page = buildMilestoneDocumentDeliveryPage(
        {
          documents,
          applications,
          submissions: coordinates,
          dueAt: milestone.dueAt,
        },
        query,
      );
      const details = await store.findDetails(
        documentIds,
        page.rows.map((row) => row.application.applicationId),
        now,
      );
      const detailByCell = new Map(
        details.map((submission) => [
          `${submission.applicationId}::${submission.milestoneDocumentId}`,
          submission,
        ]),
      );
      return {
        milestone,
        documents,
        ...page,
        rows: page.rows.map((row) => ({
          application: row.application,
          deliveryStatus: row.deliveryStatus,
          cells: documents.map(
            (document) =>
              detailByCell.get(
                `${row.application.applicationId}::${document.id}`,
              ) ?? null,
          ),
        })),
      };
    });
  }
}
