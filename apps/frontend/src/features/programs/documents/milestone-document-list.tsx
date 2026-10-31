'use client';

import { matchQuery, useQueryClient } from '@tanstack/react-query';
import { milestoneDocumentsKey, programKey } from '@/lib/query-keys';
import {
  useMilestoneDocumentsQuery,
  useMilestoneDocumentParticipantHistoryQuery,
} from './queries';
import { Download, Pencil, Upload } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { StatusBadge } from '@/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiError, isUnexpectedApiProblem } from '@/lib/api-client';
import {
  milestoneDocumentTemplateHref,
  submitMilestoneDocument,
  uploadMilestoneDocumentFile,
} from './milestone-document-api';
import type {
  MilestoneDocument,
  MilestoneDocumentSubmissionContent,
  MilestoneDocumentUploadPolicy,
} from './milestone-document-dto';
import {
  isMilestoneDocumentSubmitReviewChanged,
  milestoneDocumentSubmitConflictNotice,
  type MilestoneDocumentReloadResult,
} from './milestone-document-conflict';
import type { MilestoneSubmissionAccess } from './milestone-submission-access';
import { milestoneDocumentSubmitGate } from './milestone-submit-gate';
import {
  isMilestoneDocumentResubmissionFinal,
  MILESTONE_DOCUMENT_REVIEW_DISPLAY_LABELS,
  MILESTONE_DOCUMENT_REVIEW_DISPLAY_VARIANTS,
  milestoneDocumentResubmissionDueNotice,
  milestoneDocumentResubmissionDueTickDelay,
  milestoneDocumentReviewNoticeTone,
  milestoneDocumentViewerDisplay,
  type MilestoneDocumentReviewDisplay,
  type MilestoneDocumentReviewNoticeTone,
} from './milestone-document-review';
import {
  formatSeoulDate,
  isPastDue,
  formatSeoulShortDateTime,
} from '../catalog/program-detail-format';
import { MilestoneDocumentHistoryTimeline } from './milestone-document-history-timeline';
import { MilestoneDocumentResubmissionDialog } from './milestone-document-resubmission-dialog';
import { MilestoneDocumentSubmissionForm } from './milestone-document-submission-form';
import { isMilestoneDocumentArchiveErrorCode } from './milestone-document-upload-policy';
import type { ViewerRole } from '../program-contract';
import { MilestoneDocumentGraceEditor } from './milestone-document-grace-editor';

export type MilestoneDocumentSectionState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | {
      readonly kind: 'ready';
      readonly documents: readonly MilestoneDocument[];

      readonly fileUpload: MilestoneDocumentUploadPolicy;
    };

function isStaffRole(role: ViewerRole): role is 'STAFF' | 'ADMIN' {
  return role === 'STAFF' || role === 'ADMIN';
}

const MILESTONE_DOCUMENT_BLOCK_CLASS = 'grid px-6 pt-1 pb-5';

function ConflictNotice({
  notice,
}: {
  readonly notice: string | null;
}): ReactElement | null {
  if (notice === null) return null;
  return (
    <Alert data-testid="milestone-document-submit-notice">
      <AlertDescription className="break-keep">{notice}</AlertDescription>
    </Alert>
  );
}

