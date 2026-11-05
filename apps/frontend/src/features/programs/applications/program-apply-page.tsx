'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { featureKey, programFeatureKey } from '@/lib/query-keys';
import { useWindowFocusRefetch } from '@/lib/use-window-focus-refetch';
import { invalidateProgram } from '../catalog/queries';
import { EmptyState, FailureState, PageBody } from '@/components';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { createApplication } from './api';
import {
  loadProgramApplyContext,
  type ProgramApplyContext,
  type ProgramApplySessionUser,
} from './load-program-apply-context';
import {
  applyActionFailureMessage,
  EMPTY_APPLY_FORM,
  mapCreateApplicationError,
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
import {
  cancelMyApplication,
  updateMyApplication,
} from './student-application-api';
import { useTeamInvitationManagement } from '../teams/use-team-invitation-management';
import { ApplicationInvitees } from './application-invitees';
import type { InvitationCandidate } from '../teams/dto';

type ReadyContext = Extract<ProgramApplyContext, { kind: 'ready' }>;
type ProgramApplyPageState =
  | { readonly kind: 'loading' }
  | ProgramApplyContext
  | {
      readonly kind: 'success';
      readonly program: ReadyContext['program'];
      readonly teamId: string;
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
  const queryClient = useQueryClient();
  const [state, setState] = useState<ProgramApplyPageState>({
    kind: 'loading',
  });
  const [values, setValues] =
    useState<ProgramApplyFormValues>(EMPTY_APPLY_FORM);
  const [errors, setErrors] = useState<ProgramApplyFormErrors>({});
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmation, setConfirmation] =
    useState<ApplicationConfirmation>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createName, setCreateName] = useState('');
  const [selectedInvitees, setSelectedInvitees] = useState<
    readonly InvitationCandidate[]
  >([]);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const hasUserInput = useRef(false);
  const identityEpochRef = useRef(0);
  const loadSeqRef = useRef(0);
  const submittingRef = useRef(false);

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
    refetchInterval: BACKGROUND_REFRESH_MS,
  });
  const contextQuery = useQuery({
    queryKey: programFeatureKey(
      programId,
      'apply-context',
      sessionUser.nickname,
      sessionUser.name,
    ),
    queryFn: () => loadProgramApplyContext(programId, sessionUser, queryClient),
    enabled: state.kind !== 'success',
    refetchOnWindowFocus: state.kind === 'ready' && !submitting,
    refetchInterval:
      state.kind === 'ready' && !submitting ? BACKGROUND_REFRESH_MS : false,
  });
  useWindowFocusRefetch(
    contextQuery.refetch,
    state.kind === 'ready' && !submitting,
  );

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

  const applyContext = useCallback((context: ProgramApplyContext) => {
    const current = stateRef.current;
    if (current.kind === 'success' || submittingRef.current) return;
    if (context.kind === 'ready') {
      if (context.team !== null) {
        setSelectedInvitees((current) => (current.length === 0 ? current : []));
      }
      const modeChanged =
        current.kind === 'ready' && current.mode !== context.mode;
      if (!hasUserInput.current || modeChanged) {
        setValues(context.initialValues);
        if (modeChanged) hasUserInput.current = false;
      }
    }
    setState(context);
  }, []);

  const load = useCallback(
    async (options?: {
      readonly quiet?: boolean;
    }): Promise<ProgramApplyContext | null> => {
      const seq = ++loadSeqRef.current;
      const epoch = identityEpochRef.current;
      if (!options?.quiet) setState({ kind: 'loading' });
      const context = await queryClient.fetchQuery({
        queryKey: programFeatureKey(
          programId,
          'apply-context',
          sessionUser.nickname,
          sessionUser.name,
        ),
        queryFn: () =>
          loadProgramApplyContext(programId, sessionUser, queryClient),
        staleTime: 0,
      });
      if (!mountedRef.current) return null;
      if (epoch !== identityEpochRef.current) return null;

      if (seq !== loadSeqRef.current) return context;
      applyContext(context);
      return context;
    },
    [applyContext, programId, queryClient, sessionUser],
  );

  useEffect(() => {
    identityEpochRef.current += 1;
    loadSeqRef.current += 1;
    hasUserInput.current = false;
    submittingRef.current = false;
    setSubmitting(false);
    setConfirmation(null);
    setServerError(null);
    setErrors({});
    setCreateName('');
    setSelectedInvitees([]);
    setTeamError(null);

    setInviteOpen(false);
    setState({ kind: 'loading' });
    return () => {
      identityEpochRef.current += 1;
      loadSeqRef.current += 1;
    };
  }, [programId, sessionUser]);

  useEffect(() => {
    if (contextQuery.isFetchedAfterMount && contextQuery.data !== undefined) {
      applyContext(contextQuery.data);
    }
  }, [
    applyContext,
    contextQuery.data,
    contextQuery.dataUpdatedAt,
    contextQuery.isFetchedAfterMount,
  ]);

  const refreshLiveState = useCallback(async () => {
    const current = stateRef.current;
    if (current.kind !== 'ready') return;
    await queryClient.invalidateQueries({
      queryKey: programFeatureKey(programId, 'apply-context'),
    });
  }, [programId, queryClient]);

  function requestSubmit(): void {
    if (state.kind !== 'ready') return;
    if (state.mode === 'create' && state.team !== null && !state.team.isLeader)
      return;
    if (state.mode === 'edit' && state.teamId === null) return;
    if (
      state.mode === 'create' &&
      (state.team?.memberCount ?? 1) + selectedInvitees.length <
        state.program.teamMinSize
    )
      return;
    if (
      state.mode === 'create' &&
      state.team === null &&
      createName.trim().length === 0
    ) {
      setTeamError(TEAM_NAME_REQUIRED_MESSAGE);
      setValidationAttempt((current) => current + 1);
      return;
    }
    const nextErrors = validateApplyForm(values, state.mode);
    setErrors(nextErrors);
    setServerError(null);
    if (Object.keys(nextErrors).length > 0) {
      setValidationAttempt((current) => current + 1);
      return;
    }
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
    const currentApplicationId = state.teamId;
    submittingRef.current = true;
    setSubmitting(true);
    setServerError(null);
    try {
      if (confirmation === 'cancel') {
        await cancelMyApplication(programId);
        void invalidateProgram(queryClient, programId);
        void queryClient.invalidateQueries({
          queryKey: featureKey('student-dashboard'),
        });
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
        void invalidateProgram(queryClient, programId);
        void queryClient.invalidateQueries({
          queryKey: featureKey('student-dashboard'),
        });
        if (!mutationStillCurrent(started)) return;
        invalidateBackgroundReads();
        setState({
          kind: 'success',
          program: currentProgram,
          teamId: updated.id,
          mode: 'edit',
        });
        setConfirmation(null);
        return;
      }

      const created = await createApplication(programId, {
        inviteeUserIds: selectedInvitees.map((candidate) => candidate.id),
        teamName: createNameRef.current.trim(),
        answers: applicationAnswers(values),
        applicationTemplateVersion: currentTemplateVersion,
        isRepositoryPublicationPlanned:
          currentProgram.repositoryProvisioningEnabled &&
          values.isRepositoryPublicationPlanned,
      });
      void invalidateProgram(queryClient, programId);
      void queryClient.invalidateQueries({
        queryKey: featureKey('student-dashboard'),
      });
      if (!mutationStillCurrent(started)) return;
      invalidateBackgroundReads();
      setState({
        kind: 'success',
        program: currentProgram,
        teamId: created.id,
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
    creating: false,
    onOpenInvite: () => {
      if (readyTeam !== null) setInviteOpen(true);
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
          teamId={state.teamId}
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
          validationAttempt={validationAttempt}
          serverError={serverError}
          mode={state.mode}
          rejectionReason={state.rejectionReason}
          canManage={state.canManage}
          confirmation={confirmation}
          teamMinimum={
            state.mode === 'create'
              ? {
                  memberCount:
                    (state.team?.memberCount ?? 1) + selectedInvitees.length,
                  teamMinSize: state.program.teamMinSize,
                }
              : null
          }
          nominationContent={
            state.team === null && state.mode === 'create' ? (
              <ApplicationInvitees
                key={`${programId}:${sessionUser.nickname}`}
                programId={programId}
                sessionKey={sessionUser.nickname}
                minimum={state.program.teamMinSize}
                maximum={state.program.teamMaxSize}
                selected={selectedInvitees}
                disabled={submitting}
                onChange={(value) => {
                  hasUserInput.current = true;
                  setSelectedInvitees(value);
                }}
              />
            ) : undefined
          }
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
