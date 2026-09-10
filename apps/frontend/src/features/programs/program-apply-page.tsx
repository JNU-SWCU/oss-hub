'use client';

// allow: SIZE_OK — route-level async state orchestration is already split from form views.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState, PageBody } from '@/components';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { createApplication, createTeam, type ProgramTeam } from './api';
import {
  loadProgramApplyContext,
  type ProgramApplyContext,
  type ProgramApplySessionUser,
} from './load-program-apply-context';
import {
  applyActionFailureMessage,
  EMPTY_APPLY_FORM,
  mapCreateApplicationError,
  remainingTeamMembers,
  validateApplyForm,
  type ProgramApplyAction,
  type ProgramApplyFormErrors,
  type ProgramApplyFormValues,
} from './program-apply-flow';
import {
  ApplySkeleton,
  BlockedView,
  ProgramApplyFormView,
  ProgramApplySuccessView,
  type ApplicationConfirmation,
  type ApplicationFormMode,
} from './program-apply-views';
import { mapTeamActionError } from './program-teams-flow';
import {
  cancelMyApplication,
  updateMyApplication,
} from './student-application-api';
import { useTeamInvitationManagement } from './use-team-invitation-management';

type ReadyContext = Extract<ProgramApplyContext, { kind: 'ready' }>;
type ProgramApplyPageState =
  | { readonly kind: 'loading' }
  | ProgramApplyContext
  | {
      readonly kind: 'success';
      readonly program: ReadyContext['program'];
      readonly applicationId: string;
      readonly mode: ApplicationFormMode;
    };

const BACKGROUND_REFRESH_MS = 30_000;

/** 팀 이름 없이는 팀을 만들 수 없다 — 서버에 빈 이름을 보내 보고 알아내지 않는다. */
const TEAM_NAME_REQUIRED_MESSAGE = '팀 이름을 입력해 주세요.';

function applicationAnswers(values: ProgramApplyFormValues) {
  return {
    title: values.title ?? '',
  } as const;
}
type MutationIdentity = {
  readonly epoch: number;
  readonly programId: string;
  readonly sessionNickname: string;
};

function sameMutationIdentity(
  started: MutationIdentity,
  current: MutationIdentity,
): boolean {
  return (
    started.epoch === current.epoch &&
    started.programId === current.programId &&
    started.sessionNickname === current.sessionNickname
  );
}

