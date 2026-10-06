'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState, FailureState, PageBody } from '@/components';
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

  function invalidateBackgroundReads(): void {
    loadSeqRef.current += 1;
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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

    setInviteOpen(false);
    void load();
    return () => {
      identityEpochRef.current += 1;
      loadSeqRef.current += 1;
    };
  }, [load, programId, sessionUser]);

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

      teamCreatedRef.current = true;
    }

    invalidateBackgroundReads();
    const reloaded = await load({ quiet: true });
    if (!mutationStillCurrent(started)) return null;
    if (reloaded === null) return null;
    return reloaded.kind === 'ready' ? reloaded.team : null;
  }

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
    const nextErrors = validateApplyForm(values, state.mode);
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

    sessionNickname: sessionUser.nickname,

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
          <FailureState
            title="신청 양식을 불러오지 못했습니다"
            description={state.message}
            onRetry={() => void load()}
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
          values={values}
          errors={errors}
          serverError={serverError}
          mode={state.mode}
          rejectionReason={state.rejectionReason}
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
