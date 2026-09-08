'use client';

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
  getMilestoneDocumentParticipantHistory,
  listMilestoneDocuments,
  milestoneDocumentTemplateHref,
  submitMilestoneDocument,
  uploadMilestoneDocumentFile,
  type MilestoneDocument,
  type MilestoneDocumentSubmissionContent,
  type MilestoneDocumentUploadPolicy,
} from './milestone-document-api';
import type { MilestoneDocumentCollectionHistory } from './milestone-document-collection-api';
import {
  isMilestoneDocumentSubmitReviewChanged,
  milestoneDocumentSubmitConflictNotice,
  type MilestoneDocumentReloadResult,
} from './milestone-document-conflict';
import { requireMilestoneDocumentList } from './milestone-document-list-response';
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
  formatSeoulShortDateTime,
} from './program-detail-format';
import { MilestoneDocumentHistoryTimeline } from './milestone-document-history-timeline';
import { MilestoneDocumentResubmissionDialog } from './milestone-document-resubmission-dialog';
import { MilestoneDocumentSubmissionForm } from './milestone-document-submission-form';
import type { ViewerRole } from './types';

export type MilestoneDocumentSectionState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | {
      readonly kind: 'ready';
      readonly documents: readonly MilestoneDocument[];
      /** 상한·허용 형식. 목록과 같은 응답으로 온다 — 화면은 사본을 만들지 않는다(#1107). */
      readonly fileUpload: MilestoneDocumentUploadPolicy;
    };

function isStaffRole(role: ViewerRole): role is 'STAFF' | 'ADMIN' {
  return role === 'STAFF' || role === 'ADMIN';
}

/**
 * 제출 항목 블록이 마일스톤 안에서 차지하는 자리.
 *
 * 두 가지가 바뀌었다(#1092 후속 UX).
 *
 * 1. **가로선을 뗐다.** 예전에는 이 블록 위에 `border-t` 를 그었는데, 마일스톤
 *    **사이**에는 선이 없어서 화면에 보이는 유일한 가로선이 한 마일스톤을 제 자식과
 *    갈라놓았다. 경계로 읽혀야 할 선이 엉뚱한 자리에 있었던 셈이다. 이제 선은
 *    마일스톤 사이에만 긋고(`program-detail-view` 의 `MilestoneGroup`), 머리줄과
 *    이 블록은 머리줄의 옅은 띠가 갈라 준다.
 * 2. **머리줄과 같은 `px-6` 안으로 들여놨다.** 예전에는 이 블록이 목록 왼쪽 끝에
 *    붙고 머리줄만 24px 안으로 들어가 있어서, 자식이 부모보다 바깥에 서 있었다 —
 *    눈에는 제출 항목이 마일스톤보다 윗단으로 보였다.
 */