export function MilestoneDocumentSectionBody({
  programId,
  state,
  viewerRole,
  closed,
  dueAt,
  submissionAccess,
  conflictNotice,
  onRetry,
  onRefresh = () => Promise.resolve(true),
  onSubmitConflict,
  onSubmitted,
}: {
  readonly programId: string;
  readonly state: MilestoneDocumentSectionState;
  readonly viewerRole: 'STUDENT' | 'STAFF' | 'ADMIN';
  readonly closed: boolean;
  readonly dueAt?: string;

  readonly submissionAccess: MilestoneSubmissionAccess;

  readonly conflictNotice: string | null;
  readonly onRetry: () => void;
  readonly onDocumentChange: (document: MilestoneDocument) => void;
  readonly onRefresh?: () => Promise<boolean>;

  readonly onSubmitConflict: (document: MilestoneDocument) => void;
  readonly onSubmitted: () => void;
}) {
  if (state.kind === 'loading') return null;
  if (state.kind === 'failed') {
    return (
      <div
        className={`${MILESTONE_DOCUMENT_BLOCK_CLASS} gap-2 text-small text-muted-foreground`}
      >
        <ConflictNotice notice={conflictNotice} />
        <p>제출 항목을 불러오지 못했습니다.</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-fit"
          onClick={onRetry}
        >
          다시 시도
        </Button>
      </div>
    );
  }
  if (state.documents.length === 0) return null;

  const staff = isStaffRole(viewerRole);
  const total = state.documents.length;
  const completed = state.documents.filter(
    (document) => document.viewerSubmission?.submitted,
  ).length;
  const headerLabel = staff
    ? `${closed ? '마감' : '접수중'} · ${total}개 항목`
    : `제출 ${completed}/${total} 완료`;

  return (
    <div className={`${MILESTONE_DOCUMENT_BLOCK_CLASS} gap-3`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-small font-bold text-muted-foreground">
          제출 항목
        </h3>
        <span className="text-small text-muted-foreground">{headerLabel}</span>
      </div>
      <ConflictNotice notice={conflictNotice} />
      <ul className="grid gap-3" data-testid="milestone-document-rows">
        {state.documents.map((document) =>
          staff ? (
            <StaffDocumentRow
              key={document.id}
              document={document}
              onRefresh={onRefresh}
            />
          ) : (
            <StudentDocumentRow
              programId={programId}
              key={document.id}
              document={document}
              fileUpload={state.fileUpload}
              closed={closed}
              dueAt={dueAt}
              submissionAccess={submissionAccess}
              onRefresh={onRefresh}
              onSubmitConflict={onSubmitConflict}
              onSubmitted={onSubmitted}
            />
          ),
        )}
      </ul>
    </div>
  );
}

export function MilestoneDocumentSection({
  programId,
  milestoneId,
  viewerRole,
  closed,
  dueAt,
  submissionAccess,
}: {
  readonly programId: string;
  readonly milestoneId: string;
  readonly viewerRole: ViewerRole;
  readonly closed: boolean;
  readonly dueAt?: string;

  readonly submissionAccess: MilestoneSubmissionAccess;
}) {
  const queryClient = useQueryClient();
  const result = useMilestoneDocumentsQuery(
    programId,
    milestoneId,
    viewerRole !== null && viewerRole !== 'PENDING',
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const state: MilestoneDocumentSectionState =
    result.isError && (loadFailed || result.data === undefined)
      ? { kind: 'failed' }
      : result.data === undefined
        ? { kind: 'loading' }
        : { kind: 'ready', ...result.data };

  const [conflictNotice, setConflictNotice] = useState<string | null>(null);
  const reloadQueueRef = useRef<Promise<void>>(Promise.resolve());

  const enqueueLoad = useCallback(
    (showLoading: boolean): Promise<MilestoneDocumentReloadResult> => {
      const current = reloadQueueRef.current.then(async () => {
        const next = await result.refetch();
        if (showLoading) setLoadFailed(next.isError);
        return next.isError ? ('failed' as const) : ('reloaded' as const);
      });
      reloadQueueRef.current = current.then(() => undefined);
      return current;
    },
    [result.refetch],
  );
  const load = useCallback(() => enqueueLoad(true), [enqueueLoad]);

  if (viewerRole === null || viewerRole === 'PENDING') return null;

  return (
    <MilestoneDocumentSectionBody
      programId={programId}
      onSubmitted={() => {
        void queryClient.invalidateQueries({
          queryKey: programKey(programId),
          refetchType: 'none',
        });
        void queryClient.refetchQueries({
          queryKey: programKey(programId),
          type: 'active',
          predicate: (query) =>
            !matchQuery(
              { queryKey: milestoneDocumentsKey(programId, milestoneId) },
              query,
            ),
        });
      }}
      state={state}
      viewerRole={viewerRole}
      closed={closed}
      dueAt={dueAt}
      submissionAccess={submissionAccess}
      conflictNotice={conflictNotice}
      onRetry={() => {
        setConflictNotice(null);
        void load();
      }}
      onDocumentChange={(updated) => {
        setConflictNotice(null);
        queryClient.setQueryData(
          milestoneDocumentsKey(programId, milestoneId),
          result.data === undefined
            ? undefined
            : {
                ...result.data,
                documents: result.data.documents.map((document) =>
                  document.id === updated.id ? updated : document,
                ),
              },
        );
      }}
      onRefresh={async () => (await enqueueLoad(false)) === 'reloaded'}
      onSubmitConflict={(document) => {
        void load().then((result) => {
          setConflictNotice(
            milestoneDocumentSubmitConflictNotice(document.name, result),
          );
        });
      }}
    />
  );
}

function DocumentName({ document }: { readonly document: MilestoneDocument }) {
  return (
    <span className="min-w-0 flex-1 basis-full truncate text-small sm:basis-0">
      {document.name}
      {document.required ? (
        <span aria-label="필수" className="ml-0.5 text-destructive">
          *
        </span>
      ) : null}
    </span>
  );
}

function submitErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError) || isUnexpectedApiProblem(error)) {
    return fallback;
  }
  return error.problem.detail;
}

