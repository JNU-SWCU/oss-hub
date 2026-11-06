import { type Response } from 'express';
import { DownloadResponseService } from './download-response.service';
import { Inject, Injectable, StreamableFile, Logger } from '@nestjs/common';
import {
  RequirementSubmissionType,
  type SubmissionStatus,
} from '@prisma/client';
import { type Readable } from 'node:stream';
import { DomainException } from '../platform/error-code.error';
import { type ObjectStoragePort } from '../platform/object-storage.types';
import { OBJECT_STORAGE } from '../platform/object-storage.config';
import {
  MilestoneDocumentCurrentFileRepository,
  type MilestoneDocumentCurrentFileReader,
  MilestoneDocumentCollectionReadRepository,
  type DocumentDeliveryStatus,
  MilestoneDocumentCollectionApplication,
  MilestoneContext,
  MilestoneDocumentRecord,
  MilestoneDocumentCollectionSubmission,
  MilestoneDocumentSubmittedContent,
  RequirementsRepository,
  MilestoneDocumentArchiveRepository,
  type ProgramArchiveReader,
  MilestoneDocumentArchiveDocument,
  MilestoneDocumentArchiveTeam,
  MilestoneDocumentArchiveSubmission,
  ArchiveProgram,
} from './requirements.repository';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.error';
import {
  SubmissionFileAdmissionService,
  MilestoneDocumentFileNameService,
} from './files.service';
import { ZipFile } from 'yazl';
import { MilestoneDocumentArchiveEntryError } from './milestone-document-archive.error';
export interface MilestoneDocumentDeliveryQuery extends MilestoneDocumentCollectionQuery {
  readonly scope?: 'all';
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
  readonly scope?: 'all';
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
      case RequirementSubmissionType.TEXT:
        return typeof content.text === 'string'
          ? { type: RequirementSubmissionType.TEXT, text: content.text }
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
        cellKey(submission.teamId, submission.milestoneDocumentId),
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
          cellIndex.get(cellKey(application.teamId, document.id)) ?? null,
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
      ...(request.scope === undefined ? {} : { scope: request.scope }),
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
        applications.map((application) => application.teamId),
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
        page.rows.map((row) => row.application.teamId),
        now,
      );
      const detailByCell = new Map(
        details.map((submission) => [
          `${submission.teamId}::${submission.milestoneDocumentId}`,
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
              detailByCell.get(`${row.application.teamId}::${document.id}`) ??
              null,
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

function cellKey(teamId: string, documentId: string): string {
  return `${teamId}::${documentId}`;
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
  readonly teamId: string;
}

export interface MilestoneDocumentCollectionSubmissionRule {
  readonly teamId: string;
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
export type MilestoneDocumentArchiveGrouping = 'TEAM' | 'DOCUMENT';

export const MILESTONE_DOCUMENT_ARCHIVE_GROUPINGS: readonly MilestoneDocumentArchiveGrouping[] =
  ['TEAM', 'DOCUMENT'];

export type MilestoneDocumentArchiveLayout =
  MilestoneDocumentArchiveGrouping | 'FLAT';

const MILESTONE_DOCUMENT_ARCHIVE_MANIFEST_FILE_NAME = '제출현황.csv';

type MilestoneDocumentArchiveEntry =
  | {
      readonly kind: 'STORED_FILE';
      readonly path: string;

      readonly modifiedAt: Date;
      readonly storageKey: string;
      readonly sizeBytes: number;
    }
  | {
      readonly kind: 'INLINE_TEXT';
      readonly path: string;
      readonly modifiedAt: Date;
      readonly body: string;
    };

export type MilestoneDocumentArchiveCellState =
  'NOT_SUBMITTED' | SubmissionStatus;

type MilestoneDocumentArchiveOmission =
  | 'FILE_UNAVAILABLE'
  | 'CONTENT_UNAVAILABLE'
  | 'CONTENT_AND_FILE_UNAVAILABLE'
  | 'SUBMISSION_UNAVAILABLE';

export interface MilestoneDocumentArchiveCell {
  readonly documentId: string;
  readonly state: MilestoneDocumentArchiveCellState;
  readonly submittedAt: Date | null;

  readonly path: string | null;
  readonly omission: MilestoneDocumentArchiveOmission | null;
}

export interface MilestoneDocumentArchiveManifestRow {
  readonly team: MilestoneDocumentArchiveTeam;
  readonly cells: readonly MilestoneDocumentArchiveCell[];
}

export interface MilestoneDocumentArchivePlan {
  readonly entries: readonly MilestoneDocumentArchiveEntry[];
  readonly manifest: readonly MilestoneDocumentArchiveManifestRow[];

  readonly storedBytes: number;

  readonly inlineBytes: number;
}

export interface BuildMilestoneDocumentArchivePlanInput {
  readonly documents: readonly MilestoneDocumentArchiveDocument[];
  readonly teams: readonly MilestoneDocumentArchiveTeam[];
  readonly submissions: readonly MilestoneDocumentArchiveSubmission[];
  readonly layout: MilestoneDocumentArchiveLayout;
}

function archiveOmissionLabel(
  omission: MilestoneDocumentArchiveOmission,
): string {
  switch (omission) {
    case 'FILE_UNAVAILABLE':
      return '(첨부를 가져올 수 없음)';
    case 'CONTENT_UNAVAILABLE':
      return '(내용 없음)';
    case 'CONTENT_AND_FILE_UNAVAILABLE':
      return '(내용 없음 · 첨부를 가져올 수 없음)';
    case 'SUBMISSION_UNAVAILABLE':
      return '(제출 내용을 가져올 수 없음)';
  }
}

function uniquePath(path: string, taken: Set<string>): string {
  if (!taken.has(collisionKey(path))) {
    taken.add(collisionKey(path));
    return path;
  }
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');

  const hasExtension = dot > slash + 1;
  const stem = hasExtension ? path.slice(0, dot) : path;
  const extension = hasExtension ? path.slice(dot) : '';
  for (let ordinal = 2; ; ordinal += 1) {
    const candidate = `${stem} (${ordinal})${extension}`;
    if (!taken.has(collisionKey(candidate))) {
      taken.add(collisionKey(candidate));
      return candidate;
    }
  }
}

function collisionKey(path: string): string {
  return path.normalize('NFC').toLowerCase();
}

function archiveDocumentsWithStageNames(
  milestones: ArchiveProgram['milestones'],
  isSingleMilestone: boolean,
): readonly MilestoneDocumentArchiveDocument[] {
  return milestones.flatMap((milestone) =>
    milestone.requirements.map((document) => ({
      ...document,
      name: isSingleMilestone
        ? document.name
        : `${milestone.name} - ${document.name}`,
    })),
  );
}

const CELL_STATE_LABELS: Readonly<
  Record<MilestoneDocumentArchiveCellState, string>
> = {
  NOT_SUBMITTED: '미제출',
  SUBMITTED: '검토 대기',
  APPROVED: '승인',
  CHANGES_REQUESTED: '보완 요청',
  REJECTED: '반려',
};

const OMISSION_LABELS: Readonly<
  Record<MilestoneDocumentArchiveOmission, string>
> = {
  FILE_UNAVAILABLE: '(첨부를 가져올 수 없음)',
  CONTENT_UNAVAILABLE: '(내용 없음)',
  CONTENT_AND_FILE_UNAVAILABLE: '(내용 없음 · 첨부를 가져올 수 없음)',
  SUBMISSION_UNAVAILABLE: '(제출 내용을 가져올 수 없음)',
};

const BOM = '\uFEFF';

const ROW_SEPARATOR = '\r\n';

const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

export interface MilestoneDocumentArchiveManifestCsvInput {
  readonly documents: readonly MilestoneDocumentArchiveDocument[];
  readonly rows: readonly MilestoneDocumentArchiveManifestRow[];
}

function cellOf(
  cells: readonly MilestoneDocumentArchiveCell[],
  documentId: string,
): MilestoneDocumentArchiveCell | null {
  return cells.find((cell) => cell.documentId === documentId) ?? null;
}

function cellColumns(cell: MilestoneDocumentArchiveCell | null): string[] {
  if (cell === null) return ['', '', ''];
  return [
    CELL_STATE_LABELS[cell.state],
    cell.submittedAt === null ? '' : formatSeoulDateTime(cell.submittedAt),
    cell.path ?? (cell.omission === null ? '' : OMISSION_LABELS[cell.omission]),
  ];
}

function formatSeoulDateTime(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',

    hourCycle: 'h23',
  }).formatToParts(value);
  const at = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${at('year')}-${at('month')}-${at('day')} ${at('hour')}:${at('minute')}`;
}

function csvField(value: string): string {
  const guarded = FORMULA_TRIGGERS.has(value.charAt(0)) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded)
    ? `"${guarded.replace(/"/g, '""')}"`
    : guarded;
}

