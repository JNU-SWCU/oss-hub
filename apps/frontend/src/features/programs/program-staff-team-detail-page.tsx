'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pencil } from 'lucide-react';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ApiError } from '@/lib/api-client';
import { Select } from '@/components/ui/select';
import {
  decideApplication,
  getApplicationDetailWithHistory,
  getStaffProgramTeamDetail,
  type ApplicationDecisionInput,
} from './api';
import {
  blocksFurtherDecisions,
  runDecisionWithRefetch,
} from './application-decision-refetch';
import { ApplicationDecisionDialog } from './application-decision-dialog';
import { ReviewHistoryTimeline } from './review-history-timeline';
import { programHref } from './program-paths';
import {
  APPLICATION_STATUS_BADGE,
  APPLICATION_STATUS_LABELS,
  displayAnswerText,
} from './application-presentation';
import { ProgramStaffRepositorySection } from './program-staff-repository-section';
import { StaffRepositoryEvidenceView } from './staff-repository-evidence-view';
import { TeamDeleteDialog } from './team-delete-dialog';
import { TeamNameDialog } from './team-name-dialog';
import type {
  ApplicationDetail,
  ApplicationStatus,
  StaffTeamDetail,
} from './types';

/** 교직원이 고를 수 있는 세 상태. 어느 출발점에서도 셋 다 항상 고를 수 있다(AC-14). */
const DECISION_OPTIONS: readonly ApplicationStatus[] = [
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
];

function decisionInputFor(
  next: ApplicationStatus,
  reason: string,
): ApplicationDecisionInput | null {
  if (next === 'APPROVED') return { action: 'APPROVE' };
  if (next === 'SUBMITTED') return { action: 'REVERT' };
  const trimmed = reason.trim();
  return trimmed === '' ? null : { action: 'REJECT', reason: trimmed };
}

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly detail: StaffTeamDetail }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'error'; readonly message: string };

function DetailSkeleton(): ReactElement {
  return (
    <main
      className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-8"
      aria-label="팀 상세 불러오는 중"
    >
      <div className="h-20 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-40 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-40 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
    </main>
  );
}