function StaffDocumentRow({
  document,
  onRefresh,
}: {
  readonly document: MilestoneDocument;
  readonly onRefresh: () => Promise<boolean>;
}) {
  return (
    <li className="grid gap-1" data-testid="milestone-document-row">
      <div className="flex flex-wrap items-center gap-3">
        <DocumentName document={document} />
        {document.teamSubmissionCount ? (
          <StatusBadge variant="recruiting">
            {document.teamSubmissionCount.submitted} /{' '}
            {document.teamSubmissionCount.total}팀 제출
          </StatusBadge>
        ) : null}

        {document.templateFileName ? (
          <Button asChild size="sm" variant="ghost">
            <a
              href={milestoneDocumentTemplateHref(
                document.milestoneId,
                document.id,
              )}
              target="_blank"
              rel="noreferrer"
            >
              <Download aria-hidden /> {document.templateFileName}
            </a>
          </Button>
        ) : null}
      </div>
      <MilestoneDocumentGraceEditor
        key={document.graceDueAt ?? 'no-grace'}
        document={document}
        onRefresh={onRefresh}
      />
    </li>
  );
}

function StudentReviewNotice({
  display,
  tone,
  review,
  dueNotice,
}: {
  readonly display: MilestoneDocumentReviewDisplay;
  readonly tone: MilestoneDocumentReviewNoticeTone;
  readonly review: NonNullable<
    NonNullable<MilestoneDocument['viewerSubmission']>['review']
  >;

  readonly dueNotice: {
    readonly kind: 'open' | 'passed';
    readonly dueAt: string;
  } | null;
}) {
  return (
    <Alert
      variant={tone === 'warning' ? 'destructive' : 'default'}
      data-testid="milestone-document-review-notice"
    >
      <AlertDescription className="grid gap-1">
        <span className="font-semibold">
          {MILESTONE_DOCUMENT_REVIEW_DISPLAY_LABELS[display]} ·{' '}
          {formatSeoulDate(review.reviewedAt)}
        </span>
        <span className="break-keep whitespace-pre-wrap">
          {review.comment ?? '사유 없이 저장되었습니다.'}
        </span>

        {dueNotice === null ? null : (
          <span
            data-testid="milestone-document-resubmission-due"
            className="break-keep font-semibold"
          >
            {dueNotice.kind === 'open'
              ? `재제출 기한 ${formatSeoulDate(dueNotice.dueAt)}까지 · 한 번 다시 내면 검토가 끝날 때까지 바꿀 수 없습니다`
              : `재제출 기한 ${formatSeoulDate(dueNotice.dueAt)}이 지났습니다 · 담당 교직원에게 문의해 주세요`}
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}

function HeldSubmitAction({
  note,
  label,
  icon,
  ghost,
  noteId,
}: {
  readonly note: string;
  readonly label: string;
  readonly icon: ReactElement;
  readonly ghost: boolean;
  readonly noteId: string;
}) {
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={ghost ? 'ghost' : 'default'}
        disabled
        aria-describedby={noteId}
      >
        {icon} {label}
      </Button>
      <span
        id={noteId}
        className="text-small text-muted-foreground break-keep"
        data-testid="milestone-document-blocked-note"
      >
        {note}
      </span>
    </>
  );
}

function StudentDocumentRow({
  programId,
  document,
  fileUpload,
  closed,
  dueAt,
  submissionAccess,
  onRefresh,
  onSubmitConflict,
  onSubmitted,
}: {
  readonly programId: string;
  readonly document: MilestoneDocument;
  readonly fileUpload: MilestoneDocumentUploadPolicy;
  readonly closed: boolean;
  readonly dueAt?: string;
  readonly submissionAccess: MilestoneSubmissionAccess;
  readonly onRefresh: () => Promise<boolean>;
  readonly onSubmitConflict: (document: MilestoneDocument) => void;
  readonly onSubmitted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [pendingDraft, setPendingDraft] = useState<{
    readonly text: string | null;
    readonly file: File | null;
  } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fileRejection, setFileRejection] = useState<{
    readonly file: File;
    readonly message: string;
  } | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const historyResult = useMilestoneDocumentParticipantHistoryQuery(
    programId,
    document,
  );
  const historyPages = historyResult.data?.pages ?? [];
  const history = historyPages.toReversed().flatMap((page) => page.items);
  const lastHistoryPage = historyPages.at(-1);
  const historyNextCursor = lastHistoryPage?.nextCursor ?? null;
  const historyIsComplete =
    lastHistoryPage?.isComplete ??
    document.viewerSubmission?.history?.isComplete ??
    true;
  const isHistoryLoading = historyResult.isFetching;
  const historyForbidden =
    historyResult.error instanceof ApiError &&
    historyResult.error.problem.code === 'MSD_005';
  const historyError =
    historyResult.isError && !historyForbidden
      ? '제출 이력을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
      : null;

  const viewerSubmission = document.viewerSubmission;
  const submitted = viewerSubmission?.submitted ?? false;
  const submittedAt = viewerSubmission?.submittedAt ?? null;
  const display = milestoneDocumentViewerDisplay(viewerSubmission);
  const review = viewerSubmission?.review ?? null;

  const reviewNoticeTone =
    review === null
      ? null
      : milestoneDocumentReviewNoticeTone(display, review.comment);

  const [now, setNow] = useState(() => Date.now());
  const deadlineClosed = dueAt === undefined ? closed : isPastDue(dueAt, now);
  const gate = milestoneDocumentSubmitGate({
    submissionAccess,
    viewerSubmission,
    closed: deadlineClosed,
    graceDueAt: document.graceDueAt,
    now,
  });

  const resubmissionIsFinal = isMilestoneDocumentResubmissionFinal(
    deadlineClosed,
    viewerSubmission,
  );

  const dueNotice = milestoneDocumentResubmissionDueNotice(
    viewerSubmission,
    now,
  );

  const historyMetadata = viewerSubmission?.history;

  const dueTickDelay = milestoneDocumentResubmissionDueTickDelay(
    viewerSubmission,
    now,
  );
  const nextDeadline = Math.min(
    ...[dueAt, document.graceDueAt]
      .map((value) => (value == null ? Number.NaN : Date.parse(value)))
      .filter((time) => time >= now),
  );
  useEffect(() => {
    if (!Number.isFinite(nextDeadline)) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.max(nextDeadline - Date.now() + 1, 0), 2_147_483_647),
    );
    return () => clearTimeout(timer);
  }, [nextDeadline, now]);
  useEffect(() => {
    if (dueTickDelay === null) return;
    const timer = setTimeout(() => setNow(Date.now()), dueTickDelay);
    return () => clearTimeout(timer);
  }, [dueTickDelay, now]);

  const refreshDocument = useCallback(async (): Promise<boolean> => {
    setSyncing(true);
    try {
      if (await onRefresh()) {
        setSyncNotice(null);
        return true;
      }
      setSyncNotice(
        '제출은 저장되었습니다. 최신 제출 차수와 이력은 아직 화면에 반영되지 않았습니다.',
      );
      return false;
    } finally {
      setSyncing(false);
    }
  }, [onRefresh]);

  const loadHistory = () =>
    historyResult.isFetchNextPageError || historyResult.hasNextPage
      ? historyResult.fetchNextPage()
      : historyResult.refetch();

  const finish = useCallback(
    async (content: MilestoneDocumentSubmissionContent): Promise<boolean> => {
      setSubmitting(true);
      setError(null);
      setSyncNotice(null);
      try {
        await submitMilestoneDocument(
          document.milestoneId,
          document.id,
          content,
        );
        onSubmitted();
        setEditing(false);
        await refreshDocument();
        return true;
      } catch (submitError: unknown) {
        if (isMilestoneDocumentSubmitReviewChanged(submitError)) {
          onSubmitConflict(document);
          return false;
        }
        setError(submitErrorMessage(submitError, '제출에 실패했습니다.'));
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [document, onSubmitConflict, onSubmitted, refreshDocument],
  );

  const send = useCallback(
    async (input: {
      readonly text: string | null;
      readonly file: File | null;
    }): Promise<boolean> => {
      setSubmitting(true);
      setError(null);
      setFileRejection(null);
      setSyncNotice(null);
      try {
        const uploaded =
          input.file === null
            ? null
            : await uploadMilestoneDocumentFile(
                document.milestoneId,
                document.id,
                input.file,
              );
        return finish({ text: input.text, fileId: uploaded?.fileId ?? null });
      } catch (uploadError: unknown) {
        if (
          input.file !== null &&
          uploadError instanceof ApiError &&
          isMilestoneDocumentArchiveErrorCode(uploadError.problem.code)
        ) {
          setFileRejection({
            file: input.file,
            message: uploadError.problem.detail,
          });
        } else {
          setError(
            submitErrorMessage(uploadError, '파일 업로드에 실패했습니다.'),
          );
        }
        setSubmitting(false);
        return false;
      }
    },
    [document.id, document.milestoneId, finish],
  );

  async function submitDraft(input: {
    readonly text: string | null;
    readonly file: File | null;
  }): Promise<boolean> {
    if (resubmissionIsFinal) {
      setPendingDraft(input);
      return false;
    }
    return send(input);
  }

  const actionLabel = submitted ? '수정' : '올리기';
  const actionIcon = submitted ? (
    <Pencil aria-hidden />
  ) : (
    <Upload aria-hidden />
  );

  return (
    <li className="grid gap-2" data-testid="milestone-document-row">
      <div className="flex flex-wrap items-center gap-3">
        <DocumentName document={document} />
        <StatusBadge
          variant={MILESTONE_DOCUMENT_REVIEW_DISPLAY_VARIANTS[display]}
        >
          {MILESTONE_DOCUMENT_REVIEW_DISPLAY_LABELS[display]}
        </StatusBadge>
        {submitted && submittedAt ? (
          <span className="text-small text-muted-foreground">
            {formatSeoulShortDateTime(submittedAt)} 제출
          </span>
        ) : null}
        {document.hasTemplateFile ? (
          <Button asChild size="sm" variant="ghost">
            <a
              href={milestoneDocumentTemplateHref(
                document.milestoneId,
                document.id,
              )}
              target="_blank"
              rel="noreferrer"
            >
              <Download aria-hidden /> 양식
            </a>
          </Button>
        ) : null}
        {syncNotice !== null ? (
          <span className="text-small text-muted-foreground break-keep">
            저장된 제출의 최신 상태를 확인하는 중입니다.
          </span>
        ) : gate.kind === 'settled' ? (
          <span className="text-small text-muted-foreground break-keep">
            {gate.note}
          </span>
        ) : gate.kind === 'held' ? (
          <HeldSubmitAction
            note={gate.note}
            label={actionLabel}
            icon={actionIcon}
            ghost={submitted}
            noteId={`${document.id}-submission-blocked`}
          />
        ) : (
          <Button
            type="button"
            size="sm"
            variant={submitted ? 'ghost' : 'default'}
            onClick={() => setEditing((value) => !value)}
          >
            {actionIcon} {actionLabel}
          </Button>
        )}
      </div>
      {viewerSubmission?.submittedLate === true ? (
        <p className="text-small text-warning">지각 제출</p>
      ) : null}
      {document.graceDueAt != null && review === null ? (
        <p className="text-small text-muted-foreground">
          유예 기한: {formatSeoulShortDateTime(document.graceDueAt)} (한국
          시간). 원래 마감 뒤 제출은 지각으로 표시됩니다.
        </p>
      ) : null}
      {review === null || reviewNoticeTone === null ? null : (
        <StudentReviewNotice
          display={display}
          tone={reviewNoticeTone}
          review={review}
          dueNotice={dueNotice}
        />
      )}
      {history.length === 0 && historyIsComplete ? null : (
        <MilestoneDocumentHistoryTimeline
          history={history}
          completeness={
            !historyIsComplete
              ? 'incomplete'
              : historyNextCursor !== null
                ? 'has-more'
                : 'complete'
          }
        />
      )}
      {!submitted || historyMetadata?.hasHistory !== true ? null : (
        <div className="grid gap-2">
          {isHistoryLoading ? (
            <p
              className="text-small text-muted-foreground"
              data-testid="milestone-document-history-loading"
            >
              제출 이력을 불러오는 중입니다.
            </p>
          ) : null}
          {historyForbidden ? (
            <div
              className="grid gap-2 py-2"
              data-testid="milestone-document-history-forbidden"
            >
              <p className="text-small break-keep text-muted-foreground">
                제출 이력은 신청이 승인된 참여자만 볼 수 있습니다. 이 프로그램에
                신청해 승인되면 열립니다.
              </p>
            </div>
          ) : null}
          {historyError === null ? null : (
            <Alert data-testid="milestone-document-history-error">
              <AlertDescription className="flex flex-wrap items-center gap-2">
                <span className="break-keep">{historyError}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void loadHistory()}
                >
                  다시 시도
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {historyNextCursor === null || historyError !== null ? null : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-fit"
              disabled={isHistoryLoading}
              onClick={() => void loadHistory()}
            >
              이전 이력 더 보기
            </Button>
          )}
        </div>
      )}
      {gate.kind === 'open' &&
      submissionAccess.kind !== 'blocked' &&
      syncNotice === null &&
      editing ? (
        <MilestoneDocumentSubmissionForm
          documentName={document.name}
          documentId={document.id}
          fileUpload={fileUpload}
          currentFileName={viewerSubmission?.currentFileName ?? null}
          isResubmission={submitted}
          submitting={submitting}
          fileRejection={fileRejection}
          onCancel={() => setEditing(false)}
          onSubmit={submitDraft}
        />
      ) : null}

      {pendingDraft === null ? null : (
        <MilestoneDocumentResubmissionDialog
          documentName={document.name}
          resubmissionDueAt={review?.resubmissionDueAt ?? null}
          removedFileName={
            pendingDraft.file === null
              ? (viewerSubmission?.currentFileName ?? null)
              : null
          }
          submitting={submitting}
          onCancel={() => setPendingDraft(null)}
          onConfirm={() => {
            const draft = pendingDraft;
            setPendingDraft(null);
            void send(draft);
          }}
        />
      )}
      {syncNotice === null ? null : (
        <Alert data-testid="milestone-document-submit-sync-notice">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span className="break-keep">{syncNotice}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={syncing}
              onClick={() => void refreshDocument()}
            >
              최신 상태 다시 불러오기
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {error ? (
        <p role="alert" className="text-small text-destructive">
          {error} 입력한 내용은 그대로 있으니 확인한 뒤 다시 시도해 주세요.
        </p>
      ) : null}
    </li>
  );
}
