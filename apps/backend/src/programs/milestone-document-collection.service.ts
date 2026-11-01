import type { Response } from 'express';
import { DownloadResponseService } from './download-response.service';
import { Inject, Injectable, StreamableFile } from '@nestjs/common';
import { MilestoneSubmissionType } from '@prisma/client';
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
  MilestoneDocumentCollectionSubmission,
  MilestoneDocumentSubmittedContent,
} from './milestone-document-collection-read.repository';
import { SubmissionFileAdmissionService } from './submission-file-admission.service';

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
    private readonly submissionFileAdmissionService: SubmissionFileAdmissionService,
    private readonly downloadResponseService: DownloadResponseService,
  ) {}

  async downloadTo(
    response: Response,
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
  ): Promise<StreamableFile> {
    const file = await this.download(sessionGithubId, milestoneId, documentId);
    return this.downloadResponseService.streamableFile(response, file);
  }

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
      this.submissionFileAdmissionService.sanitizeSubmissionFileOriginalName(
        file.originalFileName,
      );
    return {
      body,
      fileName,
      contentType:
        this.submissionFileAdmissionService.safeSubmissionFileContentType(
          fileName,
        ),
      contentLength: file.sizeBytes,
    };
  }

  private error(code: MilestoneDocumentsErrorCode): DomainException {
    return new DomainException(MILESTONE_DOCUMENTS_ERROR_CODES[code]);
  }
}

const MILESTONE_DOCUMENT_COLLECTION_DEFAULT_PAGE_SIZE = 20;

export interface MilestoneDocumentCollectionRequest {
  readonly page?: number;
  readonly pageSize?: number;
  readonly filter?: MilestoneDocumentCollectionFilter;
  readonly deliveryStatus?: DocumentDeliveryStatus;
  readonly documentId?: string;
  readonly submissionState?: 'ALL' | 'SUBMITTED' | 'MISSING';
}

@Injectable()
export class MilestoneDocumentCollectionService {
  documentDeliveryStatus(input: {
    readonly requiredFirstSubmissions: readonly (Date | null)[];
    readonly dueAt: Date | null;
  }): DocumentDeliveryStatus {
    if (input.requiredFirstSubmissions.length === 0) return 'NO_REQUIRED_ITEMS';
    if (
      input.requiredFirstSubmissions.some((submittedAt) => submittedAt === null)
    )
      return 'MISSING';
    const dueAt = input.dueAt;
    if (
      dueAt !== null &&
      input.requiredFirstSubmissions.some(
        (submittedAt) => submittedAt !== null && submittedAt > dueAt,
      )
    )
      return 'LATE';
    return 'COMPLETE';
  }

  readMilestoneDocumentSubmittedContent(
    stored: unknown,
  ): MilestoneDocumentSubmittedContent | null {
    if (typeof stored !== 'object' || stored === null) return null;
    const content = stored as Record<string, unknown>;
    switch (content.type) {
      case MilestoneSubmissionType.TEXT:
        return typeof content.text === 'string'
          ? { type: MilestoneSubmissionType.TEXT, text: content.text }
          : null;
      default:
        return null;
    }
  }

