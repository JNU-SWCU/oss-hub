import {
  MilestoneSubmissionType,
  MilestoneDocumentSubmissionHistoryEvent,
  SubmissionStatus,
  ReviewDecision,
} from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';
import { UsersAuthorityService } from '../users/users-authority.service';
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
  MilestoneDocumentCollectionSubmission,
  MilestoneContext,
  MilestoneDocumentSubmittedContent,
  DocumentDeliveryStatus,
  MilestoneDocumentContentInput,
  ProgramDocumentChangeRequestCandidate,
  ProgramDocumentChangeRequestInput,
  ProgramDocumentChangeRequestScope,
  type MilestoneDocumentSubmissionDetail,
  type UpsertMilestoneDocumentInput,
} from './milestone-document-collection-read.repository';
import { hasProgramDeadlinePassed } from './programs.service';
import { createHash } from 'node:crypto';
import { addOneCalendarYear } from './submission-file.config';

export function documentDeliveryStatus(input: {
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

export function readMilestoneDocumentSubmittedContent(
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

export function parseMilestoneDocumentContent(input: {
  readonly fileId?: string;
  readonly text?: string;
}): MilestoneDocumentContentInput {
  const text = input.text?.trim() || null;
  const fileId = input.fileId?.trim() || null;
  if (text === null && fileId === null) throw contentRequired();
  return { text, fileId };
}

function contentRequired(): DomainException {
  return new DomainException(
    MILESTONE_DOCUMENTS_ERROR_CODES[
      MilestoneDocumentsErrorCode.CONTENT_REQUIRED
    ],
  );
}

export function reviewDecisionToSubmissionStatus(
  decision: ReviewDecision,
): SubmissionStatus {
  switch (decision) {
    case ReviewDecision.APPROVED:
      return SubmissionStatus.APPROVED;
    case ReviewDecision.CHANGES_REQUESTED:
      return SubmissionStatus.CHANGES_REQUESTED;
    case ReviewDecision.REJECTED:
      return SubmissionStatus.REJECTED;
  }
}

export function isResubmissionAllowedAfter(
  latestDecision: ReviewDecision | null,
): boolean {
  if (latestDecision === null) return true;
  switch (latestDecision) {
    case ReviewDecision.APPROVED:
    case ReviewDecision.REJECTED:
      return false;
    case ReviewDecision.CHANGES_REQUESTED:
      return true;
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

export function changeRequestTargetStatuses(
  includeFinalDecisions: boolean,
): readonly SubmissionStatus[] {
  return includeFinalDecisions
    ? [...OPEN_STATUSES, ...FINAL_STATUSES]
    : OPEN_STATUSES;
}

export function changeRequestTargetsVersion(
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

export function toProgramDocumentChangeRequestScope(
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

export function toProgramDocumentChangeRequestInput(body: {
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
    scope: toProgramDocumentChangeRequestScope(body.scope, body.teamId),
    includeFinalDecisions: body.includeFinalDecisions,
    comment,
    resubmissionDueAt,
    expectedVersion: body.expectedVersion,
  };
}

export const MILESTONE_DOCUMENT_COLLECTION_FILTERS = [
  'ALL',
  'HAS_MISSING',
  'ZERO_SUBMISSION',
] as const;

export type MilestoneDocumentCollectionFilter =
  (typeof MILESTONE_DOCUMENT_COLLECTION_FILTERS)[number];

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

export function buildMilestoneDocumentCollectionPage<
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
        cellIndex.get(cellKey(application.applicationId, document.id)) ?? null,
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

export type MilestoneDocumentCollectionCell = Omit<
  MilestoneDocumentCollectionSubmission,
  'content'
> & {
  readonly content: MilestoneDocumentSubmittedContent | null;
};

export function toMilestoneDocumentCollectionCell(
  submission: MilestoneDocumentCollectionSubmission,
): MilestoneDocumentCollectionCell {
  return {
    ...submission,
    content: readMilestoneDocumentSubmittedContent(submission.content),
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

export type MilestoneDocumentSubmissionBlock =
  | 'MILESTONE_CLOSED'
  | 'SUBMISSION_REPLACEMENT_CLOSED'
  | 'RESUBMISSION_NOT_ALLOWED'
  | 'RESUBMISSION_ALREADY_USED'
  | 'RESUBMISSION_DUE_AT_PASSED';

export function hasMilestoneDocumentResubmissionDueAtPassed(
  resubmissionDueAt: Date | null,
  now: Date,
): boolean {
  if (resubmissionDueAt === null) return false;
  return hasProgramDeadlinePassed(resubmissionDueAt, now);
}

export function isChangeRequestResubmissionOpen({
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

export function isPostDeadlineResubmissionOpen({
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
    isChangeRequestResubmissionOpen({ latestDecision, submissionStatus }) &&
    !hasMilestoneDocumentResubmissionDueAtPassed(resubmissionDueAt, now)
  );
}

export function milestoneDocumentSubmissionBlock({
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
  if (!hasProgramDeadlinePassed(dueAt, now)) return null;
  if (
    isPostDeadlineResubmissionOpen({
      latestDecision,
      submissionStatus,
      resubmissionDueAt,
      now,
    })
  ) {
    return null;
  }

  if (isChangeRequestResubmissionOpen({ latestDecision, submissionStatus })) {
    return 'RESUBMISSION_DUE_AT_PASSED';
  }

  if (latestDecision === ReviewDecision.CHANGES_REQUESTED && hasSubmission) {
    return 'RESUBMISSION_ALREADY_USED';
  }
  if (
    latestDecision === null &&
    graceDueAt !== null &&
    !hasProgramDeadlinePassed(graceDueAt, now)
  )
    return null;
  return hasSubmission ? 'SUBMISSION_REPLACEMENT_CLOSED' : 'MILESTONE_CLOSED';
}

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
    sessionGithubId: bigint,
    milestoneId: string,
    query: MilestoneDocumentCollectionQuery,
    now: Date = new Date(),
  ): Promise<MilestoneDocumentCollectionResult> {
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
          toMilestoneDocumentCollectionCell(submission),
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
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
    applicationId: string,
    query: { readonly cursor: string | null; readonly limit: number },
  ): Promise<MilestoneDocumentHistoryResult> {
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
        createdAt: item.createdAt,
        fileName: item.fileName,
        downloadableFileId: item.downloadableFileId,
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
  ): Promise<MilestoneDocumentRecord> {
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
    return record;
  }

  async updateDocument(
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
    input: UpsertMilestoneDocumentInput,
  ): Promise<MilestoneDocumentRecord> {
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
    return record;
  }

  async updateGraceDueAt(
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
    graceDueAt: Date | null,
  ): Promise<void> {
    await this.authority.assertActiveStaff(sessionGithubId, () =>
      this.error(MilestoneDocumentsErrorCode.STAFF_ONLY),
    );
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
            addOneCalendarYear(milestone.programEndAt).getTime())
      )
        throw this.error(MilestoneDocumentsErrorCode.INVALID_GRACE_DUE_AT);
      await store.updateGraceDueAt(documentId, graceDueAt);
    });
  }

  async reorderDocuments(
    sessionGithubId: bigint,
    milestoneId: string,
    documentIds: readonly string[],
  ): Promise<MilestoneDocumentRecord[]> {
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
    return records;
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
    const blocked = milestoneDocumentSubmissionBlock({
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