export type MilestoneDocumentArchiveScope =
  | {
      readonly kind: 'ALL';
      readonly grouping: MilestoneDocumentArchiveGrouping;
    }
  | { readonly kind: 'DOCUMENT'; readonly documentId: string };

export type ProgramDocumentArchiveScope = (
  | { readonly kind: 'PROGRAM' }
  | { readonly kind: 'MILESTONE'; readonly milestoneId: string }
  | { readonly kind: 'TEAM'; readonly teamId: string }
) & { readonly grouping?: MilestoneDocumentArchiveGrouping };

export interface MilestoneDocumentArchive {
  readonly body: Readable;
  readonly fileName: string;
  readonly contentType: 'application/zip';

  readonly contentLength: number | null;
}

const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;

interface ZipFileFinalSize {
  end(
    options: { forceZip64Format: boolean; comment: string },
    onFinalSize: (finalSize: number) => void,
  ): void;
}

const archiveLogger = new Logger('MilestoneDocumentArchive');

const programArchiveLogger = new Logger('ProgramDocumentArchivesController');

function failedStorageKey(error: Error): string {
  return error instanceof MilestoneDocumentArchiveEntryError
    ? error.storageKey
    : 'unknown';
}

@Injectable()
export class RequirementArchiveService {
  constructor(
    private readonly repository: RequirementsRepository,
    @Inject(OBJECT_STORAGE)
    private readonly storage: ObjectStoragePort,
    @Inject(MilestoneDocumentArchiveRepository)
    private readonly programs: ProgramArchiveReader,
    private readonly milestoneDocumentCollectionService: MilestoneDocumentCollectionService,
    private readonly milestoneDocumentFileNameService: MilestoneDocumentFileNameService,
    private readonly downloadResponseService: DownloadResponseService,
  ) {}

