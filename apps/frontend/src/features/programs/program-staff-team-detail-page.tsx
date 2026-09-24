'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, Pencil } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  EmptyState,
  FailureState,
  PageHeader,
  StatusBadge,
} from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ApiError } from '@/lib/api-client';
import {
  decideApplication,
  getApplicationDetailWithHistory,
  getStaffProgramTeamDetail,
} from './api';
import {
  blocksFurtherDecisions,
  decisionInputFor,
  decisionNoticeFor,
  runDecisionWithRefetch,
} from './application-decision-refetch';
import { ApplicationDecisionDialog } from './application-decision-dialog';
import { StaffTeamMembersPanel } from './staff-team-members-panel';
import { ApplicationStatusControl } from './application-status-control';
import { ReviewHistoryTimeline } from './review-history-timeline';
import { programHref } from './program-paths';
import { ProgramStaffRepositorySection } from './program-staff-repository-section';
import { updateTeamRepositoryUrl } from './repository-url-api';
import { TeamRepositoryPanel } from './team-repository-panel';
import { TeamDeleteDialog } from './team-delete-dialog';
import { TeamNameDialog } from './team-name-dialog';
import type {
  ApplicationDetail,
  ApplicationStatus,
  StaffTeamDetail,
} from './types';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly detail: StaffTeamDetail }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'error'; readonly message: string };

