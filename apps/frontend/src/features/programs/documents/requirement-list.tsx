'use client';

import { matchQuery, useQueryClient } from '@tanstack/react-query';
import { requirementsKey, programKey } from '@/lib/query-keys';
import {
  useRequirementsQuery,
  useRequirementParticipantHistoryQuery,
} from './queries';
import {
  BadgeCheck,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleX,
  Download,
  FileArchive,
  FileText,
  ImageIcon,
  LinkIcon,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiError, isUnexpectedApiProblem } from '@/lib/api-client';
import {
  submissionStatusLabel,
  type SubmissionDisplayStatus,
} from '@/lib/status-vocabulary';
import { useClampedText } from '@/lib/use-clamped-text';
import { cn } from '@/lib/utils';
import {
  requirementCurrentFileHref,
  requirementTemplateHref,
  submitRequirement,
  uploadRequirementFile,
} from './requirement-api';
import type {
  Requirement,
  SubmissionContent,
  RequirementUploadPolicy,
} from './requirement-dto';
import {
  isRequirementSubmitReviewChanged,
  requirementSubmitConflictNotice,
  type RequirementReloadResult,
} from './requirement-conflict';
import type { MilestoneSubmissionAccess } from './milestone-submission-access';
import { requirementSubmitGate } from './milestone-submit-gate';
import {
  requirementFileKind,
  type RequirementFileKind,
} from './requirement-file-kind';
import {
  isRequirementResubmissionFinal,
  requirementReviewNoticeTone,
  requirementViewerDisplay,
  type RequirementReviewDisplay,
} from './requirement-review';
import {
  isPastDue,
  formatSeoulShortDateTime,
} from '../catalog/program-detail-format';
import { RequirementHistoryTimeline } from './requirement-history-timeline';
import { RequirementResubmissionDialog } from './requirement-resubmission-dialog';
import { SubmissionForm } from './submission-form';
import { isRequirementArchiveErrorCode } from './requirement-upload-policy';
import type { ViewerRole } from '../program-contract';
import { RequirementGraceEditor } from './requirement-grace-editor';
import { SubmissionFileUploadCache } from '@/lib/submission-file-upload-cache';

export type RequirementSectionState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | {
      readonly kind: 'ready';
      readonly documents: readonly Requirement[];

      readonly fileUpload: RequirementUploadPolicy;
    };

function isStaffRole(role: ViewerRole): role is 'STAFF' {
  return role === 'STAFF';
}

const REQUIREMENT_BLOCK_CLASS = '@container grid px-6 pt-1 pb-5';
const ITEM_LIST_CLASS = cn(
  'grid grid-cols-[auto_minmax(0,1fr)_auto_auto] gap-2',
  '@2xl:grid-cols-[auto_fit-content(50%)_auto_minmax(0,1fr)_auto]',
);
const ITEM_CLASS = 'col-span-full grid grid-cols-subgrid items-start gap-y-1';
const ITEM_ICON_CLASS = 'row-start-1 flex h-control items-center';
const ITEM_NAME_CLASS = cn(
  'col-start-2 row-start-1 min-w-0 text-small leading-5 break-keep',
  'py-[calc((var(--spacing-control)-1.25rem)/2)] [overflow-wrap:anywhere]',
);
const ITEM_CONTEXT_CLASS = cn(
  'col-span-3 col-start-2 row-start-2 flex min-w-0 flex-wrap items-center',
  'gap-x-2 gap-y-1 text-small empty:hidden',
  '@2xl:col-span-1 @2xl:col-start-4 @2xl:row-start-1 @2xl:min-h-control',
);
const ITEM_ACTION_CLASS =
  'col-start-4 row-start-1 justify-self-end @2xl:col-start-5';
const ITEM_DETAIL_CLASS = cn(
  'col-span-3 col-start-2 row-start-3 grid min-w-0 gap-2 empty:hidden',
  '@2xl:col-span-4 @2xl:row-start-2',
);
const LINK_BUTTON_CLASS =
  'h-auto shrink-0 px-0 text-foreground underline underline-offset-2';

const FILE_KIND_ICON = {
  link: LinkIcon,
  image: ImageIcon,
  archive: FileArchive,
  document: FileText,
} as const satisfies Record<RequirementFileKind, LucideIcon>;