  async streamArchiveForStaff(
    response: Response,
    milestoneId: string,
    request: Parameters<
      RequirementArchiveService['milestoneArchiveScopeFromRequest']
    >[0],
  ): Promise<StreamableFile> {
    const scope = this.milestoneArchiveScopeFromRequest(request);
    const archive = await this.archiveForStaff(milestoneId, scope);
    this.downloadResponseService.setDownloadHeaders(response, archive);

    response.once('close', () => archive.body.destroy());

    return new StreamableFile(archive.body).setErrorHandler((error) => {
      archiveLogger.error(
        `서류 일괄 내려받기가 압축 도중 실패했다: milestoneId=${milestoneId} scope=${scope.kind} storageKey=${failedStorageKey(error)} error=${error.message}`,
      );
      this.downloadResponseService.respondWithDownloadFailure(
        response,
        MILESTONE_DOCUMENTS_ERROR_CODES[
          MilestoneDocumentsErrorCode.FILE_STORAGE_UNAVAILABLE
        ],
        'END',
      );
    });
  }

  async streamArchiveForProgramStaff(
    response: Response,
    programId: string,
    request: Parameters<
      RequirementArchiveService['programArchiveScopeFromRequest']
    >[0],
  ): Promise<StreamableFile> {
    const scope = this.programArchiveScopeFromRequest(request);
    const archive = await this.archiveForProgramStaff(programId, scope);
    this.downloadResponseService.setDownloadHeaders(response, archive);
    response.once('close', () => archive.body.destroy());

    return new StreamableFile(archive.body).setErrorHandler((error) => {
      programArchiveLogger.error(
        `Program archive failed: programId=${programId} scope=${scope.kind}`,
        error.stack,
      );
      this.downloadResponseService.respondWithDownloadFailure(
        response,
        MILESTONE_DOCUMENTS_ERROR_CODES[
          MilestoneDocumentsErrorCode.FILE_STORAGE_UNAVAILABLE
        ],
        'DESTROY',
      );
    });
  }

