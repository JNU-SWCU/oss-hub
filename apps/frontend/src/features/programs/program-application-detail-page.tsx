'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { EmptyState, PageHeader, StatusBadge } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { programApplicantsHref } from '@/lib/program-route';
import {
  decideApplication,
  getApplicationDetail,
  type ApplicationDecisionInput,
} from './api';
import { ApplicationDecisionDialog } from './application-decision-dialog';
import { useApplicationDecisionFocusReturn } from './application-decision-focus';
import {
  APPLICATION_STATUS_BADGE,
  APPLICATION_STATUS_LABELS,
  PROVISIONING_LABELS,
  applicationDecisionTriggerId,
  displayAnswerText,
  displayApplicantName,
  formatSubmittedAt,
  participationLabel,
  staleApplicationDecisionTitle,
} from './application-presentation';
import type { ApplicationDecisionAction, ApplicationListItem } from './types';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly application: ApplicationListItem }
  | { readonly kind: 'not-found'; readonly reason: NotFoundReason }
  | { readonly kind: 'error'; readonly message: string };

/**
 * 「없다」의 이유를 갈라 둔다. 학생이 먼저 취소한 것과 주소가 틀린 것은 교직원이
 * 다음에 할 일이 다른데, 하나로 뭉치면 「주소가 잘못되었습니다」가 멀쩡한 주소를
 * 쓴 사람에게도 나간다.
 */
type NotFoundReason = 'missing' | 'other-program' | 'cancelled-while-deciding';

const NOT_FOUND_COPY: Readonly<
  Record<
    NotFoundReason,
    { readonly title: string; readonly description: string }
  >
> = {
  missing: {
    title: '신청을 찾을 수 없습니다',
    description: '이미 취소되었거나 주소가 잘못되었습니다.',
  },
  'other-program': {
    title: '이 프로그램의 신청이 아닙니다',
    description:
      '주소의 프로그램과 신청이 서로 다릅니다. 신청자 목록에서 다시 열어 주세요.',
  },
  'cancelled-while-deciding': {
    title: '신청이 이미 취소되었습니다',
    description:
      '승인·반려하려는 사이에 학생이 신청을 취소했습니다. 방금 고른 내용은 저장되지 않았습니다.',
  },
};

type Notice = {
  readonly kind: 'success' | 'error';
  readonly title: string;
  readonly message: string;
} | null;