function Section({
  title,
  meta,
  children,
  headingClassName = 'font-semibold',
}: {
  readonly title: string;
  /**
   * 머리말 오른쪽에 붙는 수·단위. 공용 `SectionHeading`의 `meta`와 같은 역할이고
   * 같은 키울을 쓴다 — 이 페이지는 카드 안 머리말이라 제목 크기만 다르다.
   */
  readonly meta?: string;
  readonly children: React.ReactNode;
  readonly headingClassName?: string;
}): ReactElement {
  return (
    <section className="grid gap-4 rounded-card border border-border p-card">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={headingClassName}>{title}</h2>
        {meta ? (
          <span className="text-small text-muted-foreground">{meta}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * 교직원 전용 팀 상세(#874). 참여 팀 목록(`ProgramStaffTeamsPage`)의 팀명에서
 * 들어오는 문맥 경로다.
 *
 * 데이터는 백엔드가 **한 요청으로** 팀원·신청 상태·저장소 발급 상태를 합쳐 준다
 * (`getStaffProgramTeamDetail`) — 참여 팀 목록처럼 팀 목록과 신청 목록을 따로
 * 불러 클라이언트에서 잇지 않는다.
 */
export function ProgramStaffTeamDetailPage({
  programId,
  teamId,
}: {
  readonly programId: string;
  readonly teamId: string;
}): ReactElement {
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /**
   * 이번 방문에서 이름을 바꿨는지. 바뀐 이름 자체는 `detail.name`이 이미 들고
   * 있어 여기에 다시 담지 않는다 — 같은 값을 두 곳에 두면 어느 쪽이 참인지 갈린다.
   */
  const [justRenamed, setJustRenamed] = useState(false);
  /** 신청서 본문과 검토 이력. 팀 상세 응답은 요약만 주므로 따로 읽는다. */
  const [applicationDetail, setApplicationDetail] =
    useState<ApplicationDetail | null>(null);
  const [answersOpen, setAnswersOpen] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decisionBlocked, setDecisionBlocked] = useState(false);
  const [decisionNotice, setDecisionNotice] = useState<string | null>(null);
  const [pendingReject, setPendingReject] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const cancelled = useRef(false);
  /** 창이 닫힐 때 초점을 돌려줄 자리. 공용 창 껍데기가 이 ref를 받는다. */
  const renameTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const router = useRouter();

  const load = useCallback(async (): Promise<void> => {
    setLoadState({ kind: 'loading' });
    try {
      const detail = await getStaffProgramTeamDetail(programId, teamId);
      if (cancelled.current) return;
      setLoadState({ kind: 'ready', detail });
    } catch (error: unknown) {
      if (cancelled.current) return;
      if (error instanceof ApiError && error.problem.status === 404) {
        setLoadState({ kind: 'not-found' });
      } else {
        setLoadState({
          kind: 'error',
          message:
            error instanceof ApiError
              ? error.problem.detail
              : '팀 상세를 불러오지 못했습니다.',
        });
      }
    }
  }, [programId, teamId]);

  useEffect(() => {
    cancelled.current = false;
    void load();
    return () => {
      cancelled.current = true;
    };
  }, [load]);

  const applicationId =
    loadState.kind === 'ready'
      ? (loadState.detail.application?.id ?? null)
      : null;

  const loadApplication = useCallback(async (): Promise<void> => {
    if (applicationId === null) {
      setApplicationDetail(null);
      return;
    }
    try {
      const detail = await getApplicationDetailWithHistory(applicationId);
      if (!cancelled.current) setApplicationDetail(detail);
    } catch {
      // 신청서를 못 읽어도 팀 정보는 그대로 보인다 — 이 화면 전체를 실패로 접지 않는다.
      if (!cancelled.current) setApplicationDetail(null);
    }
  }, [applicationId]);

  useEffect(() => {
    void loadApplication();
  }, [loadApplication]);

  const applyDecision = useCallback(
    async (next: ApplicationStatus, why: string): Promise<void> => {
      if (applicationId === null) return;
      const input = decisionInputFor(next, why);
      if (input === null) {
        setReasonError(true);
        return;
      }
      setDecisionBusy(true);
      const result = await runDecisionWithRefetch({
        decide: () => decideApplication(applicationId, input),
        refetch: () => getApplicationDetailWithHistory(applicationId),
      });
      if (cancelled.current) return;
      setDecisionBusy(false);
      setPendingReject(false);
      setReason('');
      setReasonError(false);

      if (result.kind === 'refetch-failed') {
        setDecisionBlocked(true);
        setDecisionNotice(
          '판정 결과를 확인하지 못했습니다. 새로고침한 뒤 이 신청의 상태를 다시 확인해 주세요.',
        );
        return;
      }
      if (result.kind === 'removed') {
        setApplicationDetail(null);
        setDecisionNotice('이 신청은 더 이상 없습니다.');
        return;
      }
      setDecisionNotice(
        result.outcome.kind === 'stale'
          ? '다른 사람이 먼저 판정했습니다. 최신 상태로 갱신했습니다.'
          : result.outcome.kind === 'unknown'
            ? '판정 요청이 실패했습니다. 갱신한 상태를 보고 다시 시도해 주세요.'
            : null,
      );
      if (blocksFurtherDecisions(result)) return;
      // 판정은 팀 상세의 요약 배지도 바꾼다 — 둘을 같이 다시 읽어야 한 화면이 두
      // 이야기를 하지 않는다.
      await Promise.all([loadApplication(), load()]);
    },
    [applicationId, loadApplication, load],
  );

  const teamsHref = programHref(programId, '/teams');

  if (loadState.kind === 'loading') return <DetailSkeleton />;

  if (loadState.kind === 'not-found' || loadState.kind === 'error') {
    const copy =
      loadState.kind === 'not-found'
        ? {
            title: '팀을 찾을 수 없습니다',
            description: '이 프로그램의 팀이 아니거나 주소가 잘못되었습니다.',
          }
        : { title: '팀 상세를 열 수 없습니다', description: loadState.message };
    return (
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
        <PageHeader title="팀 상세" />
        <EmptyState
          title={copy.title}
          description={copy.description}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {loadState.kind === 'error' ? (
                <Button onClick={() => void load()}>다시 시도</Button>
              ) : null}
              <Button asChild variant="outline">
                <Link href={teamsHref}>참여 팀으로</Link>
              </Button>
            </div>
          }
        />
      </main>
    );
  }

  const { detail } = loadState;
  const { application } = detail;

  return (
    // 툴팁 지연은 마일스톤 카드와 같은 200ms다 — 같은 종류의 보조 액션이 화면마다
    // 다른 속도로 뜨면 같은 조작이 다르게 느껴진다.
    <TooltipProvider delayDuration={200}>
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
        <Button asChild variant="ghost" size="sm">
          <Link href={teamsHref}>← 참여 팀으로</Link>
        </Button>
        <PageHeader
          title={detail.name}
          /*
           * 인원수를 제목 아래에 두지 않는다 — 「한빛 팀 / 팀원 3명 / 팀원」으로 한
           * 눈에 「팀」이 세 번 서고, 정작 그 수를 설명하는 명단은 아래 섹션에 있다.
           * 수는 그 명단의 머리말이 말한다(`섹션 title·meta`).
           */
          /*
           * 수정은 제목 문자열을 대상으로 하므로 제목 옆이다. 우측 `actions`는
           * 신청 상태 배지가 쓰는 자리라 둘을 한 덩어리로 묶으면 연필이 배지를
           * 가리키는 것처럼 읽힌다.
           */
          titleAction={
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  ref={renameTriggerRef}
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`${detail.name} 수정`}
                  onClick={() => setRenaming(true)}
                >
                  <Pencil aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{`${detail.name} 수정`}</TooltipContent>
            </Tooltip>
          }
          /*
           * 신청이 없으면 배지 자체를 그리지 않는다(#1272). 없는 신청에 배지를 달면
           * 대기 중인 신청처럼 읽혀 교직원이 처리할 것이 있다고 오해한다 — 상태가
           * 아니라 상태가 없는 것이므로 헤더는 조용히 비운다. 아래 「검토하기」도
           * 같은 이유로 없다.
           */
          actions={
            application === null ? undefined : (
              <StatusBadge
                variant={APPLICATION_STATUS_BADGE[application.status]}
              >
                {APPLICATION_STATUS_LABELS[application.status]}
              </StatusBadge>
            )
          }
        />

        {/*
         * 바뀐 이름을 여기서 다시 말하지 않는다 — 바로 위 제목이 그 이름이다.
         * 이 줄이 말하는 것은 「저장됐다」는 사실 하나다.
         */}
        {justRenamed ? (
          <Alert>
            <AlertTitle>팀 이름을 바꿨습니다</AlertTitle>
          </Alert>
        ) : null}

        <Section title="팀원" meta={`${detail.memberCount}명`}>
          <ul className="grid gap-3">
            {detail.members.map((member) => (
              <li
                key={member.userId}
                className="flex items-center justify-between gap-2 break-keep"
              >
                <div className="grid gap-0.5">
                  <span>{member.name ?? member.nickname}</span>
                  <span className="text-xs text-muted-foreground">
                    @{member.nickname}
                  </span>
                </div>
                {member.isLeader ? (
                  <StatusBadge variant="recruiting" size="default">
                    팀장
                  </StatusBadge>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="저장소"
          headingClassName="rounded-control bg-primary px-4 py-3 font-semibold text-primary-foreground"
        >
          <ProgramStaffRepositorySection application={application} />
          <StaffRepositoryEvidenceView
            evidence={detail}
            members={detail.members}
            programId={programId}
            teamId={teamId}
          />
        </Section>

        {/*
         * 신청서는 이 화면이 직접 그린다 — 예전에는 「검토하기」로 별도 상세 화면에
         * 보냈고, 교직원이 팀과 신청을 보려고 두 화면을 오갔다. 그 이동이 사라졌다.
         *
         * 본문은 접어 둔다. 이 화면을 여는 이유는 대개 「누가 냈고 지금 어떤 상태인가」
         * 이고, 신청서 전문은 그다음에 필요해진다(progressive disclosure).
         */}
        {applicationDetail !== null ? (
          <Section title="신청서">
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Select
                  id="team-detail-application-status"
                  aria-label="신청 상태"
                  className="max-w-[12rem]"
                  value={applicationDetail.status}
                  disabled={decisionBusy || decisionBlocked}
                  onChange={(event) => {
                    const next = event.target.value as ApplicationStatus;
                    if (next === applicationDetail.status) return;
                    if (next === 'REJECTED') {
                      setReason('');
                      setReasonError(false);
                      setPendingReject(true);
                      return;
                    }
                    void applyDecision(next, '');
                  }}
                >
                  {DECISION_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {APPLICATION_STATUS_LABELS[status]}
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-expanded={answersOpen}
                  onClick={() => setAnswersOpen((open) => !open)}
                >
                  {answersOpen ? '내용 접기' : '내용 보기'}
                </Button>
              </div>

              {decisionNotice !== null ? (
                <p role="status" className="text-small text-muted-foreground">
                  {decisionNotice}
                </p>
              ) : null}

              {/*
               * 반려 사유는 신청서 본문보다 위다 — 이 신청을 다시 여는 이유가 대개
               * 「왜 반려됐나」이기 때문이다.
               */}
              {applicationDetail.rejectionReason !== null ? (
                <Alert variant="destructive">
                  <AlertTitle>반려 사유</AlertTitle>
                  <AlertDescription className="break-keep">
                    {applicationDetail.rejectionReason}
                  </AlertDescription>
                </Alert>
              ) : null}

              {answersOpen ? (
                <div className="grid gap-3 rounded-control border border-border p-4">
                  <div className="grid gap-0.5">
                    <span className="text-small text-muted-foreground">
                      신청서에 적은 이름
                    </span>
                    <span className="break-keep [overflow-wrap:anywhere]">
                      {displayAnswerText(
                        applicationDetail.answers.applicantName,
                      )}
                    </span>
                  </div>
                  <div className="grid gap-0.5">
                    <span className="text-small text-muted-foreground">
                      지원 동기 · 계획
                    </span>
                    <p className="break-keep whitespace-pre-wrap [overflow-wrap:anywhere]">
                      {displayAnswerText(applicationDetail.answers.summary)}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </Section>
        ) : null}

        {applicationDetail !== null ? (
          <Section title="검토 이력">
            <ReviewHistoryTimeline entries={applicationDetail.reviewHistory} />
          </Section>
        ) : null}

        <Section title="위험 영역">
          <p className="text-body text-muted-foreground [word-break:keep-all]">
            연결된 데이터와 관련 기록을 포함해 되돌릴 수 없이 삭제합니다.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              ref={deleteTriggerRef}
              type="button"
              variant="destructive"
              onClick={() => setDeleting(true)}
            >
              팀 삭제
            </Button>
          </div>
        </Section>

        {pendingReject && applicationDetail !== null ? (
          <ApplicationDecisionDialog
            action="REJECT"
            currentStatus={applicationDetail.status}
            applicantName={
              applicationDetail.applicant.name ??
              applicationDetail.applicant.nickname
            }
            teamName={detail.name}
            reason={reason}
            reasonError={reasonError}
            busy={decisionBusy}
            errorMessage={null}
            returnFocusId="team-detail-application-status"
            onReasonChange={(value) => {
              setReason(value);
              if (value.trim() !== '') setReasonError(false);
            }}
            onCancel={() => {
              setPendingReject(false);
              setReason('');
              setReasonError(false);
            }}
            onConfirm={() => {
              void applyDecision('REJECTED', reason);
            }}
          />
        ) : null}
        {renaming ? (
          <TeamNameDialog
            programId={programId}
            teamId={teamId}
            currentName={detail.name}
            returnFocusRef={renameTriggerRef}
            onCancel={() => setRenaming(false)}
            onRenamed={(name) => {
              setRenaming(false);
              setJustRenamed(true);
              /*
               * 바뀐 이름만 덮어 쓴다 — 상세를 다시 불러오면 화면이 스켈레톤으로
               * 갈아끼워져, 바꾼 사실을 확인하려는 사람 앞에서 화면이 한 번 비운다.
               * 이름 밖의 값은 이 요청이 바꾸지 않는다.
               */
              setLoadState((current) =>
                current.kind === 'ready'
                  ? { ...current, detail: { ...current.detail, name } }
                  : current,
              );
            }}
          />
        ) : null}
        {deleting ? (
          <TeamDeleteDialog
            programId={programId}
            teamId={teamId}
            teamName={detail.name}
            scope={detail.deletionScope}
            onCancel={() => {
              setDeleting(false);
              requestAnimationFrame(() => deleteTriggerRef.current?.focus());
            }}
            onDeleted={() => {
              /*
               * 참여 팀 목록은 아직 삭제 결과 알림을 읽지 않는다.
               * 쿼리만 붙이면 아무도 읽지 않는 죽은 값이 되고, `purged` 키는
               * 프로그램 전체 삭제 말투라 여기 쓰지 않는다.
               */
              router.push(teamsHref);
            }}
          />
        ) : null}
      </main>
    </TooltipProvider>
  );
}