export function ProgramApplyPage({
  programId,
  sessionUser,
}: {
  readonly programId: string;
  readonly sessionUser: ProgramApplySessionUser;
}) {
  const router = useRouter();
  const [state, setState] = useState<ProgramApplyPageState>({
    kind: 'loading',
  });
  const [values, setValues] =
    useState<ProgramApplyFormValues>(EMPTY_APPLY_FORM);
  const [errors, setErrors] = useState<ProgramApplyFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmation, setConfirmation] =
    useState<ApplicationConfirmation>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createName, setCreateName] = useState('');
  const [teamError, setTeamError] = useState<string | null>(null);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const hasUserInput = useRef(false);
  const identityEpochRef = useRef(0);
  const loadSeqRef = useRef(0);
  const creatingTeamRef = useRef(false);
  const submittingRef = useRef(false);
  /**
   * 이 신원에서 팀을 이미 한 번 만들었는가. 신청 제출이 실패해 다시 시도할 때
   * 같은 팀을 두 번 만들지 않기 위한 표식이다 — 표식이 서 있으면 다시 만들지 않고
   * 서버가 가진 내 팀을 다시 읽어 그대로 쓴다(TEAM_006 되풀이를 만들지 않는다).
   */
  const teamCreatedRef = useRef(false);
  const mountedRef = useRef(true);
  const stateRef = useRef(state);
  const programIdRef = useRef(programId);
  const sessionUserRef = useRef(sessionUser);
  const createNameRef = useRef(createName);
  const inviteTriggerRef = useRef<HTMLButtonElement | null>(null);
  stateRef.current = state;
  programIdRef.current = programId;
  sessionUserRef.current = sessionUser;
  createNameRef.current = createName;

  /**
   * 초대 관리를 실제로 그리는 때만 팀을 넘긴다. 수정 화면은 제출된 신청서를
   * 고치는 자리라 초대 패널을 보이지 않으므로, `null`을 넘겨 보이지도 않는
   * 보낸 초대 조회를 아예 만들지 않는다.
   */
  const invitationTeam =
    state.kind === 'ready' && state.mode === 'create' ? state.team : null;
  const invitation = useTeamInvitationManagement({
    programId,
    team: invitationTeam,
    sessionKey: sessionUser.nickname,
  });
  const { reloadSent } = invitation;

  function currentMutationIdentity(): MutationIdentity {
    return {
      epoch: identityEpochRef.current,
      programId: programIdRef.current,
      sessionNickname: sessionUserRef.current.nickname,
    };
  }

  function mutationStillCurrent(started: MutationIdentity): boolean {
    return (
      mountedRef.current &&
      sameMutationIdentity(started, currentMutationIdentity())
    );
  }

  /** 신청서·팀 상태를 바꿔 놓고 다시 읽기 전까지, 진행 중이던 낡은 조회를 버린다. */
  function invalidateBackgroundReads(): void {
    loadSeqRef.current += 1;
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * 방금 읽은 맥락을 그대로 돌려준다 — 화면에 반영하는 것과 별개로, 부른 쪽이
   * 그 값을 바로 쓸 수 있어야 한다. `setState`는 다음 렌더에서야 `stateRef`에
   * 닿으므로, 읽은 결과를 상태에서 되찾으려 하면 아직 비어 있는 이전 렌더를 본다.
   * 신원이 바뀌었거나 화면이 사라진 경우에만 `null`이다.
   */
  const load = useCallback(
    async (options?: {
      readonly quiet?: boolean;
    }): Promise<ProgramApplyContext | null> => {
      const seq = ++loadSeqRef.current;
      const epoch = identityEpochRef.current;
      if (!options?.quiet) setState({ kind: 'loading' });
      const context = await loadProgramApplyContext(
        programIdRef.current,
        sessionUserRef.current,
      );
      if (!mountedRef.current) return null;
      if (epoch !== identityEpochRef.current) return null;
      // 더 새로운 조회가 이미 시작됐으면 화면은 그쪽에 맡기고 값만 돌려준다.
      if (seq !== loadSeqRef.current) return context;
      const current = stateRef.current;
      if (current.kind === 'success') return context;
      if (context.kind === 'ready') {
        const modeChanged =
          current.kind === 'ready' && current.mode !== context.mode;
        if (!hasUserInput.current || modeChanged) {
          setValues(context.initialValues);
          if (modeChanged) hasUserInput.current = false;
        }
      }
      setState(context);
      return context;
    },
    [],
  );

  // 프로그램·로그인 계정이 바뀌면 이전 화면의 입력·진행 중 표식을 모두 버린다.
  // 초대 상태는 공유 훅이 같은 신원 변화로 스스로 다시 세운다 — 여기서 다시 지우지 않는다.
  useEffect(() => {
    identityEpochRef.current += 1;
    loadSeqRef.current += 1;
    hasUserInput.current = false;
    creatingTeamRef.current = false;
    submittingRef.current = false;
    teamCreatedRef.current = false;
    setCreatingTeam(false);
    setSubmitting(false);
    setConfirmation(null);
    setServerError(null);
    setErrors({});
    setCreateName('');
    setTeamError(null);
    // 다른 프로그램·다른 계정은 다른 화면이다 — 열려 있던 초대 레이어도 함께 닫는다.
    setInviteOpen(false);
    void load();
    return () => {
      identityEpochRef.current += 1;
      loadSeqRef.current += 1;
    };
  }, [load, programId, sessionUser]);

  /**
   * 배경에서만 도는 현황 새로고침 — 현재 팀 맥락(신청 문맥)과 공유 훅이 들고 있는
   * 보낸 초대를 함께 다시 읽는다. 학생이 눌러야 하는 버튼은 만들지 않는다.
   */
  const refreshLiveState = useCallback(async () => {
    const current = stateRef.current;
    if (current.kind !== 'ready') return;
    await Promise.allSettled([load({ quiet: true }), reloadSent()]);
  }, [load, reloadSent]);

  useEffect(() => {
    if (state.kind !== 'ready') return;
    function onFocus() {
      if (document.visibilityState === 'hidden') return;
      void refreshLiveState();
    }
    function onVisibility() {
      if (document.visibilityState !== 'visible') return;
      void refreshLiveState();
    }
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void refreshLiveState();
    }, BACKGROUND_REFRESH_MS);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [refreshLiveState, state.kind]);

  /**
   * 저장된 내 팀을 확보한다. 이미 있으면 그대로 쓰고, 없을 때만 **명시적으로**
   * 한 번 만든다 — 화면을 열었다는 이유로도, 검색·되돌아가기 때문에도 만들지 않는다.
   *
   * 만들기가 `TEAM_006`(이미 소속)으로 거절되면 서버에는 이미 내 팀이 있다는 뜻이라
   * 실패로 보이지 않고 그 팀을 다시 읽어 이어 간다. 실패는 그대로 던져 호출부가
   * 자기 자리(팀 이름 칸 / 제출 오류)에 남긴다.
   */
  async function ensureTeam(
    started: MutationIdentity,
  ): Promise<ProgramTeam | null> {
    const current = stateRef.current;
    if (current.kind !== 'ready') return null;
    if (current.team !== null) return current.team;

    if (!teamCreatedRef.current) {
      const name = createNameRef.current.trim();
      if (name.length === 0) {
        setTeamError(TEAM_NAME_REQUIRED_MESSAGE);
        return null;
      }
      try {
        await createTeam(programIdRef.current, { name });
      } catch (error: unknown) {
        if (!(error instanceof ApiError && error.problem.code === 'TEAM_006')) {
          throw error;
        }
      }
      // 여기까지 왔으면 서버에 내 팀이 있다 — 다시 만들지 않는다.
      teamCreatedRef.current = true;
    }

    invalidateBackgroundReads();
    const reloaded = await load({ quiet: true });
    if (!mutationStillCurrent(started)) return null;
    if (reloaded === null) return null;
    return reloaded.kind === 'ready' ? reloaded.team : null;
  }

  /**
   * 초대(＋)를 눌렀을 때만 도는 준비 단계. 검색 API가 저장된 팀을 요구하므로,
   * 실제 초대를 보내기 전에 학생이 적은 이름으로 팀을 딱 한 번 만들고 레이어를 연다.
   */
  async function openInvite(): Promise<void> {
    const current = stateRef.current;
    if (current.kind !== 'ready' || current.mode !== 'create') return;
    if (current.team !== null) {
      setInviteOpen(true);
      return;
    }
    if (creatingTeamRef.current) return;
    if (createNameRef.current.trim().length === 0) {
      setTeamError(TEAM_NAME_REQUIRED_MESSAGE);
      return;
    }
    const started = currentMutationIdentity();
    creatingTeamRef.current = true;
    setCreatingTeam(true);
    setTeamError(null);
    try {
      const team = await ensureTeam(started);
      if (!mutationStillCurrent(started) || team === null) return;
      setInviteOpen(true);
    } catch (error: unknown) {
      if (!mutationStillCurrent(started)) return;
      setTeamError(mapTeamActionError(error));
    } finally {
      if (mutationStillCurrent(started)) {
        creatingTeamRef.current = false;
        setCreatingTeam(false);
      }
    }
  }

  function requestSubmit(): void {
    if (state.kind !== 'ready') return;
    if (state.mode === 'create' && state.team !== null && !state.team.isLeader)
      return;
    if (state.mode === 'edit' && state.applicationId === null) return;
    if (remainingTeamMembers(state.teamMinimum) > 0) return;
    if (
      state.mode === 'create' &&
      state.team === null &&
      createName.trim().length === 0
    ) {
      setTeamError(TEAM_NAME_REQUIRED_MESSAGE);
      return;
    }
    const nextErrors = validateApplyForm(
      values,
      state.mode,
      state.program.repositoryProvisioningEnabled,
    );
    setErrors(nextErrors);
    setServerError(null);
    if (Object.keys(nextErrors).length > 0) return;
    setTeamError(null);
    setConfirmation(state.mode === 'create' ? 'submit' : 'save');
  }

  async function confirmAction(): Promise<void> {
    if (
      state.kind !== 'ready' ||
      confirmation === null ||
      submittingRef.current
    )
      return;
    const started = currentMutationIdentity();
    const action: ProgramApplyAction = confirmation;
    const currentProgram = state.program;
    const currentTemplateVersion = state.template.version;
    const currentApplicationId = state.applicationId;
    submittingRef.current = true;
    setSubmitting(true);
    setServerError(null);
    try {
      if (confirmation === 'cancel') {
        await cancelMyApplication(programId);
        if (!mutationStillCurrent(started)) return;
        invalidateBackgroundReads();
        router.push('/dashboard');
        router.refresh();
        return;
      }
      if (confirmation === 'save') {
        if (currentApplicationId === null) return;
        const updated = await updateMyApplication(programId, {
          answers: applicationAnswers(values),
          applicationTemplateVersion: currentTemplateVersion,
        });
        if (!mutationStillCurrent(started)) return;
        invalidateBackgroundReads();
        setState({
          kind: 'success',
          program: currentProgram,
          applicationId: updated.id,
          mode: 'edit',
        });
        setConfirmation(null);
        return;
      }
      /*
        마지막 확인 한 번이 팀 확보와 신청 제출을 이어서 끝낸다. 혼자 신청하는
        학생도 여기서 처음으로 팀이 만들어지고, 실패하면 만든 팀과 입력한 내용이
        그대로 남아 다시 시도할 때 같은 팀을 다시 쓴다.
      */
      if (state.team === null) {
        let ensured: ProgramTeam | null;
        try {
          ensured = await ensureTeam(started);
        } catch (error: unknown) {
          if (!mutationStillCurrent(started)) return;
          setConfirmation(null);
          setTeamError(mapTeamActionError(error));
          return;
        }
        if (!mutationStillCurrent(started)) return;
        if (ensured === null) {
          setConfirmation(null);
          return;
        }
      }
      const created = await createApplication(programId, {
        answers: applicationAnswers(values),
        applicationTemplateVersion: currentTemplateVersion,
        isRepositoryPublicationPlanned:
          currentProgram.repositoryProvisioningEnabled &&
          values.isRepositoryPublicationPlanned,
        repositoryConnectionMode: currentProgram.repositoryProvisioningEnabled
          ? values.repositoryConnectionMode
          : null,
        repositoryUrl: currentProgram.repositoryProvisioningEnabled
          ? values.repositoryUrl
          : '',
      });
      if (!mutationStillCurrent(started)) return;
      invalidateBackgroundReads();
      setState({
        kind: 'success',
        program: currentProgram,
        applicationId: created.id,
        mode: 'create',
      });
      setConfirmation(null);
    } catch (error: unknown) {
      if (!mutationStillCurrent(started)) return;
      setConfirmation(null);
      setServerError(
        error instanceof ApiError
          ? mapCreateApplicationError(error.problem, action)
          : applyActionFailureMessage(action),
      );
    } finally {
      if (!mutationStillCurrent(started)) return;
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const readyTeam = state.kind === 'ready' ? state.team : null;
  const teamProps = {
    programId,
    team: readyTeam,
    // 공유 팀 컴포넌트가 「내 행」을 알아보는 기준. 라우트가 준 세션을 그대로 넘긴다.
    sessionNickname: sessionUser.nickname,
    // 저장된 팀이 있을 때만 초대 컨트롤러를 넘긴다 — 아직 없는 팀에는 보낸 초대도,
    // 검색도 존재하지 않는다(가짜 대기 행을 지어내지 않는다).
    invitation:
      state.kind === 'ready' && state.mode === 'create' && readyTeam !== null
        ? invitation
        : null,
    inviteOpen,
    inviteTriggerRef,
    createName,
    teamError,
    creating: creatingTeam,
    onOpenInvite: () => {
      void openInvite();
    },
    onCloseInvite: () => setInviteOpen(false),
    onCreateNameChange: (value: string) => {
      setTeamError(null);
      setCreateName(value);
    },
    onTeamChanged: () => {
      void refreshLiveState();
    },
  } as const;

  switch (state.kind) {
    case 'loading':
      return <ApplySkeleton />;
    case 'not-found':
      return (
        <PageBody className="max-w-3xl">
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
    case 'failed':
      return (
        <PageBody className="max-w-3xl">
          <EmptyState
            title="신청 양식을 불러오지 못했습니다"
            description={state.message}
            action={
              <Button
                type="button"
                variant="outline"
                onClick={() => void load()}
              >
                다시 시도
              </Button>
            }
          />
        </PageBody>
      );
    case 'blocked':
      return (
        <BlockedView
          reason={state.reason}
          application={state.application}
          programId={programId}
        />
      );
    case 'success':
      return (
        <ProgramApplySuccessView
          applicationId={state.applicationId}
          programId={programId}
          mode={state.mode}
        />
      );
    case 'ready':
      return (
        <ProgramApplyFormView
          program={state.program}
          template={state.template}
          applicantName={state.applicantName}
          githubHandle={state.githubHandle}
          values={values}
          errors={errors}
          serverError={serverError}
          mode={state.mode}
          canManage={state.canManage}
          confirmation={confirmation}
          teamMinimum={state.teamMinimum}
          submitting={submitting}
          onChange={(key, value) => {
            hasUserInput.current = true;
            setValues((previous) => ({ ...previous, [key]: value }));
          }}
          onTogglePublicationPlanned={(checked) => {
            hasUserInput.current = true;
            setValues((previous) => ({
              ...previous,
              isRepositoryPublicationPlanned: checked,
            }));
          }}
          onRepositoryModeChange={(mode) => {
            hasUserInput.current = true;
            setValues((previous) => ({
              ...previous,
              repositoryConnectionMode: mode,
            }));
          }}
          onToggleConsent={(checked) => {
            hasUserInput.current = true;
            setValues((previous) => ({
              ...previous,
              personalDataConsent: checked,
            }));
          }}
          onRequestSubmit={requestSubmit}
          onRequestCancel={() => setConfirmation('cancel')}
          onCloseConfirmation={() => setConfirmation(null)}
          onConfirm={() => void confirmAction()}
          {...teamProps}
        />
      );
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}
