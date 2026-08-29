'use client';

import { Download, Pencil, Upload } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
} from 'react';
import { StatusBadge } from '@/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import {
  getMilestoneDocumentParticipantHistory,
  listMilestoneDocuments,
  milestoneDocumentTemplateHref,
  submitMilestoneDocument,
  uploadMilestoneDocumentFile,
  uploadMilestoneDocumentTemplate,
  type MilestoneDocument,
  type MilestoneDocumentSubmissionContent,
} from './milestone-document-api';
import type { MilestoneDocumentCollectionHistory } from './milestone-document-collection-api';
import {
  isMilestoneDocumentSubmitReviewChanged,
  milestoneDocumentSubmitConflictNotice,
  type MilestoneDocumentReloadResult,
} from './milestone-document-conflict';
import { requireMilestoneDocumentList } from './milestone-document-list-response';
import {
  isMilestoneDocumentDeadlineLocked,
  isMilestoneDocumentResubmittable,
  MILESTONE_DOCUMENT_REVIEW_DISPLAY_LABELS,
  MILESTONE_DOCUMENT_REVIEW_DISPLAY_VARIANTS,
  milestoneDocumentReviewNoticeTone,
  milestoneDocumentViewerDisplay,
  type MilestoneDocumentReviewDisplay,
  type MilestoneDocumentReviewNoticeTone,
} from './milestone-document-review';
import {
  formatSeoulDate,
  formatSeoulShortDateTime,
} from './program-detail-format';
import { MilestoneDocumentHistoryTimeline } from './milestone-document-history-timeline';
import { MilestoneDocumentSubmissionForm } from './milestone-document-submission-form';
import type { ViewerRole } from './types';

export type MilestoneDocumentSectionState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | {
      readonly kind: 'ready';
      readonly documents: readonly MilestoneDocument[];
    };

function isStaffRole(role: ViewerRole): role is 'STAFF' | 'ADMIN' {
  return role === 'STAFF' || role === 'ADMIN';
}

/**
 * 제출이 판정과 부딪혀 저장되지 않았음을 알리는 자리.
 *
 * 줄(행) 안이 아니라 **목록 쪽**에 두는 이유: 이 문구를 띄우는 순간 목록을 다시 부르므로,
 * 줄 안에 두면 다시 부르는 사이에 줄이 통째로 갈리면서 문구도 함께 사라진다 — 학생은
 * 제출이 저장된 줄 안다(교직원 표의 `reviewNotice`를 표 쪽에 둔 것과 같은 이유).
 */
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

/** 순수 렌더 본문 — 컨테이너의 fetch/상태 관리와 분리해 정적 렌더로 테스트한다. */
export function MilestoneDocumentSectionBody({
  state,
  viewerRole,
  closed,
  conflictNotice,
  onRetry,
  onDocumentChange,
  onRefresh = async () => true,
  onSubmitConflict,
}: {
  readonly state: MilestoneDocumentSectionState;
  readonly viewerRole: 'STUDENT' | 'STAFF' | 'ADMIN';
  readonly closed: boolean;
  /** 저장되지 않은 제출을 알리는 문구. 없으면 `null`. */
  readonly conflictNotice: string | null;
  readonly onRetry: () => void;
  readonly onDocumentChange: (document: MilestoneDocument) => void;
  readonly onRefresh?: () => Promise<boolean>;
  /** 제출 도중 교직원 판정이 먼저 커밋됐다(409 MSD_024) — 목록을 다시 불러야 한다. */
  readonly onSubmitConflict: (document: MilestoneDocument) => void;
}) {
  if (state.kind === 'loading') return null;
  if (state.kind === 'failed') {
    return (
      <div className="grid gap-2 border-t border-border/50 pt-3 text-small text-muted-foreground">
        {/* 못 불러온 자리에서도 「방금 제출이 저장되지 않았다」는 사실은 남아야 한다. */}
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
    <div className="grid gap-3 border-t border-border/50 pt-3">
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
              onChange={onDocumentChange}
            />
          ) : (
            <StudentDocumentRow
              key={document.id}
              document={document}
              closed={closed}
              onRefresh={onRefresh}
              onSubmitConflict={onSubmitConflict}
            />
          ),
        )}
      </ul>
    </div>
  );
}