function Section({
  title,
  meta,
  children,
}: {
  readonly title: string;
  /**
   * 머리말 오른쪽에 붙는 수·단위. 공용 `SectionHeading`의 `meta`와 같은 역할이고
   * 같은 키울을 쓴다 — 이 페이지는 카드 안 머리말이라 제목 크기만 다르다.
   */
  readonly meta?: string;
  readonly children: React.ReactNode;
}): ReactElement {
  return (
    <section className="grid gap-4 rounded-card border border-border p-card">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{title}</h2>
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
  sessionKey,
}: {
  readonly programId: string;
  readonly teamId: string;
  /**
   * 로그인 신원(닉네임). 구성 변경 요청이 도는 동안 사람이 바뀜면 그 결과를
   * 새 사용자 화면에 흘리지 않기 위한 식별자다 — 조합 계층인 route가 내려 준다.
   */
  readonly sessionKey: string | null;
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

  /**
   * `quiet`는 보이는 화면을 스켈레톤으로 갈아 끼우지 않고 값만 새로 받는다 — 저장소를
   * 바꾼 직후 발급·공개 카드가 옛 저장소를 가리키지 않게 할 때 쓴다. 실패하면 보이던
   * 화면을 그대로 둔다.
   */
  const load = useCallback(
    async (options?: { readonly quiet?: boolean }): Promise<void> => {
      const quiet = options?.quiet === true;
      if (!quiet) setLoadState({ kind: 'loading' });
      try {
        const detail = await getStaffProgramTeamDetail(programId, teamId);
        if (cancelled.current) return;
        setLoadState({ kind: 'ready', detail });
      } catch (error: unknown) {
        if (cancelled.current || quiet) return;
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
    },
    [programId, teamId],
  );

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

      setDecisionNotice(decisionNoticeFor(result));
      if (result.kind === 'refetch-failed') {
        setDecisionBlocked(true);
        return;
      }
      if (result.kind === 'removed') {
        setApplicationDetail(null);
        return;
      }
      if (blocksFurtherDecisions(result)) return;
      // 판정은 팀 상세의 요약 배지도 바꾼다 — 둘을 같이 다시 읽어야 한 화면이 두
      // 이야기를 하지 않는다.
      await Promise.all([loadApplication(), load()]);
    },
    [applicationId, loadApplication, load],
  );

  const teamsHref = programHref(programId, '/teams');

  if (loadState.kind === 'loading') {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <Skeleton label="팀 상세 불러오는 중" className="grid gap-6">
          <SkeletonBlock className="h-20 rounded-xl" />
          <SkeletonBlock className="h-40 rounded-xl" />
          <SkeletonBlock className="h-40 rounded-xl" />
        </Skeleton>
      </main>
    );
  }

  if (loadState.kind === 'not-found') {
    return (
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
        <PageHeader title="팀 상세" />
        <EmptyState
          title="팀을 찾을 수 없습니다"
          description="이 프로그램의 팀이 아니거나 주소가 잘못되었습니다."
          action={
            <Button asChild variant="outline">
              <Link href={teamsHref}>참여 팀으로</Link>
            </Button>
          }
        />
      </main>
    );
  }

  if (loadState.kind === 'error') {
    return (
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
        <PageHeader title="팀 상세" />
        <FailureState
          title="팀 상세를 열 수 없습니다"
          description={loadState.message}
          onRetry={() => void load()}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href={teamsHref}>참여 팀으로</Link>
            </Button>
          }
        />
      </main>
    );
  }

  const { detail } = loadState;
  const { application } = detail;
  const currentStatus =
    applicationDetail?.status ?? application?.status ?? null;
  const onSelectStatus = (next: ApplicationStatus): void => {
    if (
      applicationDetail === null ||
      currentStatus === null ||
      next === currentStatus
    ) {
      return;
    }
    if (next === 'REJECTED') {
      setReason('');
      setReasonError(false);
      setPendingReject(true);
      return;
    }
    void applyDecision(next, '');
  };

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
           * 신청 상태를 바꾸는 자리라 둘을 한 덩어리로 묶으면 연필이 상태를
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
           * 신청이 없으면 상태 조작 자체를 그리지 않는다(#1272). 없는 신청에
           * 상태를 달면 대기 중인 신청처럼 읽혀 교직원이 처리할 것이 있다고
           * 오해한다 — 상태가 아니라 상태가 없는 것이므로 헤더는 조용히 비운다.
           */
          actions={
            currentStatus === null ? undefined : (
              <div className="grid justify-items-end gap-1">
                <ApplicationStatusControl
                  id="team-detail-application-status"
                  aria-label="신청 상태"
                  value={currentStatus}
                  disabled={
                    applicationDetail === null ||
                    decisionBusy ||
                    decisionBlocked
                  }
                  onChange={onSelectStatus}
                />
                {decisionNotice !== null ? (
                  <p role="status" className="text-small text-muted-foreground">
                    {decisionNotice}
                  </p>
                ) : null}
              </div>
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

        {/*
         * 명단 바로 아래에 둔다 — 누가 있는지 보고 바로 고치는 자리다.
         * 팀원 추가는 여전히 초대·수락이다 — 교직원이라고 남의 계정을 팀에
         * 집어넣지 않는다.
         */}
        <StaffTeamMembersPanel
          programId={programId}
          teamId={teamId}
          teamName={detail.name}
          memberCount={detail.memberCount}
          members={detail.members}
          sessionKey={sessionKey}
          onChanged={() => {
            void load();
          }}
        />

        {/*
         * 학생 「우리 팀」과 같은 조회·같은 그래프다(#1133). 역할이 가르는 것은 저장 경로와
         * 서버가 준 편집 권한뿐이다. 발급·공개 상태는 교직원에게만 있는 줄이라 URL 줄 아래에 붙인다.
         */}
        <TeamRepositoryPanel
          programId={programId}
          teamId={teamId}
          activityTitle="팀 활동"
          lockedHint="승인된 팀만 프로그램 종료 전까지 변경할 수 있습니다."
          saveRepositoryUrl={(repositoryUrl) =>
            updateTeamRepositoryUrl(programId, teamId, { repositoryUrl })
          }
          onSaved={() => void load({ quiet: true })}
        >
          <ProgramStaffRepositorySection
            key={application?.repository?.id ?? ''}
            application={application}
          />
        </TeamRepositoryPanel>

        {/*
         * 신청서 본문·지원 동기는 이 화면에 두지 않는다. 상태는 제목 옆에서
         * 바꾸고, 검토 이력만 접어 둔다. 이력은 신청 상세 조회가 준 값이다 —
         * 그 조회를 빼면 이력이 비고 판정 재조회도 끊긴다.
         */}
        {applicationDetail !== null ? (
          <Collapsible defaultOpen={false}>
            <section className="grid gap-0 rounded-card border border-border">
              <CollapsibleTrigger
                className={[
                  'group flex h-control w-full items-center justify-between gap-3 px-card text-left',
                  'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                ].join(' ')}
              >
                <h2 className="font-semibold">검토 이력</h2>
                <ChevronDown
                  aria-hidden="true"
                  className={[
                    'size-4 shrink-0 transition-transform',
                    'group-data-[state=open]:rotate-180 motion-reduce:transition-none',
                  ].join(' ')}
                />
              </CollapsibleTrigger>
              <CollapsibleContent
                className="data-[state=closed]:hidden"
                forceMount
              >
                <div className="grid gap-4 px-card pb-card">
                  {applicationDetail.rejectionReason !== null ? (
                    <Alert variant="destructive">
                      <AlertTitle>반려 사유</AlertTitle>
                      <AlertDescription className="break-keep">
                        {applicationDetail.rejectionReason}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  <ReviewHistoryTimeline
                    entries={applicationDetail.reviewHistory}
                  />
                </div>
              </CollapsibleContent>
            </section>
          </Collapsible>
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
