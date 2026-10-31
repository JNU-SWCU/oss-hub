import {
  SubmissionStatus,
  MilestoneSubmissionType,
  ReviewDecision,
} from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { DomainException } from '../platform/error-code.error';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.error';
import {
  MilestoneDocumentCollectionSubmission,
  MilestoneDocumentSubmittedContent,
  MilestoneDocumentContentInput,
  DocumentDeliveryStatus,
  ProgramDocumentChangeRequestCandidate,
  ProgramDocumentChangeRequestInput,
  ProgramDocumentChangeRequestScope,
} from './milestone-document-collection-read.repository';
import { createHash } from 'node:crypto';
import { ProgramRulesService } from './program-rules.service';

@Injectable()
export class MilestoneDocumentRulesService {
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

  parseMilestoneDocumentContent(input: {
    readonly fileId?: string;
    readonly text?: string;
  }): MilestoneDocumentContentInput {
    const text = input.text?.trim() || null;
    const fileId = input.fileId?.trim() || null;
    if (text === null && fileId === null) throw contentRequired();
    return { text, fileId };
  }

  reviewDecisionToSubmissionStatus(decision: ReviewDecision): SubmissionStatus {
    switch (decision) {
      case ReviewDecision.APPROVED:
        return SubmissionStatus.APPROVED;
      case ReviewDecision.CHANGES_REQUESTED:
        return SubmissionStatus.CHANGES_REQUESTED;
      case ReviewDecision.REJECTED:
        return SubmissionStatus.REJECTED;
    }
  }