/** 마일스톤 하나의 "제출 항목" 블록 — role null/PENDING이거나 항목이 없으면 아무것도 그리지 않는다. */
export function MilestoneDocumentSection({
  milestoneId,
  viewerRole,
  closed,
}: {
  readonly milestoneId: string;
  readonly viewerRole: ViewerRole;
  readonly closed: boolean;
}) {
  const [state, setState] = useState<MilestoneDocumentSectionState>({
    kind: 'loading',
  });
  /**
   * 저장되지 않은 제출을 알리는 문구 — 목록을 다시 부르는 동안 줄이 통째로 갈리므로
   * 줄이 아니라 여기(컨테이너)가 들고 있어야 살아남는다.
   */
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);
  const reloadQueueRef = useRef<Promise<void>>(Promise.resolve());
  /** 조회 한 번. **불러왔는지**를 돌려준다 — 그 결과가 곧 학생에게 할 말을 정한다. */
  const enqueueLoad = useCallback(
    (showLoading: boolean): Promise<MilestoneDocumentReloadResult> => {
      const current = reloadQueueRef.current.then(async () => {
        if (showLoading) setState({ kind: 'loading' });
        try {
          setState({
            kind: 'ready',
            documents: requireMilestoneDocumentList(
              await listMilestoneDocuments(milestoneId),
            ),
          });
          return 'reloaded' as const;
        } catch {
          if (showLoading) setState({ kind: 'failed' });
          return 'failed' as const;
        }
      });
      reloadQueueRef.current = current.then(() => undefined);
      return current;
    },
    [milestoneId],
  );
  const load = useCallback(() => enqueueLoad(true), [enqueueLoad]);
  useEffect(() => {
    if (viewerRole === null || viewerRole === 'PENDING') return;
    void load();
  }, [load, viewerRole]);

  if (viewerRole === null || viewerRole === 'PENDING') return null;

  return (
    <MilestoneDocumentSectionBody
      state={state}
      viewerRole={viewerRole}
      closed={closed}
      conflictNotice={conflictNotice}
      onRetry={() => {
        // 손으로 다시 부르는 것은 앞 제출과 다른 일이다 — 앞 안내를 여기 남기면 방금
        // 불러온 목록의 말로 읽힌다.
        setConflictNotice(null);
        void load();
      }}
      onDocumentChange={(updated) => {
        setConflictNotice(null);
        setState((previous) =>
          previous.kind === 'ready'
            ? {
                kind: 'ready',
                documents: previous.documents.map((document) =>
                  document.id === updated.id ? updated : document,
                ),
              }
            : previous,
        );
      }}
      onRefresh={async () => (await enqueueLoad(false)) === 'reloaded'}
      onSubmitConflict={(document) => {
        /*
         * 제출하는 사이에 교직원 판정이 먼저 커밋됐다(409 MSD_024). 화면이 아는 상태가
         * 이미 낡았으므로 문구만 띄우면 안 된다 — 그 판정이 승인·반려였다면 화면은
         * 여전히 「보완 요청」으로 알아 제출 입력을 열어 두고, 학생은 이미 금지된 조작을
         * 계속 보며 누를 때마다 409를 다시 받는다.
         *
         * 말은 **다시 부른 뒤에** 한다. 「다시 불러왔습니다」를 먼저 띄우면 조회가
         * 느리거나 실패한 화면에 그 문구만 남는다.
         */
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
    <span className="min-w-0 flex-1 truncate text-small">
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
  return error instanceof ApiError ? error.problem.detail : fallback;
}

/** 교직원 행 — 팀 제출 카운트 + 양식 올리기/교체. */
function StaffDocumentRow({
  document,
  onChange,
}: {
  readonly document: MilestoneDocument;
  readonly onChange: (document: MilestoneDocument) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadMilestoneDocumentTemplate(
        document.milestoneId,
        document.id,
        file,
      );
      onChange({ ...document, hasTemplateFile: true });
    } catch (uploadError: unknown) {
      setError(submitErrorMessage(uploadError, '양식 업로드에 실패했습니다.'));
    } finally {
      setUploading(false);
    }
  }

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
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload aria-hidden />
          {document.hasTemplateFile ? '양식 교체' : '양식 올리기'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          className="sr-only"
          aria-label={`${document.name} 양식 파일 선택`}
          onChange={(event) => void handleFile(event)}
        />
      </div>
      {error ? (
        <p role="alert" className="text-small text-destructive">
          {error} 파일을 다시 선택해 주세요.
        </p>
      ) : null}
    </li>
  );
}

/**
 * 교직원이 판정에 적은 말 — 학생이 실제로 읽는 자리다.
 *
 * 판정 폼은 사유 칸 아래에 「학생에게 그대로 보입니다」라고 적어 두고 **승인에도** 사유를
 * 받는다. 그런데 이 상자를 보완 요청·반려에만 그리면 승인에 적은 말은 어디에도 나오지
 * 않는다 — 「잘 받았습니다, 다음 단계 안내드릴게요」라고 적은 교직원은 학생이 그것을
 * 읽었다고 믿고, 학생은 본 적이 없다. 화면이 약속한 것을 안 지키는 상태다.
 *
 * 톤은 판정에 따라 갈린다(`milestoneDocumentReviewNoticeTone`):
 * - 보완 요청·반려는 **경고 톤**이다. 고쳐야 할 일이라 눈에 띄어야 하고, 사유를 작게
 *   적어 두면 학생은 배지만 보고 「안 됐구나」까지만 읽고 닫는다 — 그러면 같은 서류가
 *   같은 이유로 또 되돌아온다.
 * - 승인은 **중립 톤**이다. 같은 빨간 상자에 담으면 승인인데 문제가 있는 것처럼 읽힌다.
 *
 * 날짜를 함께 적는 것은 지난 지적과 방금 지적을 구분하기 위해서다.
 */
function StudentReviewNotice({
  display,
  tone,
  review,
}: {
  readonly display: MilestoneDocumentReviewDisplay;
  readonly tone: MilestoneDocumentReviewNoticeTone;
  readonly review: NonNullable<
    NonNullable<MilestoneDocument['viewerSubmission']>['review']
  >;
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
          {/*
           * 사유 없는 승인은 애초에 이 상자를 세우지 않는다(위 톤 판정) — 이 대체 문구가
           * 닿는 것은 사유가 필수인데도 비어 온 보완 요청·반려뿐이다. 그 자리에서 상자를
           * 통째로 지우면 학생은 서류가 되돌아온 사실조차 모른다.
           */}
          {review.comment ?? '사유 없이 저장되었습니다.'}
        </span>
      </AlertDescription>
    </Alert>
  );
}

/** 학생 행 — 상태 표시 + 양식 다운로드 + 제출/재제출. */
function StudentDocumentRow({
  document,
  closed,
  onRefresh,
  onSubmitConflict,
}: {
  readonly document: MilestoneDocument;
  readonly closed: boolean;
  readonly onRefresh: () => Promise<boolean>;
  readonly onSubmitConflict: (document: MilestoneDocument) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<
    readonly MilestoneDocumentCollectionHistory[]
  >([]);
  const [historyNextCursor, setHistoryNextCursor] = useState<string | null>(
    null,
  );
  const [historyIsComplete, setHistoryIsComplete] = useState(true);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyErrorCursor, setHistoryErrorCursor] = useState<string | null>(
    null,
  );
  const historyRequestIdRef = useRef(0);

  const viewerSubmission = document.viewerSubmission;
  const submitted = viewerSubmission?.submitted ?? false;
  const submittedAt = viewerSubmission?.submittedAt ?? null;
  const display = milestoneDocumentViewerDisplay(viewerSubmission);
  const review = viewerSubmission?.review ?? null;
  /** 사유 상자를 그릴지·어떤 톤으로 그릴지. 안 그릴 자리는 `null`이다. */
  const reviewNoticeTone =
    review === null
      ? null
      : milestoneDocumentReviewNoticeTone(display, review.comment);
  /**
   * 승인·반려된 서류에는 제출 입력을 아예 열지 않는다. 서버도 409(MSD_023)로 막으므로
   * 열어 두면 눌러 본 학생에게 오류만 돌아간다 — 낼 수 없는 것은 낼 수 없게 보여야 한다.
   */
  const canSubmit = isMilestoneDocumentResubmittable(viewerSubmission);
  /**
   * 마감이 지난 마일스톤은 제출 입력을 잠근다 — **보완 요청만 빼고**. 교직원이 마감 뒤에
   * 「고쳐서 다시 내세요」라고 하는 것은 흔한 일이라, 여기서 함께 잠그면 그 요청을 받은
   * 학생이 낼 방법이 없어진다(서버는 받아 준다).
   */
  const deadlineLocked = isMilestoneDocumentDeadlineLocked(
    closed,
    viewerSubmission,
  );
  const historyMetadata = viewerSubmission?.history;

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

  const loadHistory = useCallback(
    async (cursor: string | null) => {
      historyRequestIdRef.current += 1;
      const requestId = historyRequestIdRef.current;
      setIsHistoryLoading(true);
      setHistoryError(null);
      try {
        const page = await getMilestoneDocumentParticipantHistory(
          document.milestoneId,
          document.id,
          cursor,
        );
        if (requestId !== historyRequestIdRef.current) return;
        setHistory((previous) =>
          cursor === null ? page.items : [...page.items, ...previous],
        );
        setHistoryNextCursor(page.nextCursor);
        setHistoryIsComplete(page.isComplete);
        setHistoryErrorCursor(null);
      } catch {
        if (requestId !== historyRequestIdRef.current) return;
        setHistoryError(
          '제출 이력을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        );
        setHistoryErrorCursor(cursor);
      } finally {
        if (requestId === historyRequestIdRef.current) {
          setIsHistoryLoading(false);
        }
      }
    },
    [document.id, document.milestoneId],
  );

  /*
   * 목록은 원장 자체가 아니라 이력이 있는지와 이관 완전성만 준다. 제출하지 않은 행이나
   * 빈 원장에는 요청조차 내보내지 않고, 새 목록(성공 저장 뒤 재조회 포함)을 받으면 최신
   * 페이지부터 다시 시작한다.
   */
  useEffect(() => {
    historyRequestIdRef.current += 1;
    setHistory([]);
    setHistoryNextCursor(null);
    setHistoryIsComplete(historyMetadata?.isComplete ?? true);
    setIsHistoryLoading(false);
    setHistoryError(null);
    setHistoryErrorCursor(null);
    if (!submitted || historyMetadata?.hasHistory !== true) return;
    void loadHistory(null);
  }, [
    document.id,
    document.milestoneId,
    historyMetadata?.hasHistory,
    loadHistory,
    submitted,
    viewerSubmission?.revision,
  ]);

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
        setEditing(false);
        await refreshDocument();
        return true;
      } catch (submitError: unknown) {
        /*
         * 내는 사이에 교직원 판정이 먼저 커밋된 경우(409 MSD_024)만 목록을 다시 부른다.
         * 이 줄에 문구만 남기면 화면은 여전히 옛 상태를 알고 있어 제출 입력이 계속
         * 열려 있고, 그 판정이 승인·반려였다면 학생은 금지된 조작을 계속 보게 된다.
         * 마감·권한처럼 상태가 낡아서 나는 것이 아닌 실패는 지금처럼 문구만 보여 준다.
         */
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
    [document, onSubmitConflict, refreshDocument],
  );

  async function submitDraft(input: {
    readonly text: string | null;
    readonly file: File | null;
  }): Promise<boolean> {
    setSubmitting(true);
    setError(null);
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
      setError(submitErrorMessage(uploadError, '파일 업로드에 실패했습니다.'));
      setSubmitting(false);
      return false;
    }
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
        ) : !canSubmit ? (
          <span className="text-small text-muted-foreground break-keep">
            {display === 'APPROVED'
              ? '승인된 제출 항목은 다시 제출할 수 없습니다.'
              : '반려된 제출 항목은 다시 제출할 수 없습니다.'}
          </span>
        ) : (
          <Button
            type="button"
            size="sm"
            variant={submitted ? 'ghost' : 'default'}
            disabled={deadlineLocked}
            onClick={() => setEditing((value) => !value)}
          >
            {actionIcon} {actionLabel}
          </Button>
        )}
      </div>
      {review === null || reviewNoticeTone === null ? null : (
        <StudentReviewNotice
          display={display}
          tone={reviewNoticeTone}
          review={review}
        />
      )}
      {history.length === 0 && historyIsComplete ? null : (
        <MilestoneDocumentHistoryTimeline
          history={history}
          completeness={
            historyNextCursor !== null
              ? 'has-more'
              : historyIsComplete
                ? 'complete'
                : 'incomplete'
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
          {historyError === null ? null : (
            <Alert data-testid="milestone-document-history-error">
              <AlertDescription className="flex flex-wrap items-center gap-2">
                <span className="break-keep">{historyError}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void loadHistory(historyErrorCursor)}
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
              onClick={() => void loadHistory(historyNextCursor)}
            >
              이전 이력 더 보기
            </Button>
          )}
        </div>
      )}
      {canSubmit && syncNotice === null && editing ? (
        <MilestoneDocumentSubmissionForm
          documentName={document.name}
          documentId={document.id}
          submitting={submitting}
          onCancel={() => setEditing(false)}
          onSubmit={submitDraft}
        />
      ) : null}
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