const MILESTONE_DOCUMENT_BLOCK_CLASS = 'grid px-6 pt-1 pb-5';

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
  submissionAccess,
  conflictNotice,
  onRetry,
  onDocumentChange,
  onRefresh = async () => true,
  onSubmitConflict,
}: {
  readonly state: MilestoneDocumentSectionState;
  readonly viewerRole: 'STUDENT' | 'STAFF' | 'ADMIN';
  readonly closed: boolean;
  /**
   * 바로 위 마일스톤 줄이 받은 것과 **같은 값**이다(`ProgramMilestones`가 한 번 구해
   * 둘에게 나눠 준다). 이 값을 안 받던 것이 위아래가 반대되는 말을 하던 원인이다(#1098).
   */
  readonly submissionAccess: MilestoneSubmissionAccess;
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
      <div
        className={`${MILESTONE_DOCUMENT_BLOCK_CLASS} gap-2 text-small text-muted-foreground`}
      >
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
            <StaffDocumentRow key={document.id} document={document} />
          ) : (
            <StudentDocumentRow
              key={document.id}
              document={document}
              fileUpload={state.fileUpload}
              closed={closed}
              submissionAccess={submissionAccess}
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
  submissionAccess,
}: {
  readonly milestoneId: string;
  readonly viewerRole: ViewerRole;
  readonly closed: boolean;
  /** 위 마일스톤 줄과 나눠 갖는 신청 판정 — `ProgramMilestones`가 한 번만 구한다. */
  readonly submissionAccess: MilestoneSubmissionAccess;
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
            ...requireMilestoneDocumentList(
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
      submissionAccess={submissionAccess}
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
                ...previous,
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
    /*
      좁은 화면에서는 이름이 첫 줄을 통째로 쓰고 상태·시각·버튼이 아래로 내려간다
      (`basis-full`). `flex-1`만 두면 이름 칸이 `min-w-0` 을 타고 끝없이 줄어들어
      — 줄이 넘치지 않으니 `flex-wrap` 도 걸리지 않는다 — 390px 에서 「최…」 한
      글자만 남았다. 어느 서류인지가 사라지면 그 아래 배지·버튼도 쓸모가 없다.
      머리줄이 같은 폭 문제를 푸는 방법과 같다(`milestone-row.tsx`).
    */
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

/**
 * 서버가 한 말이 있으면 그것을, 없으면 이 화면의 문구를 보여 준다.
 *
 * ⚠ ProblemDetail이 아닌 응답(`API_000`)의 `detail`은 서버가 한 말이 아니라 api-client가
 *   지어낸 일반 문장이다. 그것을 그대로 붙이면 학생은 자기가 무엇을 하다 실패했는지 알 수
 *   없다 — 이 자리에 개발자용 문장이 붙었던 것이 이 티켓(#1107)의 발단이다.
 */
function submitErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError) || isUnexpectedApiProblem(error)) {
    return fallback;
  }
  return error.problem.detail;
}