const STATUS_ICON = {
  NOT_SUBMITTED: [Circle, 'text-muted-foreground'],
  OVERDUE: [Circle, 'text-destructive'],
  SUBMITTED: [CircleCheck, 'text-primary'],
  APPROVED: [BadgeCheck, 'text-status-approved-fg'],
  CHANGES_REQUESTED: [CircleAlert, 'text-status-pending-fg'],
  REJECTED: [CircleX, 'text-destructive'],
} as const satisfies Record<
  SubmissionDisplayStatus,
  readonly [LucideIcon, string]
>;

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

export function RequirementSectionBody({
  programId,
  state,
  viewerRole,
  closed,
  dueAt,
  submissionAccess,
  onBusyChange,
  conflictNotice,
  onRetry,
  onRefresh = () => Promise.resolve(true),
  onSubmitConflict,
  onSubmitted,
  summary,
  className,
}: {
  readonly programId: string;
  readonly state: RequirementSectionState;
  readonly summary?: string;
  readonly className?: string;
  readonly viewerRole: 'STUDENT' | 'STAFF' | 'ADMIN';
  readonly closed: boolean;
  readonly dueAt?: string;

  readonly submissionAccess: MilestoneSubmissionAccess;
  readonly onBusyChange?: (busy: boolean) => void;

  readonly conflictNotice: string | null;
  readonly onRetry: () => void;
  readonly onDocumentChange: (document: Requirement) => void;
  readonly onRefresh?: () => Promise<boolean>;

  readonly onSubmitConflict: (document: Requirement) => void;
  readonly onSubmitted: () => void;
}) {
  if (state.kind === 'loading') return null;
  if (state.kind === 'failed') {
    return (
      <div
        className={cn(
          REQUIREMENT_BLOCK_CLASS,
          'gap-2 text-small text-muted-foreground',
          className,
        )}
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

  return (
    <div className={cn(REQUIREMENT_BLOCK_CLASS, 'gap-2', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <h3 className="text-small font-bold text-muted-foreground">
          제출 항목
        </h3>
        {staff ? (
          summary === undefined ? null : (
            <span className="text-xs text-muted-foreground tabular-nums">
              {summary}
            </span>
          )
        ) : (
          <span className="text-small text-muted-foreground tabular-nums">
            제출{' '}
            <b className="font-bold text-foreground">{`${completed}/${total}`}</b>
          </span>
        )}
      </div>
      <ConflictNotice notice={conflictNotice} />
      <ul className={ITEM_LIST_CLASS} data-testid="milestone-document-rows">
        {state.documents.map((document) =>
          staff ? (
            <StaffDocumentRow
              key={document.id}
              document={document}
              countShown={total > 1}
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
              onBusyChange={onBusyChange}
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

export function RequirementSection({
  programId,
  milestoneId,
  viewerRole,
  closed,
  dueAt,
  submissionAccess,
  onBusyChange,
  summary,
  className,
}: {
  readonly programId: string;
  readonly milestoneId: string;
  readonly summary?: string;
  readonly className?: string;
  readonly viewerRole: ViewerRole;
  readonly closed: boolean;
  readonly dueAt?: string;

  readonly submissionAccess: MilestoneSubmissionAccess;
  readonly onBusyChange?: (busy: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const scope = viewerRole === 'STAFF' ? undefined : 'all';
  const result = useRequirementsQuery(
    programId,
    milestoneId,
    viewerRole !== null && viewerRole !== 'PENDING',
    scope,
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const state: RequirementSectionState =
    result.isError && (loadFailed || result.data === undefined)
      ? { kind: 'failed' }
      : result.data === undefined
        ? { kind: 'loading' }
        : { kind: 'ready', ...result.data };

  const [conflictNotice, setConflictNotice] = useState<string | null>(null);
  const reloadQueueRef = useRef<Promise<void>>(Promise.resolve());

  const enqueueLoad = useCallback(
    (showLoading: boolean): Promise<RequirementReloadResult> => {
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
    <RequirementSectionBody
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
              {
                queryKey: requirementsKey(programId, milestoneId, scope),
              },
              query,
            ),
        });
      }}
      state={state}
      viewerRole={viewerRole}
      closed={closed}
      dueAt={dueAt}
      submissionAccess={submissionAccess}
      onBusyChange={onBusyChange}
      summary={summary}
      className={className}
      conflictNotice={conflictNotice}
      onRetry={() => {
        setConflictNotice(null);
        void load();
      }}
      onDocumentChange={(updated) => {
        setConflictNotice(null);
        queryClient.setQueryData(
          requirementsKey(programId, milestoneId, scope),
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
            requirementSubmitConflictNotice(document.name, result),
          );
        });
      }}
    />
  );
}

function RequirementIcon({ document }: { readonly document: Requirement }) {
  const Icon = FILE_KIND_ICON[requirementFileKind(document)];
  return (
    <span className={cn(ITEM_ICON_CLASS, 'col-start-1')}>
      <Icon aria-hidden className="size-4 text-muted-foreground" />
    </span>
  );
}

function DocumentName({ document }: { readonly document: Requirement }) {
  return (
    <span className={ITEM_NAME_CLASS}>
      {document.name}
      {document.required ? (
        <span
          aria-label="필수"
          className="ml-0.5 text-destructive before:content-['\2060']"
        >
          *
        </span>
      ) : null}
    </span>
  );
}

function DocumentStatus({
  status,
}: {
  readonly status: SubmissionDisplayStatus;
}) {
  const [Icon, tone] = STATUS_ICON[status];
  const label = submissionStatusLabel(status, 'student');
  return (
    <span
      className={cn(ITEM_ICON_CLASS, 'col-start-3')}
      title={label}
      data-status={status}
      data-testid="milestone-document-status"
    >
      <Icon aria-hidden className={cn('size-4', tone)} />
      <span className="sr-only">{label}</span>
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
  countShown,
  onRefresh,
}: {
  readonly document: Requirement;
  readonly countShown: boolean;
  readonly onRefresh: () => Promise<boolean>;
}) {
  const count = countShown ? document.teamSubmissionCount : undefined;
  return (
    <li className={ITEM_CLASS} data-testid="milestone-document-row">
      <RequirementIcon document={document} />
      <DocumentName document={document} />
      <div className={ITEM_CONTEXT_CLASS}>
        {count === undefined ? null : (
          <span className="tabular-nums">
            제출{' '}
            <b className="font-bold">{`${count.submitted}/${count.total}`}</b>
          </span>
        )}
        {document.graceDueAt == null ? null : (
          <span className="text-muted-foreground">
            유예 기한: {formatSeoulShortDateTime(document.graceDueAt)} (한국
            시간)
          </span>
        )}
        {document.templateFileName ? (
          <Button
            asChild
            size="sm"
            variant="ghost"
            className="ml-auto max-w-full"
          >
            <a
              href={requirementTemplateHref(document.milestoneId, document.id)}
              target="_blank"
              rel="noreferrer"
            >
              <Download aria-hidden />
              <span className="truncate">{document.templateFileName}</span>
            </a>
          </Button>
        ) : null}
      </div>
      <RequirementGraceEditor
        key={document.graceDueAt ?? 'no-grace'}
        document={document}
        onRefresh={onRefresh}
        className={ITEM_ACTION_CLASS}
        formClassName={ITEM_DETAIL_CLASS}
      />
    </li>
  );
}

function ReviewComment({ comment }: { readonly comment: string | null }) {
  const text = comment ?? '사유 없이 저장되었습니다.';
  const contentId = useId();
  const { ref, expanded, overflowing, toggle } =
    useClampedText<HTMLSpanElement>(text);
  return (
    <span
      className="flex max-w-full min-w-0 items-start gap-2"
      data-testid="milestone-document-review-notice"
    >
      <span
        id={contentId}
        ref={ref}
        className={cn(
          'min-w-0 break-keep [overflow-wrap:anywhere]',
          expanded ? 'whitespace-pre-wrap' : 'line-clamp-1',
        )}
      >
        {text}
      </span>
      {overflowing || expanded ? (
        <Button
          type="button"
          variant="link"
          size="xs"
          className={LINK_BUTTON_CLASS}
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={toggle}
        >
          {expanded ? '접기' : '더 보기'}
        </Button>
      ) : null}
    </span>
  );
}

function CurrentFile({
  document,
  fileName,
}: {
  readonly document: Requirement;
  readonly fileName: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 truncate" title={fileName}>
        {fileName}
      </span>
      <Button asChild variant="link" size="xs" className={LINK_BUTTON_CLASS}>
        <a
          href={requirementCurrentFileHref(document.milestoneId, document.id)}
          target="_blank"
          rel="noreferrer"
          aria-label={`${fileName} 보기 (새 탭에서 열림)`}
        >
          보기
        </a>
      </Button>
    </span>
  );
}

function studentDocumentStatus(
  display: RequirementReviewDisplay,
  dueAt: string | undefined,
  now: number,
): SubmissionDisplayStatus {
  if (display === 'NOT_SUBMITTED') {
    return dueAt !== undefined && isPastDue(dueAt, now) ? 'OVERDUE' : display;
  }
  return display === 'PENDING' ? 'SUBMITTED' : display;
}

function StudentDocumentRow({
  programId,
  document,
  fileUpload,
  closed,
  dueAt,
  submissionAccess,
  onBusyChange,
  onRefresh,
  onSubmitConflict,
  onSubmitted,
}: {
  readonly programId: string;
  readonly document: Requirement;
  readonly fileUpload: RequirementUploadPolicy;
  readonly closed: boolean;
  readonly dueAt?: string;
  readonly submissionAccess: MilestoneSubmissionAccess;
  readonly onBusyChange?: (busy: boolean) => void;
  readonly onRefresh: () => Promise<boolean>;
  readonly onSubmitConflict: (document: Requirement) => void;
  readonly onSubmitted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [expectedRevision, setExpectedRevision] = useState(0);
  const uploadedFile = useRef(new SubmissionFileUploadCache());
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (!submitting || onBusyChange === undefined) return;
    onBusyChange(true);
    return () => onBusyChange(false);
  }, [submitting, onBusyChange]);

  const [pendingDraft, setPendingDraft] = useState<{
    readonly text: string | null;
    readonly file: File | null;
    readonly comment?: string;
  } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fileRejection, setFileRejection] = useState<{
    readonly file: File;
    readonly message: string;
  } | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const historyResult = useRequirementParticipantHistoryQuery(
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
  const display = requirementViewerDisplay(viewerSubmission);
  const review = viewerSubmission?.review ?? null;

  const reviewNoticeTone =
    review === null
      ? null
      : requirementReviewNoticeTone(display, review.comment);

  const [now, setNow] = useState(() => Date.now());
  const deadlineClosed = dueAt === undefined ? closed : isPastDue(dueAt, now);
  const badgeStatus = studentDocumentStatus(display, dueAt, now);
  const gate = requirementSubmitGate({
    submissionAccess,
    viewerSubmission,
    closed: deadlineClosed,
    graceDueAt: document.graceDueAt,
    now,
  });

  const resubmissionIsFinal = isRequirementResubmissionFinal(
    deadlineClosed,
    viewerSubmission,
  );

  const historyMetadata = viewerSubmission?.history;

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
    async (content: SubmissionContent, comment?: string): Promise<boolean> => {
      setSubmitting(true);
      setError(null);
      setSyncNotice(null);
      try {
        await submitRequirement(document.milestoneId, document.id, content, {
          expectedRevision,
          ...(comment === undefined ? {} : { comment }),
        });
        uploadedFile.current.discard();
        onSubmitted();
        setEditing(false);
        await refreshDocument();
        return true;
      } catch (submitError: unknown) {
        if (isRequirementSubmitReviewChanged(submitError)) {
          setEditing(false);
          uploadedFile.current.discard();
          onSubmitConflict(document);
          return false;
        }
        if (
          submitError instanceof ApiError &&
          ['MSD_009', 'MSD_014'].includes(submitError.problem.code)
        )
          uploadedFile.current.discard();
        setError(submitErrorMessage(submitError, '제출에 실패했습니다.'));
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [
      document,
      expectedRevision,
      onSubmitConflict,
      onSubmitted,
      refreshDocument,
    ],
  );

  const send = useCallback(
    async (input: {
      readonly text: string | null;
      readonly file: File | null;
      readonly comment?: string;
    }): Promise<boolean> => {
      setSubmitting(true);
      setError(null);
      setFileRejection(null);
      setSyncNotice(null);
      try {
        const file = input.file;
        const fileId =
          file === null
            ? null
            : await uploadedFile.current.resolve(file, () =>
                uploadRequirementFile(document.milestoneId, document.id, file),
              );
        return finish({ text: input.text, fileId }, input.comment);
      } catch (uploadError: unknown) {
        if (
          input.file !== null &&
          uploadError instanceof ApiError &&
          isRequirementArchiveErrorCode(uploadError.problem.code)
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
    readonly comment?: string;
  }): Promise<boolean> {
    if (resubmissionIsFinal) {
      setPendingDraft(input);
      return false;
    }
    return send(input);
  }

  const noteId = `${document.id}-submission-blocked`;
  const meta = [
    submitted && submittedAt ? (
      <span key="submitted-at">
        {formatSeoulShortDateTime(submittedAt)} 제출
      </span>
    ) : null,
    review !== null && reviewNoticeTone !== null ? (
      <span key="reviewed-at">
        {formatSeoulShortDateTime(review.reviewedAt)} 검토
      </span>
    ) : null,
    viewerSubmission?.submittedLate === true ? (
      <span key="late" className="text-status-pending-fg">
        지각 제출
      </span>
    ) : null,
    syncNotice !== null ? (
      <span key="note">저장된 제출의 최신 상태를 확인하는 중입니다.</span>
    ) : gate.kind === 'settled' ? (
      <span key="note">{gate.note}</span>
    ) : gate.kind === 'held' ? (
      <span
        key="note"
        id={noteId}
        data-testid="milestone-document-blocked-note"
      >
        {gate.note}
      </span>
    ) : null,
  ].filter((part) => part !== null);

  return (
    <li className={ITEM_CLASS} data-testid="milestone-document-row">
      <RequirementIcon document={document} />
      <DocumentName document={document} />
      <DocumentStatus status={badgeStatus} />
      <div className={ITEM_CONTEXT_CLASS}>
        {review !== null && reviewNoticeTone !== null ? (
          <ReviewComment comment={review.comment} />
        ) : viewerSubmission?.hasCurrentFile === true &&
          viewerSubmission.currentFileName !== null ? (
          <CurrentFile
            document={document}
            fileName={viewerSubmission.currentFileName}
          />
        ) : null}
        {meta.length === 0 ? null : (
          <span className="break-keep text-muted-foreground">
            {meta.flatMap((part, index) =>
              index === 0 ? [part] : [' · ', part],
            )}
          </span>
        )}
        {document.hasTemplateFile ? (
          <Button asChild size="sm" variant="ghost" className="ml-auto">
            <a
              href={requirementTemplateHref(document.milestoneId, document.id)}
              target="_blank"
              rel="noreferrer"
            >
              <Download aria-hidden /> 양식
            </a>
          </Button>
        ) : null}
      </div>
      {syncNotice !== null || gate.kind === 'settled' ? null : (
        <Button
          type="button"
          size="sm"
          variant={submitted ? 'ghost' : 'default'}
          className={ITEM_ACTION_CLASS}
          disabled={gate.kind === 'held'}
          aria-describedby={gate.kind === 'held' ? noteId : undefined}
          onClick={() => {
            if (!editing) setExpectedRevision(viewerSubmission?.revision ?? 0);
            setEditing((value) => !value);
          }}
        >
          {submitted ? (
            '교체'
          ) : (
            <>
              <Upload aria-hidden /> 올리기
            </>
          )}
        </Button>
      )}
      <div className={ITEM_DETAIL_CLASS}>
        {document.graceDueAt != null && review === null ? (
          <p className="text-small text-muted-foreground">
            유예 기한: {formatSeoulShortDateTime(document.graceDueAt)} (한국
            시간). 원래 마감 뒤 제출은 지각으로 표시됩니다.
          </p>
        ) : null}
        {history.length === 0 && historyIsComplete ? null : (
          <RequirementHistoryTimeline
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
                  제출 이력은 신청이 승인된 참여자만 볼 수 있습니다. 이
                  프로그램에 신청해 승인되면 열립니다.
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
          <SubmissionForm
            documentName={document.name}
            documentId={document.id}
            submissionType={document.submissionType}
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
          <RequirementResubmissionDialog
            documentName={document.name}
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
      </div>
    </li>
  );
}