function DetailSkeleton(): ReactElement {
  return (
    <main
      className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-8"
      aria-label="신청 상세 불러오는 중"
    >
      <div className="h-20 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-56 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-40 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
    </main>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}): ReactElement {
  return (
    <section className="grid gap-4 rounded-card border border-border p-card">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Row({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): ReactElement {
  return (
    <div className="grid gap-1">
      <dt className="text-small text-muted-foreground">{label}</dt>
      <dd className="break-keep [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

/**
 * #722 교직원 신청 상세. 목록의 「보기」가 도착하는 자리다.
 *
 * 이 화면이 있기 전까지 교직원은 **지원 동기·계획을 못 본 채 제목만으로 판정**했다.
 * 그래서 지원 내용을 먼저 그리고, 판정 조작은 그 아래에 둔다 — 읽고 나서 누르는
 * 순서를 화면 순서로 만든다.
 *
 * 판정 확인창·표기 규칙·낡은 상태 판별은 목록 화면과 같은 것을 쓴다.
 */
export function ProgramApplicationDetailPage({
  programId,
  applicationId,
}: {
  readonly programId: string;
  readonly applicationId: string;
}): ReactElement {
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [dialogAction, setDialogAction] =
    useState<ApplicationDecisionAction | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  /**
   * 판정 저장이 실패했는데 확인창은 열려 있는 경우의 안내.
   * ⚠ 화면 위쪽 `notice` 에 그리면 **확인창 뒤에 가려** 교직원이 못 본다([#734]).
   */
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const cancelled = useRef(false);
  /**
   * 확인창이 **스스로** 닫힌 뒤 판정 버튼으로 포커스를 돌려준다([#767]).
   * ⚠ 재조회가 끝난 **뒤에** 불러야 한다 — 승인에 성공하면 새 버튼(「검토 대기로」)은
   *   재조회 결과가 그려진 뒤에야 생긴다. 목록 화면과 같은 규칙을 쓴다.
   */
  const requestDecisionFocusReturn = useApplicationDecisionFocusReturn();

  const openDecisionDialog = useCallback(
    (action: ApplicationDecisionAction): void => {
      setDecisionError(null);
      setDialogAction(action);
    },
    [],
  );

  const reload = useCallback(async (): Promise<void> => {
    const application = await getApplicationDetail(applicationId);
    if (cancelled.current) return;
    // 조회는 신청 id 하나로 도달한다 — 주소의 프로그램과 다르면 사이드바·뒤로가기는
    // A 를 가리키는데 판정 버튼은 B 를 바꾸게 된다. 그리지 않고 막는다.
    if (application.programId !== programId) {
      setLoadState({ kind: 'not-found', reason: 'other-program' });
      return;
    }
    setLoadState({ kind: 'ready', application });
  }, [applicationId, programId]);

  const load = useCallback(async (): Promise<void> => {
    setLoadState({ kind: 'loading' });
    try {
      await reload();
    } catch (error: unknown) {
      if (cancelled.current) return;
      if (error instanceof ApiError && error.problem.status === 404)
        setLoadState({ kind: 'not-found', reason: 'missing' });
      else if (error instanceof ApiError && error.problem.status === 403)
        setLoadState({
          kind: 'error',
          message:
            error.problem.detail ??
            '승인된 교직원 또는 관리자만 조회할 수 있습니다.',
        });
      else
        setLoadState({
          kind: 'error',
          message: '신청 상세를 불러오지 못했습니다.',
        });
    }
  }, [reload]);

  useEffect(() => {
    cancelled.current = false;
    void load();
    return () => {
      cancelled.current = true;
    };
  }, [load]);

  const submitDecision = useCallback(async (): Promise<void> => {
    if (dialogAction === null) return;
    const reason = rejectionReason.trim();
    if (dialogAction === 'REJECT' && !reason) {
      setReasonError(true);
      return;
    }
    const input: ApplicationDecisionInput =
      dialogAction === 'APPROVE'
        ? { action: 'APPROVE' }
        : dialogAction === 'REJECT'
          ? { action: 'REJECT', reason }
          : { action: 'REVERT' };
    const decidedAction = dialogAction;
    setBusy(true);
    setNotice(null);
    setDecisionError(null);
    try {
      const result = await decideApplication(applicationId, input);
      setDialogAction(null);
      setRejectionReason('');
      try {
        await reload();
        setNotice({
          kind: 'success',
          title:
            result.status === 'APPROVED'
              ? '승인을 저장했습니다'
              : result.status === 'REJECTED'
                ? '반려를 저장했습니다'
                : '검토 대기로 되돌렸습니다',
          message:
            result.status === 'APPROVED'
              ? '승인 결과와 저장소 작업 상태를 다시 불러왔습니다.'
              : result.status === 'REJECTED'
                ? '반려 결과를 다시 불러왔습니다.'
                : '신청을 다시 검토 대기 상태로 불러왔습니다.',
        });
      } catch {
        setNotice({
          kind: 'error',
          title: '저장은 되었지만 최신 상태를 불러오지 못했습니다',
          message: '이 화면을 다시 불러와 최신 상태를 확인해 주세요.',
        });
      }
      requestDecisionFocusReturn(decidedAction);
    } catch (error: unknown) {
      const staleTitle = staleApplicationDecisionTitle(error);
      if (staleTitle !== null) {
        setDialogAction(null);
        try {
          await reload();
          setNotice({
            kind: 'error',
            title: staleTitle,
            message: '최신 상태를 다시 불러왔습니다.',
          });
        } catch (reloadError: unknown) {
          // 학생이 먼저 취소해 신청 자체가 사라진 경우다. 없는 것을 계속 그리면
          // 교직원이 같은 404를 반복해 만난다.
          if (
            reloadError instanceof ApiError &&
            reloadError.problem.status === 404
          ) {
            setLoadState({
              kind: 'not-found',
              reason: 'cancelled-while-deciding',
            });
          } else {
            setNotice({
              kind: 'error',
              title: '최신 상태 확인 실패',
              message: '현재 상태를 유지했습니다. 다시 시도해 주세요.',
            });
          }
        }
        requestDecisionFocusReturn(decidedAction);
      } else
        // 확인창은 열린 채로 둔다(적어 둔 사유를 잃지 않게) — 그래서 안내도 창 안에 그린다.
        setDecisionError(
          '입력과 현재 상태를 유지했습니다. 다시 시도해 주세요.',
        );
    } finally {
      setBusy(false);
    }
  }, [
    applicationId,
    dialogAction,
    rejectionReason,
    reload,
    requestDecisionFocusReturn,
  ]);

  if (loadState.kind === 'loading') return <DetailSkeleton />;

  if (loadState.kind === 'not-found' || loadState.kind === 'error') {
    const copy =
      loadState.kind === 'not-found'
        ? NOT_FOUND_COPY[loadState.reason]
        : {
            title: '신청 상세를 열 수 없습니다',
            description: loadState.message,
          };
    return (
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
        <PageHeader title="신청 상세" />
        <EmptyState
          title={copy.title}
          description={copy.description}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {/*
               * 일시적 실패에 다시 시도가 없으면 교직원은 목록으로 돌아가 「보기」를
               * 다시 누르거나 브라우저를 새로고침해야 한다(목록 화면은 이미 준다).
               */}
              {loadState.kind === 'error' ? (
                <Button onClick={() => void load()}>다시 시도</Button>
              ) : null}
              <Button asChild variant="outline">
                <Link href={programApplicantsHref(programId)}>
                  신청자 목록으로
                </Link>
              </Button>
            </div>
          }
        />
      </main>
    );
  }

  const { application } = loadState;
  const decidable = application.status === 'SUBMITTED';
  const revertable =
    application.status === 'APPROVED' || application.status === 'REJECTED';

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
      <Button asChild variant="ghost" size="sm">
        <Link href={programApplicantsHref(programId)}>← 신청자 목록으로</Link>
      </Button>
      <PageHeader
        title={`${displayApplicantName(application)} · ${participationLabel(application)}`}
        description={`${formatSubmittedAt(application.submittedAt)} 제출`}
        actions={
          <StatusBadge variant={APPLICATION_STATUS_BADGE[application.status]}>
            {APPLICATION_STATUS_LABELS[application.status]}
          </StatusBadge>
        }
      />

      {notice ? (
        <Alert variant={notice.kind === 'error' ? 'destructive' : 'default'}>
          <AlertTitle className="break-keep">{notice.title}</AlertTitle>
          <AlertDescription className="break-keep">
            {notice.message}
          </AlertDescription>
        </Alert>
      ) : null}

      {/*
       * 반려 사유는 지원 내용보다 위다 — 이 신청을 다시 열어 보는 이유가 대개
       * "내가 왜 반려했더라"이기 때문이다.
       */}
      {application.status === 'REJECTED' && application.rejectionReason ? (
        <Alert variant="destructive">
          <AlertTitle>반려 사유</AlertTitle>
          <AlertDescription className="break-keep whitespace-pre-wrap [overflow-wrap:anywhere]">
            {application.rejectionReason}
          </AlertDescription>
        </Alert>
      ) : null}

      <Section title="지원 내용">
        <dl className="grid gap-4">
          <Row
            label="제목"
            value={displayAnswerText(application.answers.title)}
          />
          <div className="grid gap-1">
            <dt className="text-small text-muted-foreground">
              지원 동기 · 계획
            </dt>
            <dd className="rounded-card bg-muted p-4 break-keep whitespace-pre-wrap [overflow-wrap:anywhere]">
              {displayAnswerText(application.answers.summary)}
            </dd>
          </div>
        </dl>
      </Section>

      <Section title="신청 정보">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Row
            label="신청 구분"
            value={application.participation === 'TEAM' ? '팀' : '개인'}
          />
          <Row label="팀" value={application.team?.name ?? '없음(개인 신청)'} />
          <Row
            label="신청자"
            value={`${displayAnswerText(application.applicant.name ?? '') || displayAnswerText(application.applicant.nickname)} (@${displayAnswerText(application.applicant.nickname)})`}
          />
          <Row
            label="신청서에 적은 이름"
            value={displayAnswerText(application.answers.applicantName)}
          />
          <Row
            label="저장소 공개 예정"
            value={application.isRepositoryPublicationPlanned ? '예' : '아니요'}
          />
          {/*
           * 승인이 무엇을 하는지는 프로그램 스위치 하나로 정해지지 않는다 —
           * 신청자가 `OWN`을 골랐으면 새로 만드는 게 아니라 낸 저장소를 잇는다.
           * 그것을 보지 못한 채 승인하면 교직원은 자기가 무엇을 승인했는지 모른다.
           */}
          <Row
            label="저장소"
            value={
              application.repositoryConnectionMode === 'OWN'
                ? '신청자가 낸 저장소를 잇습니다'
                : application.repositoryProvisioning.enabled
                  ? '자동 생성 켜짐'
                  : '자동 생성 꺼짐'
            }
          />
          {/*
           * 작업 상태는 **자동 생성이 꺼져 있어도** 말한다. 교직원이 나중에 스위치를
           * 끄면 이미 만들어진 저장소의 `SUCCEEDED`·`FAILED`·`ANOMALOUS` 가 남는데,
           * 「꺼짐」으로 덮으면 목록이 "확인 필요"라고 경고하는 신청을 상세에서는
           * 아무 일 없는 것으로 읽는다.
           */}
          <Row
            label="저장소 작업"
            value={
              PROVISIONING_LABELS[application.repositoryProvisioning.jobStatus]
            }
          />
          {application.repositoryConnectionMode === 'OWN' ? (
            <Row
              label="이을 저장소 주소"
              value={application.repositoryUrl ?? '아직 없음'}
            />
          ) : null}
        </dl>
        {application.repository ? (
          <p className="text-small">
            저장소{' '}
            <a
              className="font-semibold break-all underline underline-offset-4"
              href={application.repository.url}
              rel="noreferrer noopener"
              target="_blank"
            >
              {application.repository.url}
            </a>{' '}
            (
            {application.repository.visibility === 'PUBLIC' ? '공개' : '비공개'}
            )
          </p>
        ) : null}
      </Section>

      {/*
       * 판정 버튼마다 고정 id 를 준다 — 확인창이 닫힐 때 이 id 로 포커스를 돌려준다.
       * 없으면 키보드로 판정하던 사람이 창을 닫는 순간 문서 맨 앞으로 튕긴다.
       *
       * 목록에서 행 단위 판정이 사라지면 이 자리가 유일한 판정 지점이다 — 확인창을
       * 여는 트리거 버튼 그룹이라 폼 제출·다이얼로그 푸터와 같은 우측 정렬을 쓴다
       * (`docs/rules/frontend.md`, `program-edit-lifecycle-section.tsx`와 같은 규칙 —
       * 그쪽도 페이지 안에서 확인창을 여는 단일 트리거 버튼을 우측 정렬한다). 목록
       * 행의 인라인 액션 예외는 여기 해당하지 않는다 — 행이 아니라 화면 전체의
       * 유일한 판정 지점이다.
       */}
      <div className="flex flex-wrap justify-end gap-2">
        {decidable ? (
          <>
            <Button
              id={applicationDecisionTriggerId('APPROVE')}
              disabled={busy}
              onClick={() => openDecisionDialog('APPROVE')}
            >
              승인
            </Button>
            <Button
              id={applicationDecisionTriggerId('REJECT')}
              variant="outline"
              disabled={busy}
              onClick={() => {
                setReasonError(false);
                setRejectionReason('');
                openDecisionDialog('REJECT');
              }}
            >
              반려
            </Button>
          </>
        ) : null}
        {revertable ? (
          <Button
            id={applicationDecisionTriggerId('REVERT')}
            variant="ghost"
            disabled={busy}
            onClick={() => openDecisionDialog('REVERT')}
          >
            검토 대기로
          </Button>
        ) : null}
      </div>

      {dialogAction !== null ? (
        <ApplicationDecisionDialog
          action={dialogAction}
          currentStatus={application.status}
          applicantName={displayApplicantName(application)}
          teamName={application.team ? application.team.name : null}
          applicationTitle={displayAnswerText(application.answers.title)}
          repositoryProvisioningEnabled={
            application.repositoryProvisioning.enabled
          }
          repositoryConnectionMode={application.repositoryConnectionMode}
          reason={rejectionReason}
          reasonError={reasonError}
          busy={busy}
          errorMessage={decisionError}
          returnFocusId={applicationDecisionTriggerId(dialogAction)}
          onReasonChange={(value) => {
            setRejectionReason(value);
            setReasonError(false);
          }}
          onCancel={() => setDialogAction(null)}
          onConfirm={() => void submitDecision()}
        />
      ) : null}
    </main>
  );
}