/** 교직원 행 — 팀 제출 카운트만 상세 화면에서 읽는다. 양식 관리는 프로그램 편집에 둔다. */
function StaffDocumentRow({
  document,
}: {
  readonly document: MilestoneDocument;
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
        {/*
          양식 교체는 마일스톤 편집이 소유하지만, 교직원이 지금 무엇이 올라가 있는지
          확인할 길은 이 화면에 남아야 한다. 파일명을 링크 이름으로 쓰면 「양식」보다
          무엇을 받는지가 분명하다.
        */}
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
  dueNotice,
}: {
  readonly display: MilestoneDocumentReviewDisplay;
  readonly tone: MilestoneDocumentReviewNoticeTone;
  readonly review: NonNullable<
    NonNullable<MilestoneDocument['viewerSubmission']>['review']
  >;
  /**
   * 재제출 기한을 어떻게 말할지. 적을 것이 없으면 `null`이다
   * (`milestoneDocumentResubmissionDueNotice`가 정한다).
   */
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
          {/*
           * 사유 없는 승인은 애초에 이 상자를 세우지 않는다(위 톤 판정) — 이 대체 문구가
           * 닿는 것은 사유가 필수인데도 비어 온 보완 요청·반려뿐이다. 그 자리에서 상자를
           * 통째로 지우면 학생은 서류가 되돌아온 사실조차 모른다.
           */}
          {review.comment ?? '사유 없이 저장되었습니다.'}
        </span>
        {/*
         * 기한은 사유 **바로 아래**에 둔다. 「무엇을 고쳐야 하는가」와 「언제까지인가」는 학생이
         * 한 번에 읽어야 하는 한 쌍이라, 줄 위쪽 배지 옆으로 떼어 놓으면 사유만 읽고 닫는다.
         * 지난 기한을 함께 말하는 것이 특히 중요하다 — 그 말이 없으면 「수정」 버튼이 왜
         * 잠겼는지 알 길이 없다.
         */}
        {dueNotice === null ? null : (
          <span
            data-testid="milestone-document-resubmission-due"
            className="break-keep font-semibold"
          >
            {/*
             * 연·월·일·시각을 다 적는다(`formatSeoulDate`). 위 제출 시각은 방금 있었던
             * 일이라 「07.29 23:10」로 줄여도 읽히지만, 기한은 **아직 오지 않은 날**이라
             * 해가 빠지면 지난 날짜처럼 읽힌다 — 학생이 이미 늦은 줄 알고 포기한다.
             */}
            {dueNotice.kind === 'open'
              ? `재제출 기한 ${formatSeoulDate(dueNotice.dueAt)}까지 · 한 번 다시 내면 검토가 끝날 때까지 바꿀 수 없습니다`
              : `재제출 기한 ${formatSeoulDate(dueNotice.dueAt)}이 지났습니다 · 담당 교직원에게 문의해 주세요`}
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}

/**
 * 낼 수 없는 사람에게 「올리기」를 **감추지 않고 흐리게** 둔다.
 *
 * 버튼이 통째로 사라지면 학생은 화면이 고장 났다고 읽는다 — 무엇이 있었는지 모른 채
 * 없어진 자리보다, 눌리지 않는 버튼과 그 옆의 이유가 낫다. 이유는 이 줄이 스스로 정하지
 * 않고 `milestoneDocumentSubmitGate`가 정해 준 것을 그대로 적는다.
 */
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

/** 학생 행 — 상태 표시 + 양식 다운로드 + 제출/재제출. */
function StudentDocumentRow({
  document,
  fileUpload,
  closed,
  submissionAccess,
  onRefresh,
  onSubmitConflict,
}: {
  readonly document: MilestoneDocument;
  readonly fileUpload: MilestoneDocumentUploadPolicy;
  readonly closed: boolean;
  readonly submissionAccess: MilestoneSubmissionAccess;
  readonly onRefresh: () => Promise<boolean>;
  readonly onSubmitConflict: (document: MilestoneDocument) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /**
   * 확인 창을 기다리는 제출. 보내기 **전에** 붙잡아 두는 것이 요점이다 — 먼저 보내 놓고
   * 물으면 물어볼 것이 없고, 파일부터 올려 두면 「취소」를 눌러도 그 업로드는 이미
   * 서버에 남는다.
   */
  const [pendingDraft, setPendingDraft] = useState<{
    readonly text: string | null;
    readonly file: File | null;
  } | null>(null);
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
  /** 자격 없음(MSD_005)은 실패가 아니라 상태다 — 재시도 대신 갈 곳을 준다(#1205). */
  const [historyForbidden, setHistoryForbidden] = useState(false);
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
   * 이 줄이 지금 낼 수 있는가, 못 낸다면 **무엇을 먼저 말할 것인가**. 순서를 이 줄에서
   * 다시 짜지 않고 `milestoneDocumentSubmitGate`가 준 답을 그대로 쓴다 — 서류 판정·마감·
   * 신청 상태가 겹칠 때 어느 것을 말할지가 곧 학생이 다음에 할 일을 정하기 때문이다.
   * 위 마일스톤 줄도 같은 모듈의 같은 법칙을 따른다(#1098).
   */
  const gate = milestoneDocumentSubmitGate({
    submissionAccess,
    viewerSubmission,
    closed,
  });

  /**
   * 시간에 기대는 판단들이 보는 「지금」. 렌더 때마다 `Date.now()`를 다시 읽지 않고 **기한이
   * 지나는 그 순간에만** 앞으로 감는다 — 아래 `useEffect`가 그 시각 하나를 겨냥해 깨운다.
   *
   * 열어 둔 화면이 스스로 갱신되지 않으면 안내는 계속 「기한 안입니다」라 말하고 「수정」
   * 버튼도 눌리는 채로 남아, 누른 학생은 서버 422만 받는다.
   */
  const [now, setNow] = useState(() => Date.now());

  /**
   * 지금 내면 되돌릴 수 없는가 — 그렇다면 확인 창을 한 번 지난다. 마감 전 교체는 몇 번이든
   * 되는 일이라 그 자리에서는 묻지 않는다(거짓인 경고를 매번 보면 곧 안 읽는다).
   */
  const resubmissionIsFinal = isMilestoneDocumentResubmissionFinal(
    closed,
    viewerSubmission,
  );
  /** 재제출 기한을 사유 상자 안에 어떻게 적을지. 적을 것이 없으면 `null`이다. */
  const dueNotice = milestoneDocumentResubmissionDueNotice(
    viewerSubmission,
    now,
  );

  const historyMetadata = viewerSubmission?.history;
  /**
   * 기한이 지나는 **그 순간**을 겨냥한 타이머 하나. 없으면 `null`이라 아무것도 걸지 않는다.
   *
   * 값이 `now`에서 나오므로 다른 이유로 다시 그려질 때는 그대로여서 타이머가 다시 걸리지
   * 않는다. 깨어나 `now`가 앞으로 감기면 안내는 「지났습니다」가 되고 이 값은 `null`이 되어
   * 타이머도 스스로 걷힌다.
   *
   * ⚠ 열려 있는 제출 폼은 **닫지 않는다.** 여기서 닫으면 마침 적고 있던 학생의 글이 사라진다.
   * 그 자리는 서버가 422(MSD_034)로 막고, 폼은 실패해도 입력을 그대로 들고 있는다.
   */
  const dueTickDelay = milestoneDocumentResubmissionDueTickDelay(
    viewerSubmission,
    now,
  );
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

  const loadHistory = useCallback(
    async (cursor: string | null) => {
      historyRequestIdRef.current += 1;
      const requestId = historyRequestIdRef.current;
      setIsHistoryLoading(true);
      setHistoryError(null);
      setHistoryForbidden(false);
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
      } catch (reason) {
        if (requestId !== historyRequestIdRef.current) return;
        /*
         * 자격 없음(MSD_005 NOT_APPLICATION_MEMBER)은 실패가 아니라 상태다 — 다시
         * 불러와도 신청 멤버가 되지 는 않으므로 재시도를 주면 같은 거절이 무한히
         * 반복된다(#1205). 조건은 신선도가 아니라 자격이라 갈 곳을 대신 보여 준다.
         * HTTP status로 가르지 않는다 — API_000도 403을 달 수 있고 그건 원인 불명이라
         * 재시도 경로에 남아야 한다.
         */
        if (reason instanceof ApiError && reason.problem.code === 'MSD_005') {
          setHistoryForbidden(true);
          setHistoryErrorCursor(null);
          return;
        }
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

  const send = useCallback(
    async (input: {
      readonly text: string | null;
      readonly file: File | null;
    }): Promise<boolean> => {
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
        setError(
          submitErrorMessage(uploadError, '파일 업로드에 실패했습니다.'),
        );
        setSubmitting(false);
        return false;
      }
    },
    [document.id, document.milestoneId, finish],
  );

  /**
   * 「제출」을 누른 순간 — 되돌릴 수 없는 자리면 확인 창을 한 번 지난다.
   *
   * 확인이 필요한 제출은 **보내지 않고 붙잡아 둔다**(`pendingDraft`). 먼저 보내 놓고 물으면
   * 물어볼 것이 없어지고, 파일부터 올려 두면 학생이 「취소」를 눌러도 그 업로드는
   * 이미 서버에 남는다.
   *
   * 이 함수가 `false`를 돌려주면 폼은 입력을 그대로 들고 있는다 — 확인 창에서 돌아온 학생이
   * 적어 둔 내용과 고른 파일을 다시 채우지 않아도 되게 하려는 것이다. 실제 저장은 확인
   * 뒤 `send`가 하고, 그 결과가 폼을 비운다.
   */
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
      {gate.kind !== 'settled' &&
      submissionAccess.kind !== 'blocked' &&
      syncNotice === null &&
      editing ? (
        <MilestoneDocumentSubmissionForm
          documentName={document.name}
          documentId={document.id}
          fileUpload={fileUpload}
          currentFileName={viewerSubmission?.currentFileName ?? null}
          submitting={submitting}
          onCancel={() => setEditing(false)}
          onSubmit={submitDraft}
        />
      ) : null}
      {/*
       * 되돌릴 수 없는 재제출을 확인받는 자리. 「취소」는 붙잡아 둔 입력을 놓아 줄
       * 뿐이라 폼은 그대로 열려 있고, 적어 둔 내용도 고른 파일도 남는다.
       */}
      {pendingDraft === null ? null : (
        <MilestoneDocumentResubmissionDialog
          documentName={document.name}
          resubmissionDueAt={review?.resubmissionDueAt ?? null}
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
