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
import {
  APPLICATION_STATUS_BADGE,
  APPLICATION_STATUS_LABELS,
  PROVISIONING_LABELS,
  displayApplicantName,
  formatSubmittedAt,
  participationLabel,
  staleApplicationDecisionTitle,
} from './application-presentation';
import type { ApplicationDecisionAction, ApplicationListItem } from './types';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly application: ApplicationListItem }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'error'; readonly message: string };

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
      <dd className="break-keep">{value}</dd>
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
  const cancelled = useRef(false);

  const reload = useCallback(async (): Promise<void> => {
    const application = await getApplicationDetail(applicationId);
    if (cancelled.current) return;
    setLoadState({ kind: 'ready', application });
  }, [applicationId]);

  const load = useCallback(async (): Promise<void> => {
    setLoadState({ kind: 'loading' });
    try {
      await reload();
    } catch (error: unknown) {
      if (cancelled.current) return;
      if (error instanceof ApiError && error.problem.status === 404)
        setLoadState({ kind: 'not-found' });
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
    setBusy(true);
    setNotice(null);
    try {
      const result = await decideApplication(applicationId, input);
      setDialogAction(null);
      setRejectionReason('');
      try {
        await reload();
        setNotice({
          kind: 'success',
          title: '판정이 저장되었습니다',
          message:
            result.status === 'APPROVED'
              ? '승인 결과와 저장소 작업 상태를 다시 불러왔습니다.'
              : result.status === 'REJECTED'
                ? '반려 결과를 다시 불러왔습니다.'
                : '되돌린 결과를 다시 불러왔습니다.',
        });
      } catch {
        setNotice({
          kind: 'error',
          title: '판정은 저장되었지만 최신 상태를 불러오지 못했습니다',
          message: '이 화면을 다시 불러와 최신 상태를 확인해 주세요.',
        });
      }
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
            setLoadState({ kind: 'not-found' });
          } else {
            setNotice({
              kind: 'error',
              title: '최신 상태 확인 실패',
              message: '현재 상태를 유지했습니다. 다시 시도해 주세요.',
            });
          }
        }
      } else
        setNotice({
          kind: 'error',
          title: '판정을 저장하지 못했습니다',
          message: '입력과 현재 상태를 유지했습니다. 다시 시도해 주세요.',
        });
    } finally {
      setBusy(false);
    }
  }, [applicationId, dialogAction, rejectionReason, reload]);

  if (loadState.kind === 'loading') return <DetailSkeleton />;

  if (loadState.kind === 'not-found' || loadState.kind === 'error') {
    return (
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
        <PageHeader title="신청 상세" />
        <EmptyState
          title={
            loadState.kind === 'not-found'
              ? '신청을 찾을 수 없습니다'
              : '신청 상세를 열 수 없습니다'
          }
          description={
            loadState.kind === 'not-found'
              ? '이미 취소되었거나 주소가 잘못되었습니다.'
              : loadState.message
          }
          action={
            <Button asChild variant="outline">
              <Link href={programApplicantsHref(programId)}>
                신청자 목록으로
              </Link>
            </Button>
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
          <AlertDescription className="break-keep whitespace-pre-wrap">
            {application.rejectionReason}
          </AlertDescription>
        </Alert>
      ) : null}

      <Section title="지원 내용">
        <dl className="grid gap-4">
          <Row label="제목" value={application.answers.title} />
          <div className="grid gap-1">
            <dt className="text-small text-muted-foreground">
              지원 동기 · 계획
            </dt>
            <dd className="rounded-card bg-muted p-4 break-keep whitespace-pre-wrap">
              {application.answers.summary}
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
            value={`${application.applicant.name ?? application.applicant.nickname} (@${application.applicant.nickname})`}
          />
          <Row
            label="신청서에 적은 이름"
            value={application.answers.applicantName}
          />
          <Row
            label="저장소 공개 예정"
            value={application.isRepositoryPublicationPlanned ? '예' : '아니요'}
          />
          <Row
            label="저장소 자동 생성"
            value={
              application.repositoryProvisioning.enabled
                ? `켜짐 — ${PROVISIONING_LABELS[application.repositoryProvisioning.jobStatus]}`
                : '꺼짐'
            }
          />
        </dl>
        {application.repository ? (
          <p className="text-small">
            저장소{' '}
            <a
              className="font-semibold underline underline-offset-4"
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

      <div className="flex flex-wrap gap-2">
        {decidable ? (
          <>
            <Button disabled={busy} onClick={() => setDialogAction('APPROVE')}>
              승인
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setReasonError(false);
                setRejectionReason('');
                setDialogAction('REJECT');
              }}
            >
              반려
            </Button>
          </>
        ) : null}
        {revertable ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setDialogAction('REVERT')}
          >
            되돌리기
          </Button>
        ) : null}
      </div>

      {dialogAction !== null ? (
        <ApplicationDecisionDialog
          action={dialogAction}
          repositoryProvisioningEnabled={
            application.repositoryProvisioning.enabled
          }
          reason={rejectionReason}
          reasonError={reasonError}
          busy={busy}
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
