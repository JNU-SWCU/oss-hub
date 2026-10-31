import { Inject, Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { DomainException } from '../platform/error-code.error';
import { type ObjectStoragePort } from '../platform/object-storage.types';
import { OBJECT_STORAGE } from '../platform/object-storage.config';
import {
  MilestoneDocumentCurrentFileRepository,
  type MilestoneDocumentCurrentFileReader,
} from './milestone-document-current-file.repository';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.error';
import {
  MilestoneDocumentCollectionReadRepository,
  type DocumentDeliveryStatus,
  MilestoneDocumentCollectionApplication,
  MilestoneContext,
  MilestoneDocumentRecord,
} from './milestone-document-collection-read.repository';
import { MilestoneDocumentRulesService } from './milestone-document-rules.service';
import { SubmissionFileRulesService } from './submission-file-rules.service';
import type {
  MilestoneDocumentCollectionQuery,
  MilestoneDocumentCollectionApplicationRule,
  MilestoneDocumentCollectionSubmissionRule,
  MilestoneDocumentCollectionPage,
  MilestoneDocumentCollectionDocumentRule,
  MilestoneDocumentCollectionCell,
} from './milestone-document-rules.service';

export interface MilestoneDocumentDeliveryQuery extends MilestoneDocumentCollectionQuery {
  readonly deliveryStatus?: DocumentDeliveryStatus;
  readonly document?: {
    readonly id: string;
    readonly submissionState: 'ALL' | 'SUBMITTED' | 'MISSING';
  };
}

export type MilestoneDocumentDeliveryPage<
  TApplication extends MilestoneDocumentCollectionApplicationRule,
  TSubmission extends MilestoneDocumentCollectionSubmissionRule,
> = Omit<MilestoneDocumentCollectionPage<TApplication, TSubmission>, 'rows'> & {
  readonly rows: readonly (MilestoneDocumentCollectionPage<
    TApplication,
    TSubmission
  >['rows'][number] & { readonly deliveryStatus: DocumentDeliveryStatus })[];
  readonly deliveryCounts: {
    readonly missing: number;
    readonly late: number;
    readonly complete: number;
    readonly noRequiredItems: number;
  };
};

export interface MilestoneDocumentDeliveryCollectionResult extends MilestoneDocumentDeliveryPage<
  MilestoneDocumentCollectionApplication,
  MilestoneDocumentCollectionCell
> {
  readonly milestone: MilestoneContext;
  readonly documents: readonly MilestoneDocumentRecord[];
}

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
    private readonly submissionFileRulesService: SubmissionFileRulesService,
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

    const fileName =
      this.submissionFileRulesService.sanitizeSubmissionFileOriginalName(
        file.originalFileName,
      );
    return {
      body,
      fileName,
      contentType:
        this.submissionFileRulesService.safeSubmissionFileContentType(fileName),
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
    private readonly milestoneDocumentRulesService: MilestoneDocumentRulesService,
  ) {}

  async collectForStaff(
    milestoneId: string,
    query: MilestoneDocumentDeliveryQuery,
    now = new Date(),
  ): Promise<MilestoneDocumentDeliveryCollectionResult> {
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
      const page = this.buildMilestoneDocumentDeliveryPage(
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
          this.milestoneDocumentRulesService.toMilestoneDocumentCollectionCell(
            submission,
          ),
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

  buildMilestoneDocumentDeliveryPage<
    TDocument extends MilestoneDocumentCollectionDocumentRule,
    TApplication extends MilestoneDocumentCollectionApplicationRule,
    TSubmission extends MilestoneDocumentCollectionSubmissionRule & {
      readonly firstSubmittedAt: Date;
    },
  >(
    source: {
      readonly documents: readonly TDocument[];
      readonly applications: readonly TApplication[];
      readonly submissions: readonly TSubmission[];
      readonly dueAt: Date | null;
    },
    query: MilestoneDocumentDeliveryQuery,
  ): MilestoneDocumentDeliveryPage<TApplication, TSubmission> {
    const base =
      this.milestoneDocumentRulesService.buildMilestoneDocumentCollectionPage(
        source.documents,
        source.applications,
        source.submissions,
        {
          filter: 'ALL',
          page: 1,
          pageSize: Math.max(1, source.applications.length),
        },
      );
    const allRows = base.rows.map((row) => ({
      ...row,
      deliveryStatus: this.milestoneDocumentRulesService.documentDeliveryStatus(
        {
          dueAt: source.dueAt,
          requiredFirstSubmissions: source.documents.flatMap(
            (document, index) =>
              document.required
                ? [row.cells[index]?.firstSubmittedAt ?? null]
                : [],
          ),
        },
      ),
    }));
    const deliveryCounts = {
      missing: allRows.filter((row) => row.deliveryStatus === 'MISSING').length,
      late: allRows.filter((row) => row.deliveryStatus === 'LATE').length,
      complete: allRows.filter((row) => row.deliveryStatus === 'COMPLETE')
        .length,
      noRequiredItems: allRows.filter(
        (row) => row.deliveryStatus === 'NO_REQUIRED_ITEMS',
      ).length,
    };
    const documentIndex = source.documents.findIndex(
      (document) => document.id === query.document?.id,
    );
    const filtered = allRows.filter((row) => {
      if (query.document !== undefined) {
        if (documentIndex < 0) return false;
        const submitted = row.cells[documentIndex] !== null;
        if (query.document.submissionState === 'SUBMITTED' && !submitted)
          return false;
        if (query.document.submissionState === 'MISSING' && submitted)
          return false;
      }
      if (
        query.deliveryStatus !== undefined &&
        row.deliveryStatus !== query.deliveryStatus
      )
        return false;
      switch (query.filter) {
        case 'ALL':
          return true;
        case 'HAS_MISSING':
          return row.deliveryStatus === 'MISSING';
        case 'ZERO_SUBMISSION':
          return (
            source.documents.length > 0 &&
            row.cells.every((cell) => cell === null)
          );
        default: {
          const exhaustive: never = query.filter;
          return exhaustive;
        }
      }
    });
    const offset = (query.page - 1) * query.pageSize;
    return {
      ...base,
      rows: filtered.slice(offset, offset + query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total: filtered.length,
      deliveryCounts,
    };
  }
}