  programArchiveScopeFromRequest(request: {
    readonly scope: ProgramDocumentArchiveScope['kind'];
    readonly groupBy?: 'TEAM' | 'DOCUMENT';
    readonly milestoneId?: string;
    readonly teamId?: string;
  }): ProgramDocumentArchiveScope {
    const grouping =
      request.groupBy === undefined ? {} : { grouping: request.groupBy };
    if (
      request.scope === 'PROGRAM' &&
      request.milestoneId === undefined &&
      request.teamId === undefined
    ) {
      return { kind: 'PROGRAM', ...grouping };
    }
    if (
      request.scope === 'MILESTONE' &&
      request.milestoneId !== undefined &&
      request.teamId === undefined
    ) {
      return {
        kind: 'MILESTONE',
        milestoneId: request.milestoneId,
        ...grouping,
      };
    }
    if (
      request.scope === 'TEAM' &&
      request.teamId !== undefined &&
      request.milestoneId === undefined
    ) {
      return { kind: 'TEAM', teamId: request.teamId, ...grouping };
    }
    throw new DomainException(
      MILESTONE_DOCUMENTS_ERROR_CODES[
        MilestoneDocumentsErrorCode.INVALID_REQUEST
      ],
    );
  }

  milestoneArchiveScopeFromRequest(request: {
    readonly groupBy?: MilestoneDocumentArchiveGrouping;
    readonly documentId?: string;
  }): MilestoneDocumentArchiveScope {
    if (request.documentId === undefined) {
      return { kind: 'ALL', grouping: request.groupBy ?? 'TEAM' };
    }
    if (request.groupBy !== undefined) {
      throw new DomainException(
        MILESTONE_DOCUMENTS_ERROR_CODES[
          MilestoneDocumentsErrorCode.INVALID_REQUEST
        ],
      );
    }
    return { kind: 'DOCUMENT', documentId: request.documentId };
  }

  async archiveForProgramStaff(
    programId: string,
    scope: ProgramDocumentArchiveScope,
    now: Date = new Date(),
  ): Promise<MilestoneDocumentArchive> {
    const program = await this.programs.findProgram(programId);
    if (program === null) {
      throw this.error(MilestoneDocumentsErrorCode.PROGRAM_NOT_FOUND);
    }
    const milestones =
      scope.kind === 'MILESTONE'
        ? program.milestones.filter((item) => item.id === scope.milestoneId)
        : program.milestones;
    if (scope.kind === 'MILESTONE' && milestones.length === 0) {
      throw this.error(MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND);
    }
    const teams = await this.programs.findApprovedTeams(
      programId,
      scope.kind === 'TEAM' ? scope.teamId : undefined,
    );
    if (scope.kind === 'TEAM' && teams.length === 0) {
      throw this.error(MilestoneDocumentsErrorCode.ARCHIVE_TEAM_NOT_FOUND);
    }
    const documents = archiveDocumentsWithStageNames(
      milestones,
      scope.kind === 'MILESTONE',
    );
    const submissions = await this.repository.findSubmissionsForArchive(
      documents.map((document) => document.id),
      now,
    );
    const plan = this.buildMilestoneDocumentArchivePlan({
      documents,
      teams,
      submissions,
      layout: scope.grouping ?? 'TEAM',
    });
    const milestone = milestones[0];
    const fileName =
      scope.kind === 'MILESTONE' && milestone !== undefined
        ? this.archiveFileName(milestone.name, milestone.dueAt)
        : `${this.milestoneDocumentFileNameService.milestoneDocumentArchiveFolderName(`${program.name}_${scope.kind === 'TEAM' ? teams[0]?.teamName : '전체'}`)}_현재제출.zip`;
    return this.createArchive(documents, plan, fileName, now);
  }

