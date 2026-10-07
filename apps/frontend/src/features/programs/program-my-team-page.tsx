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
import { getMyTeam, getProgramDetail, type ProgramTeam } from './api';
import type { ProgramApplySessionUser } from './load-program-apply-context';
import { ProgramMyTeamView } from './program-my-team-view';
import {
  getMyApplication,
  type StudentApplication,
} from './student-application-api';
import type { ProgramDetail } from './types';
import { useTeamInvitationManagement } from './use-team-invitation-management';

const LOAD_FAILED_MESSAGE =
  '우리 팀 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';

const APPLICATION_OUT_OF_SYNC_MESSAGE =
  '팀 신청서를 찾지 못했습니다. 방금 상태가 바뀌었을 수 있으니 다시 시도해 주세요.';

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
  const [state, setState] = useState<ProgramMyTeamPageState>({
    kind: 'session-pending',
  });
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const inviteTriggerRef = useRef<HTMLButtonElement | null>(null);

  const sessionNickname = sessionUser?.nickname ?? null;
  const mountedRef = useRef(true);
  const loadSeqRef = useRef(0);
  const identityRef = useRef('');
  const stateRef = useRef(state);
  const programIdRef = useRef(programId);
  const sessionNicknameRef = useRef(sessionNickname);
  stateRef.current = state;
  programIdRef.current = programId;
  sessionNicknameRef.current = sessionNickname;
  const identity = `${programId}\u0000${sessionNickname ?? ''}`;
  identityRef.current = identity;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const invitation = useTeamInvitationManagement({
    programId,
    team: state.kind === 'ready' ? state.team : null,
    sessionKey: sessionNickname,
  });
  const { reloadSent } = invitation;

  const load = useCallback(
    async (options?: { readonly quiet?: boolean }): Promise<void> => {
      const seq = ++loadSeqRef.current;
      const startedIdentity = identityRef.current;
      const currentProgramId = programIdRef.current;
      const quiet = options?.quiet === true;

      function stillCurrent(): boolean {
        return (
          mountedRef.current &&
          seq === loadSeqRef.current &&
          startedIdentity === identityRef.current
        );
      }

      const currentNickname = sessionNicknameRef.current;
      if (currentNickname === null) {
        setState({ kind: 'session-pending' });
        return;
      }
      if (!quiet) {
        setState({ kind: 'loading' });
        setRefreshError(null);
      }

      try {
        const [program, team] = await Promise.all([
          getProgramDetail(currentProgramId),
          getMyTeam(currentProgramId),
        ]);

        let application: StudentApplication | null = null;
        if (team !== null && team.hasApplication) {
          const failWith = (message: string): void => {
            if (quiet && stateRef.current.kind === 'ready') {
              setRefreshError(message);
              return;
            }
            setState({ kind: 'failed', message });
          };
          try {
            application = await getMyApplication(currentProgramId);
          } catch (error: unknown) {
            if (!stillCurrent()) return;
            failWith(loadFailureMessage(error));
            return;
          }

          if (application === null) {
            if (!stillCurrent()) return;
            failWith(APPLICATION_OUT_OF_SYNC_MESSAGE);
            return;
          }
        }

        if (!stillCurrent()) return;
        setRefreshError(null);
        setState(
          team === null
            ? { kind: 'no-team', program }
            : {
                kind: 'ready',
                program,
                team,
                application,
                sessionNickname: currentNickname,
              },
        );
      } catch (error: unknown) {
        if (!stillCurrent()) return;
        if (quiet && stateRef.current.kind === 'ready') {
          setRefreshError(REFRESH_FAILED_MESSAGE);
          return;
        }
        if (error instanceof ApiError && error.problem.status === 404) {
          setState({ kind: 'not-found' });
          return;
        }
        setState({ kind: 'failed', message: loadFailureMessage(error) });
      }
    },
    [],
  );

  useEffect(() => {
    loadSeqRef.current += 1;
    setRefreshError(null);
    setInviteOpen(false);
    void load();
    return () => {
      loadSeqRef.current += 1;
    };
  }, [load, identity]);

  useEffect(() => {
    if (state.kind !== 'ready') return;
    function refresh() {
      if (document.visibilityState !== 'visible') return;
      void load({ quiet: true });
    }
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load, state.kind]);

  const handleMembersChanged = useCallback(() => {
    void load({ quiet: true });

    void reloadSent();
  }, [load, reloadSent]);

  const handleDeparted = useCallback(() => {
    if (!mountedRef.current) return;

    if (
      sessionNicknameRef.current === null ||
      sessionNicknameRef.current !== sessionNickname
    ) {
      return;
    }
    loadSeqRef.current += 1;
    router.push('/dashboard');
    router.refresh();
  }, [router, sessionNickname]);

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
