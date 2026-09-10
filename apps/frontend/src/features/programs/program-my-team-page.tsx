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
import { EmptyState, PageBody, PageHeader } from '@/components';
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

/** 백엔드가 「소속된 팀이 없습니다」로 응답하는 단 하나의 코드(`TeamsErrorCode.TEAM_NOT_FOUND`). */
const NO_TEAM_ERROR_CODE = 'TEAM_010';

const LOAD_FAILED_MESSAGE =
  '우리 팀 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';

/**
 * 팀이 「신청서가 있다」고 말했는데 신청 조회가 404로 돌아온 경우.
 *
 * 이 응답을 「신청 없음」으로 접으면 이미 제출한 팀에게 「신청 작성 중」과
 * 신청서 작성 링크를 다시 내밀게 되고, 팀장은 낸 적 있는 신청서를 또 쓰게 된다.
 * 모르면 모른다고 말하고 다시 읽는다.
 */
const APPLICATION_OUT_OF_SYNC_MESSAGE =
  '팀 신청서를 찾지 못했습니다. 방금 상태가 바뀌었을 수 있으니 다시 시도해 주세요.';

const REFRESH_FAILED_MESSAGE =
  '최신 팀 상태를 불러오지 못했습니다. 화면에는 마지막으로 확인한 상태가 남아 있습니다.';

type ProgramMyTeamPageState =
  /** 세션 사용자가 아직 손에 없다 — 어떤 비공개 조회도 시작하지 않는다. */
  | { readonly kind: 'session-pending' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'no-team'; readonly program: ProgramDetail }
  | {
      readonly kind: 'ready';
      readonly program: ProgramDetail;
      readonly team: ProgramTeam;
      /** 팀에 제출된 신청서. 팀원 전원이 읽는다(#18) — 신청자 본인만이 아니다. */
      readonly application: StudentApplication | null;
      /** 이 응답을 받은 순간의 로그인 신원. 자기 행·자기 탈퇴 판정의 기준이다. */
      readonly sessionNickname: string;
    };

function isNoTeamError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.problem.status === 404 &&
    error.problem.code === NO_TEAM_ERROR_CODE
  );
}

function loadFailureMessage(error: unknown): string {
  if (error instanceof ApiError) return error.problem.detail;
  // 응답 계약 위반(`ProgramTeamResponseError`)은 그 문장이 이미 사실을 말한다.
  if (error instanceof Error && error.message.length > 0) return error.message;
  return LOAD_FAILED_MESSAGE;
}

/**
 * 학생의 「우리 팀」 작업 공간(#1269).
 *
 * 팀은 **인증된 세션의 팀 조회**(`GET /programs/:id/teams/me`)로만 정한다 —
 * 화면이 실어 온 팀 id나 교직원용 팀 상세는 쓰지 않는다. 할 수 있는 일
 * (초대·제외·나가기)은 서버가 계산한 능력 플래그만 따르고, 화면이 팀장 여부나
 * 신청 이력으로 같은 규칙을 다시 유추하지 않는다(ADR-007).
 */
export function ProgramMyTeamPage({
  programId,
  sessionUser,
  submissionContent,
}: {
  readonly programId: string;
  readonly sessionUser: ProgramApplySessionUser | null;
  /**
   * 승인된 참여자의 제출 현황. `features/programs`는 `features/submissions`를
   * 직접 import하지 않으므로 조합 계층(라우트)이 만들어 내려 준다.
   */
  readonly submissionContent: ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<ProgramMyTeamPageState>({
    kind: 'session-pending',
  });
  const [refreshError, setRefreshError] = useState<string | null>(null);
  /** 초대 다이얼로그는 명단의 버튼이 열고, 그 버튼으로 초점이 돌아간다. */
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
          getMyTeam(currentProgramId).then(
            (value): ProgramTeam | null => value,
            (error: unknown): ProgramTeam | null => {
              if (isNoTeamError(error)) return null;
              throw error;
            },
          ),
        ]);

        let application: StudentApplication | null = null;
        if (team !== null && team.hasApplication) {
          try {
            application = await getMyApplication(currentProgramId);
          } catch (error: unknown) {
            if (!stillCurrent()) return;
            const message =
              error instanceof ApiError && error.problem.status === 404
                ? APPLICATION_OUT_OF_SYNC_MESSAGE
                : loadFailureMessage(error);
            if (quiet && stateRef.current.kind === 'ready') {
              setRefreshError(message);
              return;
            }
            setState({ kind: 'failed', message });
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

  // 프로그램이나 로그인 계정이 바뀌면 이전 화면의 상태와 진행 중인 조회는 모두 버린다.
  useEffect(() => {
    loadSeqRef.current += 1;
    setRefreshError(null);
    setInviteOpen(false);
    void load();
    return () => {
      loadSeqRef.current += 1;
    };
  }, [load, identity]);

  // 초대를 수락한 팀원이나 다른 탭의 변경은 알림 없이 일어난다. 돌아왔을 때
  // 낡은 명단으로 「제외」를 누르지 않도록 조용히 다시 읽는다.
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
    // 팀원 구성이 바뀌면 보낸 초대의 유효성도 함께 바뀐다(정원·중복).
    void reloadSent();
  }, [load, reloadSent]);

  const handleDeparted = useCallback(() => {
    if (!mountedRef.current) return;
    // 나간 사람은 방금 이 화면을 보고 있던 계정이다. 그 사이 계정이 바뀌었으면
    // 다른 사람의 세션을 대시보드로 밀어내지 않는다.
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
        <EmptyState
          title="우리 팀을 불러오지 못했습니다"
          description={state.message}
          action={
            <Button type="button" variant="outline" onClick={() => void load()}>
              다시 시도
            </Button>
          }
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