  buildMilestoneDocumentCollectionPage<
    TDocument extends MilestoneDocumentCollectionDocumentRule,
    TApplication extends MilestoneDocumentCollectionApplicationRule,
    TSubmission extends MilestoneDocumentCollectionSubmissionRule,
  >(
    documents: readonly TDocument[],
    applications: readonly TApplication[],
    submissions: readonly TSubmission[],
    query: MilestoneDocumentCollectionQuery,
  ): MilestoneDocumentCollectionPage<TApplication, TSubmission> {
    const cellIndex = new Map<string, TSubmission>();
    for (const submission of submissions) {
      cellIndex.set(
        cellKey(submission.applicationId, submission.milestoneDocumentId),
        submission,
      );
    }

    const allRows: readonly MilestoneDocumentCollectionPageRow<
      TApplication,
      TSubmission
    >[] = applications.map((application) => ({
      application,
      cells: documents.map(
        (document) =>
          cellIndex.get(cellKey(application.applicationId, document.id)) ??
          null,
      ),
    }));

    const documentTotals = documents.map((document, index) => ({
      documentId: document.id,
      submitted: allRows.filter((row) => isSubmittedAt(row, index)).length,
      total: allRows.length,
    }));
    const filterCounts = {
      all: allRows.length,
      hasMissing: allRows.filter((row) => hasMissingRequired(row, documents))
        .length,
      zeroSubmission: allRows.filter((row) => hasZeroSubmission(row, documents))
        .length,
    };

    const filtered = allRows.filter((row) =>
      matchesFilter(row, documents, query.filter),
    );
    const offset = (query.page - 1) * query.pageSize;
    return {
      rows: filtered.slice(offset, offset + query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total: filtered.length,
      filterCounts,
      documentTotals,
    };
  }

  toMilestoneDocumentCollectionCell(
    submission: MilestoneDocumentCollectionSubmission,
  ): MilestoneDocumentCollectionCell {
    return {
      ...submission,
      content: this.readMilestoneDocumentSubmittedContent(submission.content),
    };
  }

  constructor(
    private readonly repository: MilestoneDocumentCollectionReadRepository,
  ) {}

  collectionQueryFromRequest(
    request: MilestoneDocumentCollectionRequest,
  ): MilestoneDocumentDeliveryQuery {
    return {
      page: request.page ?? 1,
      pageSize:
        request.pageSize ?? MILESTONE_DOCUMENT_COLLECTION_DEFAULT_PAGE_SIZE,
      filter: request.filter ?? 'ALL',
      ...(request.documentId === undefined
        ? {}
        : {
            document: {
              id: request.documentId,
              submissionState: request.submissionState ?? 'ALL',
            },
          }),
      ...(request.deliveryStatus === undefined
        ? {}
        : { deliveryStatus: request.deliveryStatus }),
    };
  }

  collectForStaffFromRequest(
    milestoneId: string,
    request: MilestoneDocumentCollectionRequest,
  ): Promise<MilestoneDocumentDeliveryCollectionResult> {
    return this.collectForStaff(
      milestoneId,
      this.collectionQueryFromRequest(request),
    );
  }

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
          this.toMilestoneDocumentCollectionCell(submission),
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
    const base = this.buildMilestoneDocumentCollectionPage(
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
      deliveryStatus: this.documentDeliveryStatus({
        dueAt: source.dueAt,
        requiredFirstSubmissions: source.documents.flatMap((document, index) =>
          document.required ? [row.cells[index]?.firstSubmittedAt ?? null] : [],
        ),
      }),
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

function cellKey(applicationId: string, documentId: string): string {
  return `${applicationId}::${documentId}`;
}

function isSubmittedAt(
  row: MilestoneDocumentCollectionPageRow<
    MilestoneDocumentCollectionApplicationRule,
    MilestoneDocumentCollectionSubmissionRule
  >,
  index: number,
): boolean {
  return (row.cells[index] ?? null) !== null;
}

function hasMissingRequired(
  row: MilestoneDocumentCollectionPageRow<
    MilestoneDocumentCollectionApplicationRule,
    MilestoneDocumentCollectionSubmissionRule
  >,
  documents: readonly MilestoneDocumentCollectionDocumentRule[],
): boolean {
  return documents.some(
    (document, index) => document.required && !isSubmittedAt(row, index),
  );
}

function hasZeroSubmission(
  row: MilestoneDocumentCollectionPageRow<
    MilestoneDocumentCollectionApplicationRule,
    MilestoneDocumentCollectionSubmissionRule
  >,
  documents: readonly MilestoneDocumentCollectionDocumentRule[],
): boolean {
  return documents.length > 0 && row.cells.every((cell) => cell === null);
}

function matchesFilter(
  row: MilestoneDocumentCollectionPageRow<
    MilestoneDocumentCollectionApplicationRule,
    MilestoneDocumentCollectionSubmissionRule
  >,
  documents: readonly MilestoneDocumentCollectionDocumentRule[],
  filter: MilestoneDocumentCollectionQuery['filter'],
): boolean {
  switch (filter) {
    case 'HAS_MISSING':
      return hasMissingRequired(row, documents);
    case 'ZERO_SUBMISSION':
      return hasZeroSubmission(row, documents);
    case 'ALL':
      return true;
  }
}

export interface MilestoneDocumentCollectionQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly filter: MilestoneDocumentCollectionFilter;
}

export interface MilestoneDocumentCollectionDocumentRule {
  readonly id: string;
  readonly required: boolean;
}

export interface MilestoneDocumentCollectionApplicationRule {
  readonly applicationId: string;
}

export interface MilestoneDocumentCollectionSubmissionRule {
  readonly applicationId: string;
  readonly milestoneDocumentId: string;
}

interface MilestoneDocumentCollectionPageRow<
  TApplication extends MilestoneDocumentCollectionApplicationRule,
  TSubmission extends MilestoneDocumentCollectionSubmissionRule,
> {
  readonly application: TApplication;
  readonly cells: readonly (TSubmission | null)[];
}

interface MilestoneDocumentCollectionFilterCounts {
  readonly all: number;
  readonly hasMissing: number;
  readonly zeroSubmission: number;
}

interface MilestoneDocumentCollectionDocumentTotal {
  readonly documentId: string;
  readonly submitted: number;
  readonly total: number;
}

export interface MilestoneDocumentCollectionPage<
  TApplication extends MilestoneDocumentCollectionApplicationRule,
  TSubmission extends MilestoneDocumentCollectionSubmissionRule,
> {
  readonly rows: readonly MilestoneDocumentCollectionPageRow<
    TApplication,
    TSubmission
  >[];
  readonly page: number;
  readonly pageSize: number;

  readonly total: number;
  readonly filterCounts: MilestoneDocumentCollectionFilterCounts;
  readonly documentTotals: readonly MilestoneDocumentCollectionDocumentTotal[];
}

export type MilestoneDocumentCollectionCell = Omit<
  MilestoneDocumentCollectionSubmission,
  'content'
> & {
  readonly content: MilestoneDocumentSubmittedContent | null;
};

export type MilestoneDocumentCollectionFilter =
  (typeof MILESTONE_DOCUMENT_COLLECTION_FILTERS)[number];

export const MILESTONE_DOCUMENT_COLLECTION_FILTERS = [
  'ALL',
  'HAS_MISSING',
  'ZERO_SUBMISSION',
] as const;