  async archiveForStaff(
    milestoneId: string,
    scope: MilestoneDocumentArchiveScope,
    now: Date = new Date(),
  ): Promise<MilestoneDocumentArchive> {
    const milestone = await this.repository.findMilestone(milestoneId);
    if (milestone === null) {
      throw this.error(MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND);
    }

    const [allDocuments, teams] = await Promise.all([
      this.repository.findByMilestoneId(milestoneId),
      this.repository.findApprovedApplicationsForCollection(
        milestone.programId,
      ),
    ]);

    const documents =
      scope.kind === 'DOCUMENT'
        ? allDocuments.filter((document) => document.id === scope.documentId)
        : allDocuments;
    if (scope.kind === 'DOCUMENT' && documents.length === 0) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }

    const submissions = await this.repository.findSubmissionsForArchive(
      documents.map((document) => document.id),
      now,
    );

    const plan = this.buildMilestoneDocumentArchivePlan({
      documents,
      teams,
      submissions,
      layout: scope.kind === 'DOCUMENT' ? 'FLAT' : scope.grouping,
    });
    return this.createArchive(
      documents,
      plan,
      this.archiveFileName(
        scope.kind === 'DOCUMENT'
          ? (documents[0]?.name ?? milestone.name)
          : milestone.name,
        milestone.dueAt,
      ),
      now,
    );
  }

  private createArchive(
    documents: readonly MilestoneDocumentArchiveDocument[],
    plan: MilestoneDocumentArchivePlan,
    fileName: string,
    now: Date,
  ): MilestoneDocumentArchive {
    if (plan.storedBytes + plan.inlineBytes > MAX_ARCHIVE_BYTES) {
      throw this.error(MilestoneDocumentsErrorCode.ARCHIVE_TOO_LARGE);
    }

    const zip = new ZipFile();

    const output = zip.outputStream as Readable;

    zip.on('error', (error: unknown) => {
      output.destroy(error instanceof Error ? error : new Error(String(error)));
    });

    output.on('error', () => undefined);

    let activeBody: Readable | null = null;
    output.once('close', () => {
      activeBody?.destroy();
      activeBody = null;
    });

    zip.addBuffer(
      Buffer.from(
        this.milestoneDocumentArchiveManifestCsv({
          documents,
          rows: plan.manifest,
        }),
        'utf8',
      ),
      MILESTONE_DOCUMENT_ARCHIVE_MANIFEST_FILE_NAME,
      { mtime: now, compress: false },
    );

    for (const entry of plan.entries) {
      if (entry.kind === 'INLINE_TEXT') {
        zip.addBuffer(Buffer.from(entry.body, 'utf8'), entry.path, {
          mtime: entry.modifiedAt,
          compress: false,
        });
        continue;
      }

      zip.addReadStreamLazy(
        entry.path,
        { mtime: entry.modifiedAt, size: entry.sizeBytes, compress: false },
        (openStream) => {
          if (output.destroyed) {
            openStream(new Error('archive stream closed'), undefined as never);
            return;
          }
          this.storage.get(entry.storageKey).then(
            (body) => {
              if (output.destroyed) {
                body.destroy();
                openStream(
                  new Error('archive stream closed'),
                  undefined as never,
                );
                return;
              }

              body.once('error', (error: unknown) => {
                output.destroy(
                  new MilestoneDocumentArchiveEntryError(
                    entry.storageKey,
                    error,
                  ),
                );
              });
              activeBody = body;
              body.once('close', () => {
                if (activeBody === body) activeBody = null;
              });
              openStream(null, body);
            },

            (error: unknown) =>
              openStream(
                new MilestoneDocumentArchiveEntryError(entry.storageKey, error),
                undefined as never,
              ),
          );
        },
      );
    }

    let contentLength: number | null = null;
    (zip as unknown as ZipFileFinalSize).end(
      {
        forceZip64Format: needsZip64Eocd([
          MILESTONE_DOCUMENT_ARCHIVE_MANIFEST_FILE_NAME,
          ...plan.entries.map((entry) => entry.path),
        ]),
        comment: '',
      },
      (finalSize) => {
        contentLength = finalSize;
      },
    );

    return {
      body: output,
      fileName,
      contentType: 'application/zip',
      contentLength,
    };
  }

  private error(code: MilestoneDocumentsErrorCode): DomainException {
    return new DomainException(MILESTONE_DOCUMENTS_ERROR_CODES[code]);
  }

  buildMilestoneDocumentArchivePlan(
    input: BuildMilestoneDocumentArchivePlanInput,
  ): MilestoneDocumentArchivePlan {
    const { documents, teams, submissions, layout } = input;

    const cellIndex = new Map<string, MilestoneDocumentArchiveSubmission>();
    for (const submission of submissions) {
      cellIndex.set(
        cellKey(submission.teamId, submission.milestoneDocumentId),
        submission,
      );
    }

    const takenPaths = new Set<string>([
      collisionKey(MILESTONE_DOCUMENT_ARCHIVE_MANIFEST_FILE_NAME),
    ]);
    const entries: MilestoneDocumentArchiveEntry[] = [];
    let storedBytes = 0;
    let inlineBytes = 0;

    const manifest = teams.map((team) => ({
      team,
      cells: documents.map((document) => {
        const submission =
          cellIndex.get(cellKey(team.teamId, document.id)) ?? null;
        if (submission === null) {
          return {
            documentId: document.id,
            state: 'NOT_SUBMITTED' as const,
            submittedAt: null,
            path: null,
            omission: null,
          };
        }

        const state = submission.status;
        const cellEntries = this.buildEntries({
          team,
          document,
          submission,
          layout,
        });
        const omission = this.archiveOmission(submission);
        if (cellEntries.length === 0) {
          return {
            documentId: document.id,
            state,
            submittedAt: submission.submittedAt,
            path: null,
            omission: omission ?? ('SUBMISSION_UNAVAILABLE' as const),
          };
        }

        const paths = cellEntries.map((entry) => {
          const path = uniquePath(entry.path, takenPaths);
          const placed = { ...entry, path };
          entries.push(placed);
          if (placed.kind === 'STORED_FILE') storedBytes += placed.sizeBytes;
          else inlineBytes += Buffer.byteLength(placed.body, 'utf8');
          return path;
        });
        return {
          documentId: document.id,
          state,
          submittedAt: submission.submittedAt,
          path:
            omission === null
              ? paths.join(' · ')
              : `${paths.join(' · ')} · ${archiveOmissionLabel(omission)}`,
          omission,
        };
      }),
    }));

    return { entries, manifest, storedBytes, inlineBytes };
  }

  private archiveOmission(
    submission: MilestoneDocumentArchiveSubmission,
  ): MilestoneDocumentArchiveOmission | null {
    const contentUnavailable =
      submission.content !== null &&
      this.milestoneDocumentCollectionService.readMilestoneDocumentSubmittedContent(
        submission.content,
      ) === null;
    const fileUnavailable =
      submission.hasCurrentFileEvidence && submission.file === null;
    if (contentUnavailable && fileUnavailable)
      return 'CONTENT_AND_FILE_UNAVAILABLE';
    if (contentUnavailable) return 'CONTENT_UNAVAILABLE';
    if (fileUnavailable) return 'FILE_UNAVAILABLE';
    return null;
  }

  private buildEntries(input: {
    readonly team: MilestoneDocumentArchiveTeam;
    readonly document: MilestoneDocumentArchiveDocument;
    readonly submission: MilestoneDocumentArchiveSubmission;
    readonly layout: MilestoneDocumentArchiveLayout;
  }): readonly MilestoneDocumentArchiveEntry[] {
    const { team, document, submission, layout } = input;

    const prefix =
      layout === 'FLAT'
        ? ''
        : `${this.archiveFolderPath(layout === 'TEAM' ? team.teamName : document.name)}/`;

    const entries: MilestoneDocumentArchiveEntry[] = [];
    if (submission.file !== null) {
      const fileName =
        this.milestoneDocumentFileNameService.milestoneDocumentDownloadFileName(
          {
            teamName: team.teamName,
            documentName: document.name,
            originalFileName: submission.file.originalFileName,
          },
        );
      entries.push({
        kind: 'STORED_FILE',
        path: `${prefix}${fileName}`,
        modifiedAt: submission.submittedAt,
        storageKey: submission.file.storageKey,
        sizeBytes: submission.file.sizeBytes,
      });
    }

    const content =
      this.milestoneDocumentCollectionService.readMilestoneDocumentSubmittedContent(
        submission.content,
      );
    if (content !== null) {
      entries.push({
        kind: 'INLINE_TEXT',
        path: `${prefix}${this.milestoneDocumentFileNameService.milestoneDocumentTextEntryFileName(
          {
            teamName: team.teamName,
            documentName: document.name,
          },
        )}`,
        modifiedAt: submission.submittedAt,
        body: content.text,
      });
    }
    return entries;
  }

  private archiveFolderPath(name: string): string {
    const folder =
      this.milestoneDocumentFileNameService.milestoneDocumentArchiveFolderName(
        name,
      );

    return collisionKey(folder) ===
      collisionKey(MILESTONE_DOCUMENT_ARCHIVE_MANIFEST_FILE_NAME)
      ? `${folder} (2)`
      : folder;
  }

  private archiveFileName(name: string, dueAt: Date): string {
    const due = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(dueAt);
    return `${this.milestoneDocumentFileNameService.milestoneDocumentArchiveFolderName(name)}_${due}.zip`;
  }

  milestoneDocumentArchiveManifestCsv(
    input: MilestoneDocumentArchiveManifestCsvInput,
  ): string {
    const header = [
      '팀',
      '신청자',
      '팀원',
      ...input.documents.flatMap((document) => [
        `${document.name} 상태`,
        `${document.name} 제출시각`,
        `${document.name} ZIP 파일`,
      ]),
    ];

    const lines = [
      header,
      ...input.rows.map((row) => [
        row.team.teamName,
        row.team.applicantName ?? '',
        row.team.memberNicknames.join(', '),

        ...input.documents.flatMap((document) =>
          cellColumns(cellOf(row.cells, document.id)),
        ),
      ]),
    ];

    return (
      BOM +
      lines.map((line) => line.map(csvField).join(',')).join(ROW_SEPARATOR) +
      ROW_SEPARATOR
    );
  }
}

function needsZip64Eocd(paths: readonly string[]): boolean {
  const centralDirectoryBytes = paths.reduce(
    (total, path) => total + 46 + Buffer.byteLength(path, 'utf8') + 9,
    0,
  );
  return centralDirectoryBytes >= 0xffff;
}
