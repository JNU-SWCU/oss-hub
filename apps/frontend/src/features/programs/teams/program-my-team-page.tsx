'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { EmptyState, FailureState, PageBody, PageHeader } from '@/components';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { programApplyHref, programOverviewHref } from '@/lib/program-route';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateProgram } from '../catalog/queries';
import { TeamApplicationOutOfSyncError, useMyTeamQuery } from './queries';
import type { ProgramTeam } from './dto';
import type { ProgramApplySessionUser } from '../applications/load-program-apply-context';
import { ProgramMyTeamView } from './program-my-team-view';
import type { StudentApplication } from '../applications/student-application-dto';
import type { ProgramDetail } from '../catalog/dto';
import { useTeamInvitationManagement } from './use-team-invitation-management';

const LOAD_FAILED_MESSAGE =
  '우리 팀 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';

const REFRESH_FAILED_MESSAGE =
  '최신 팀 상태를 불러오지 못했습니다. 화면에는 마지막으로 확인한 상태가 남아 있습니다.';

type ProgramMyTeamPageState =
  | { readonly kind: 'session-pending' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'no-team'; readonly program: ProgramDetail }
  | {
      readonly kind: 'ready';
      readonly program: ProgramDetail;
      readonly team: ProgramTeam;

      readonly application: StudentApplication | null;

      readonly sessionNickname: string;
    };

function loadFailureMessage(error: unknown): string {
  if (error instanceof ApiError) return error.problem.detail;

  if (error instanceof Error && error.message.length > 0) return error.message;
  return LOAD_FAILED_MESSAGE;
}

export function ProgramMyTeamPage({
  programId,
  sessionUser,
  submissionContent,
}: {
  readonly programId: string;
  readonly sessionUser: ProgramApplySessionUser | null;

  readonly submissionContent: ReactNode;
}) {
  const router = useRouter();
  const sessionNickname = sessionUser?.nickname ?? null;
  const queryClient = useQueryClient();
  const query = useMyTeamQuery(programId, sessionNickname);
  const data = query.data;
  const state: ProgramMyTeamPageState =
    sessionNickname === null
      ? { kind: 'session-pending' }
      : data !== undefined
        ? data.team === null
          ? { kind: 'no-team', program: data.program }
          : { kind: 'ready', ...data, team: data.team, sessionNickname }
        : query.isError
          ? query.error instanceof ApiError &&
            query.error.problem.status === 404
            ? { kind: 'not-found' }
            : { kind: 'failed', message: loadFailureMessage(query.error) }
          : { kind: 'loading' };
  const refreshError =
    data !== undefined && query.isError
      ? query.error instanceof TeamApplicationOutOfSyncError ||
        query.error instanceof ApiError
        ? loadFailureMessage(query.error)
        : REFRESH_FAILED_MESSAGE
      : null;
  const [inviteOpen, setInviteOpen] = useState(false);
  const inviteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mountedRef = useRef(true);
  const identityRef = useRef(sessionNickname);
  identityRef.current = sessionNickname;
  useEffect(() => {
    mountedRef.current = true;
    setInviteOpen(false);
    return () => {
      mountedRef.current = false;
    };
  }, [programId, sessionNickname]);
  const invitation = useTeamInvitationManagement({
    programId,
    team: state.kind === 'ready' ? state.team : null,
    sessionKey: sessionNickname,
  });
  const load = useCallback(
    () => invalidateProgram(queryClient, programId),
    [queryClient, programId],
  );
  const handleMembersChanged = useCallback(() => {
    void load();
  }, [load]);
  const handleDeparted = useCallback(() => {
    if (
      !mountedRef.current ||
      identityRef.current !== sessionNickname ||
      sessionNickname === null
    )
      return;
    void invalidateProgram(queryClient, programId);
    router.push('/dashboard');
    router.refresh();
  }, [programId, queryClient, router, sessionNickname]);

  if (state.kind === 'session-pending' || state.kind === 'loading') {
    return (
      <PageBody
        className="max-w-4xl"
        aria-busy="true"
        aria-label="우리 팀 불러오는 중"
      >
        <p role="status">우리 팀 정보를 불러오는 중입니다.</p>
      </PageBody>
    );
  }

  if (state.kind === 'not-found') {
    return (
      <PageBody className="max-w-4xl">
        <EmptyState
          title="프로그램을 찾을 수 없습니다"
          description="삭제되었거나 공개되지 않은 프로그램입니다."
          action={
            <Button asChild variant="outline">
              <Link href="/programs">프로그램 목록으로</Link>
            </Button>
          }
        />
      </PageBody>
    );
  }

  if (state.kind === 'failed') {
    return (
      <PageBody className="max-w-4xl">
        <FailureState
          title="우리 팀을 불러오지 못했습니다"
          description={state.message}
          onRetry={() => void load()}
        />
      </PageBody>
    );
  }

  if (state.kind === 'no-team') {
    return (
      <PageBody className="max-w-4xl">
        <PageHeader title="우리 팀" description={state.program.name} />
        {refreshError ? (
          <FailureState
            title="팀 상태 갱신 실패"
            description={refreshError}
            onRetry={() => void load()}
          />
        ) : null}
        <EmptyState
          title="아직 이 프로그램에서 속한 팀이 없습니다"
          description={`${state.program.name}에는 팀으로 참여합니다. 신청 화면에서 팀을 만들어 신청하거나, 팀장이 보낸 초대를 헤더의 알림에서 수락하면 이 화면에 팀이 나타납니다.`}
          action={
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild>
                <Link href={programApplyHref(programId)}>신청 화면으로</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={programOverviewHref(programId)}>프로그램 개요</Link>
              </Button>
            </div>
          }
        />
      </PageBody>
    );
  }

  return (
    <ProgramMyTeamView
      programId={programId}
      program={state.program}
      team={state.team}
      application={state.application}
      sessionNickname={state.sessionNickname}
      invitation={invitation}
      inviteOpen={inviteOpen}
      onOpenInvite={() => setInviteOpen(true)}
      onCloseInvite={() => setInviteOpen(false)}
      inviteTriggerRef={inviteTriggerRef}
      refreshError={refreshError}
      onRefresh={() => void load()}
      submissionContent={submissionContent}
      onMembersChanged={handleMembersChanged}
      onDeparted={handleDeparted}
    />
  );
}
