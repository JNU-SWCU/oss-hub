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
import { getApplicationDetailWithHistory } from '../applications/api';
import { useApplicationDecisionMutation } from '../applications/queries';
import { useQueryClient } from '@tanstack/react-query';
import { programFeatureKey } from '@/lib/query-keys';
import { invalidateProgram } from '../catalog/queries';
import { useStaffTeamDetailQuery, useTeamApplicationQuery } from './queries';
import {
  blocksFurtherDecisions,
  decisionInputFor,
  decisionNoticeFor,
  runDecisionWithRefetch,
} from '../applications/application-decision-refetch';
import { ApplicationDecisionDialog } from '../applications/application-decision-dialog';
import { StaffTeamMembersPanel } from './staff-team-members-panel';
import { ApplicationStatusControl } from '../applications/application-status-control';
import { ReviewHistoryTimeline } from '../applications/review-history-timeline';
import { programHref } from '../program-paths';
import { ProgramStaffRepositorySection } from './program-staff-repository-section';
import { updateTeamRepositoryUrl } from './repository-url-api';
import { TeamRepositoryPanel } from './team-repository-panel';
import { OutsiderContributions } from './outsider-contributions';
import { TeamDeleteDialog } from './team-delete-dialog';
import { TeamNameDialog } from './team-name-dialog';
import type { ApplicationStatus } from '../program-contract';
import type { StaffTeamDetail } from './dto';

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

export function ProgramStaffTeamDetailPage({
  programId,
  teamId,
  sessionKey,
}: {
  readonly programId: string;
  readonly teamId: string;

  readonly sessionKey: string | null;
}): ReactElement {
  const queryClient = useQueryClient();
  const { mutateAsync: decide } = useApplicationDecisionMutation(programId);
  const query = useStaffTeamDetailQuery(programId, teamId, sessionKey);
  const loadState: LoadState =
    query.data !== undefined
      ? { kind: 'ready', detail: query.data }
      : query.isError
        ? query.error instanceof ApiError && query.error.problem.status === 404
          ? { kind: 'not-found' }
          : {
              kind: 'error',
              message:
                query.error instanceof ApiError
                  ? query.error.problem.detail
                  : '팀 상세를 불러오지 못했습니다.',
            }
        : { kind: 'loading' };
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [justRenamed, setJustRenamed] = useState(false);

  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decisionBlocked, setDecisionBlocked] = useState(false);
  const [decisionNotice, setDecisionNotice] = useState<string | null>(null);
  const [pendingReject, setPendingReject] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const cancelled = useRef(false);

  const renameTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const router = useRouter();

  const load = useCallback(
    () => invalidateProgram(queryClient, programId),
    [queryClient, programId],
  );
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, [programId, teamId, sessionKey]);
  const applicationId = query.data?.application?.id ?? null;
  const applicationQuery = useTeamApplicationQuery(
    programId,
    applicationId,
    sessionKey,
  );
  const applicationDetail = applicationQuery.data ?? null;

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
        decide: () => decide({ applicationId, input }),
        refetch: () =>
          queryClient.fetchQuery({
            queryKey: programFeatureKey(
              programId,
              'teams',
              'application',
              applicationId,
              sessionKey,
            ),
            queryFn: () => getApplicationDetailWithHistory(applicationId),
            staleTime: 0,
          }),
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
        queryClient.setQueryData(
          programFeatureKey(
            programId,
            'teams',
            'application',
            applicationId,
            sessionKey,
          ),
          null,
        );
        return;
      }
      if (blocksFurtherDecisions(result)) return;

      await load();
    },
    [applicationId, load, queryClient, programId, sessionKey, decide],
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
    <TooltipProvider delayDuration={200}>
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
        <Button asChild variant="ghost" size="sm">
          <Link href={teamsHref}>← 참여 팀으로</Link>
        </Button>
        <PageHeader
          title={detail.name}

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

        <TeamRepositoryPanel
          programId={programId}
          teamId={teamId}
          activityTitle="팀 활동"
          lockedHint="승인된 팀만 프로그램 종료 전까지 변경할 수 있습니다."
          saveRepositoryUrl={(repositoryUrl) =>
            updateTeamRepositoryUrl(programId, teamId, { repositoryUrl })
          }
          activityExtra={
            detail.repositoryContributions?.outsiderContributions ? (
              <OutsiderContributions
                counts={detail.repositoryContributions.outsiderContributions}
              />
            ) : null
          }
        >
          <ProgramStaffRepositorySection
            key={application?.repository?.id ?? ''}
            application={application}
          />
        </TeamRepositoryPanel>

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

              queryClient.setQueryData<StaffTeamDetail>(
                programFeatureKey(
                  programId,
                  'teams',
                  'staff-detail',
                  teamId,
                  sessionKey,
                ),
                (current) => (current ? { ...current, name } : current),
              );
              void load();
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
              void load();
              router.push(teamsHref);
            }}
          />
        ) : null}
      </main>
    </TooltipProvider>
  );
}