  isResubmissionAllowedAfter(latestDecision: ReviewDecision | null): boolean {
    if (latestDecision === null) return true;
    switch (latestDecision) {
      case ReviewDecision.APPROVED:
      case ReviewDecision.REJECTED:
        return false;
      case ReviewDecision.CHANGES_REQUESTED:
        return true;
    }
  }

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
          `${candidate.milestoneDocumentId}:${candidate.applicationId}:${
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
    readonly comment: string;
    readonly resubmissionDueAt: string;
    readonly expectedVersion: string;
  }): ProgramDocumentChangeRequestInput {
    const comment = body.comment.trim();
    if (comment === '') {
      throw new DomainException(
        MILESTONE_DOCUMENTS_ERROR_CODES[
          MilestoneDocumentsErrorCode.REVIEW_COMMENT_REQUIRED
        ],
      );
    }
    const resubmissionDueAt = new Date(body.resubmissionDueAt);
    if (Number.isNaN(resubmissionDueAt.getTime())) {
      throw new DomainException(
        MILESTONE_DOCUMENTS_ERROR_CODES[
          MilestoneDocumentsErrorCode.RESUBMISSION_DUE_AT_REQUIRED
        ],
      );
    }
    return {
      scope: this.toProgramDocumentChangeRequestScope(body.scope, body.teamId),
      includeFinalDecisions: body.includeFinalDecisions,
      comment,
      resubmissionDueAt,
      expectedVersion: body.expectedVersion,
    };
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

  hasMilestoneDocumentResubmissionDueAtPassed(
    resubmissionDueAt: Date | null,
    now: Date,
  ): boolean {
    if (resubmissionDueAt === null) return false;
    return this.programRulesService.hasProgramDeadlinePassed(
      resubmissionDueAt,
      now,
    );
  }

  isChangeRequestResubmissionOpen({
    latestDecision,
    submissionStatus,
  }: {
    readonly latestDecision: ReviewDecision | null;
    readonly submissionStatus: SubmissionStatus | null;
  }): boolean {
    return (
      latestDecision === ReviewDecision.CHANGES_REQUESTED &&
      submissionStatus === SubmissionStatus.CHANGES_REQUESTED
    );
  }

  isPostDeadlineResubmissionOpen({
    latestDecision,
    submissionStatus,
    resubmissionDueAt,
    now,
  }: {
    readonly latestDecision: ReviewDecision | null;
    readonly submissionStatus: SubmissionStatus | null;
    readonly resubmissionDueAt: Date | null;
    readonly now: Date;
  }): boolean {
    return (
      this.isChangeRequestResubmissionOpen({
        latestDecision,
        submissionStatus,
      }) &&
      !this.hasMilestoneDocumentResubmissionDueAtPassed(resubmissionDueAt, now)
    );
  }

  milestoneDocumentSubmissionBlock({
    dueAt,
    graceDueAt = null,
    now,
    hasSubmission,
    latestDecision,
    submissionStatus,
    resubmissionDueAt,
  }: {
    readonly dueAt: Date;
    readonly graceDueAt?: Date | null;
    readonly now: Date;
    readonly hasSubmission: boolean;
    readonly latestDecision: ReviewDecision | null;

    readonly submissionStatus: SubmissionStatus | null;

    readonly resubmissionDueAt: Date | null;
  }): MilestoneDocumentSubmissionBlock | null {
    if (
      latestDecision === ReviewDecision.APPROVED ||
      latestDecision === ReviewDecision.REJECTED
    ) {
      return 'RESUBMISSION_NOT_ALLOWED';
    }
    if (!this.programRulesService.hasProgramDeadlinePassed(dueAt, now))
      return null;
    if (
      this.isPostDeadlineResubmissionOpen({
        latestDecision,
        submissionStatus,
        resubmissionDueAt,
        now,
      })
    ) {
      return null;
    }

    if (
      this.isChangeRequestResubmissionOpen({ latestDecision, submissionStatus })
    ) {
      return 'RESUBMISSION_DUE_AT_PASSED';
    }

    if (latestDecision === ReviewDecision.CHANGES_REQUESTED && hasSubmission) {
      return 'RESUBMISSION_ALREADY_USED';
    }
    if (
      latestDecision === null &&
      graceDueAt !== null &&
      !this.programRulesService.hasProgramDeadlinePassed(graceDueAt, now)
    )
      return null;
    return hasSubmission ? 'SUBMISSION_REPLACEMENT_CLOSED' : 'MILESTONE_CLOSED';
  }

  milestoneDocumentDownloadFileName(
    input: MilestoneDocumentDownloadFileNameInput,
  ): string {
    return `${baseName(input)}${extensionOf(input.originalFileName)}`;
  }

  milestoneDocumentTextEntryFileName(
    input: Omit<MilestoneDocumentDownloadFileNameInput, 'originalFileName'>,
  ): string {
    return `${baseName(input)}.txt`;
  }

  milestoneDocumentArchiveFolderName(value: string): string {
    const segment = safeSegment(value);

    const stem = segment.split('.')[0] ?? segment;
    return WINDOWS_RESERVED_NAMES.has(normalizeDeviceDigits(stem).toUpperCase())
      ? `${segment}_`
      : segment;
  }

  constructor(private readonly programRulesService: ProgramRulesService) {}
}

function contentRequired(): DomainException {
  return new DomainException(
    MILESTONE_DOCUMENTS_ERROR_CODES[
      MilestoneDocumentsErrorCode.CONTENT_REQUIRED
    ],
  );
}

const OPEN_STATUSES: readonly SubmissionStatus[] = [
  SubmissionStatus.SUBMITTED,
  SubmissionStatus.CHANGES_REQUESTED,
];

const FINAL_STATUSES: readonly SubmissionStatus[] = [
  SubmissionStatus.APPROVED,
  SubmissionStatus.REJECTED,
];

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

const UNSAFE_CHARACTERS = new Set([
  '/',
  '\\',
  ':',
  '*',
  '?',
  '"',
  '<',
  '>',
  '|',
  ';',
  ',',
  "'",
]);

const FALLBACK_SEGMENT = 'file';

const MAX_SEGMENT_UNITS = 100;

const WINDOWS_RESERVED_NAMES: ReadonlySet<string> = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_unused, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_unused, index) => `LPT${index + 1}`),
]);

function normalizeDeviceDigits(value: string): string {
  return value.replace(/[¹²³]/g, (character) =>
    String({ '¹': 1, '²': 2, '³': 3 }[character] ?? character),
  );
}

function baseName(
  input: Omit<MilestoneDocumentDownloadFileNameInput, 'originalFileName'>,
): string {
  return `${safeSegment(input.teamName)}_${safeSegment(input.documentName)}`;
}

function replaceUnsafe(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;

      if (code < 0x20 || code === 0x7f) return '_';
      if (isInvisibleFormatting(code)) return '_';
      return UNSAFE_CHARACTERS.has(character) ? '_' : character;
    })
    .join('');
}

function isInvisibleFormatting(code: number): boolean {
  return (
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

function safeSegment(value: string): string {
  const normalized = truncate(replaceUnsafe(value).replace(/\s+/g, ' ').trim())
    .replace(/\.+$/, '')
    .trim();

  if (normalized.length === 0 || /^\.+$/.test(normalized)) {
    return FALLBACK_SEGMENT;
  }
  return normalized;
}

function truncate(value: string): string {
  if (value.length <= MAX_SEGMENT_UNITS) return value;
  let units = 0;
  let cut = '';
  for (const character of value) {
    if (units + character.length > MAX_SEGMENT_UNITS) break;
    units += character.length;
    cut += character;
  }
  return cut.trim();
}

function extensionOf(originalFileName: string): string {
  const dot = originalFileName.lastIndexOf('.');
  if (dot <= 0 || dot === originalFileName.length - 1) return '';
  const extension = replaceUnsafe(originalFileName.slice(dot + 1)).replace(
    /\s+/g,
    '',
  );
  return extension.length > 0 ? `.${extension}` : '';
}

export interface MilestoneDocumentDownloadFileNameInput {
  readonly teamName: string;
  readonly documentName: string;
  readonly originalFileName: string;
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

export type MilestoneDocumentSubmissionBlock =
  | 'MILESTONE_CLOSED'
  | 'SUBMISSION_REPLACEMENT_CLOSED'
  | 'RESUBMISSION_NOT_ALLOWED'
  | 'RESUBMISSION_ALREADY_USED'
  | 'RESUBMISSION_DUE_AT_PASSED';

export type MilestoneDocumentCollectionFilter =
  (typeof MILESTONE_DOCUMENT_COLLECTION_FILTERS)[number];

export const MILESTONE_DOCUMENT_COLLECTION_FILTERS = [
  'ALL',
  'HAS_MISSING',
  'ZERO_SUBMISSION',
] as const;
