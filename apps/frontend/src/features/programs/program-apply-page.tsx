'use client';

// allow: SIZE_OK — route-level async state orchestration is already split from form views.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState } from '@/components';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { createApplication, createTeam, joinTeam } from './api';
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
import { ProgramApplyWizardView } from './program-apply-wizard-view';
import { mapTeamActionError } from './program-teams-flow';
import {
  cancelMyApplication,
  updateMyApplication,
} from './student-application-api';

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

function applicationAnswers(values: ProgramApplyFormValues) {
  return {
    summary: values.summary.trim(),
  } as const;
}

export function ProgramApplyPage({
  programId,
  sessionUser,
  teamId = null,
}: {
  readonly programId: string;
  readonly sessionUser: ProgramApplySessionUser;
  readonly teamId?: string | null;
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
  const [currentStep, setCurrentStep] = useState<'team' | 'application'>(
    'team',
  );
  const [createName, setCreateName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [teamError, setTeamError] = useState<string | null>(null);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [joiningTeam, setJoiningTeam] = useState(false);
  const hasUserInput = useRef(false);
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = loadGeneration.current;
    setState({ kind: 'loading' });
    const context = await loadProgramApplyContext(
      programId,
      teamId,
      sessionUser,
    );
    if (generation !== loadGeneration.current) return;
    if (context.kind === 'ready' && !hasUserInput.current) {
      setValues(context.initialValues);
      setCurrentStep(context.mode === 'edit' ? 'application' : 'team');
    }
    setState(context);
  }, [programId, sessionUser, teamId]);

  useEffect(() => {
    loadGeneration.current += 1;
    hasUserInput.current = false;
    void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [load]);

  async function handleCreateTeam(): Promise<void> {
    if (state.kind !== 'ready' || !createName.trim()) return;
    setCreatingTeam(true);
    setTeamError(null);
    try {
      await createTeam(programId, { name: createName.trim() });
      setCurrentStep('application');
      await load();
    } catch (error: unknown) {
      setTeamError(mapTeamActionError(error, 'create'));
    } finally {
      setCreatingTeam(false);
    }
  }

  async function handleJoinTeam(): Promise<void> {
    if (state.kind !== 'ready' || !joinCode.trim()) return;
    setJoiningTeam(true);
    setTeamError(null);
    try {
      await joinTeam(programId, { joinCode: joinCode.trim() });
      setCurrentStep('application');
      await load();
    } catch (error: unknown) {
      setTeamError(mapTeamActionError(error, 'join'));
    } finally {
      setJoiningTeam(false);
    }
  }

  function requestSubmit(): void {
    if (state.kind !== 'ready') return;
    if (remainingTeamMembers(state.teamMinimum) > 0) return;
    const nextErrors = validateApplyForm(
      values,
      state.mode,
      state.program.repositoryProvisioningEnabled,
    );
    setErrors(nextErrors);
    setServerError(null);
    if (Object.keys(nextErrors).length > 0) return;
    setConfirmation(state.mode === 'create' ? 'submit' : 'save');
  }

  async function confirmAction(): Promise<void> {
    if (state.kind !== 'ready' || confirmation === null) return;
    const action: ProgramApplyAction = confirmation;
    setSubmitting(true);
    setServerError(null);
    try {
      if (confirmation === 'cancel') {
        await cancelMyApplication(programId);
        router.push('/dashboard');
        router.refresh();
        return;
      }
      if (confirmation === 'save') {
        if (state.applicationId === null) return;
        const updated = await updateMyApplication(programId, {
          answers: { title: values.title ?? '', ...applicationAnswers(values) },
          applicationTemplateVersion: state.template.version,
        });
        setState({
          kind: 'success',
          program: state.program,
          applicationId: updated.id,
          mode: 'edit',
        });
        setConfirmation(null);
        return;
      }
      const created = await createApplication(programId, {
        answers: applicationAnswers(values),
        applicationTemplateVersion: state.template.version,
        isRepositoryPublicationPlanned:
          state.program.repositoryProvisioningEnabled &&
          values.isRepositoryPublicationPlanned,
        repositoryConnectionMode: state.program.repositoryProvisioningEnabled
          ? values.repositoryConnectionMode
          : null,
        repositoryUrl: state.program.repositoryProvisioningEnabled
          ? values.repositoryUrl
          : '',
      });
      setState({
        kind: 'success',
        program: state.program,
        applicationId: created.id,
        mode: 'create',
      });
      setConfirmation(null);
    } catch (error: unknown) {
      setConfirmation(null);
      setServerError(
        error instanceof ApiError
          ? mapCreateApplicationError(error.problem, action)
          : applyActionFailureMessage(action),
      );
    } finally {
      setSubmitting(false);
    }
  }

  switch (state.kind) {
    case 'loading':
      return <ApplySkeleton />;
    case 'not-found':
      return (
        <main className="mx-auto w-full max-w-3xl px-4 py-12">
          <EmptyState
            title="프로그램을 찾을 수 없습니다"
            description="삭제되었거나 공개되지 않은 프로그램입니다."
            action={
              <Button asChild variant="outline">
                <Link href="/programs">프로그램 목록으로</Link>
              </Button>
            }
          />
        </main>
      );
    case 'failed':
      return (
        <main className="mx-auto w-full max-w-3xl px-4 py-12">
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
        </main>
      );
    case 'blocked':
      return (
        <BlockedView
          reason={state.reason}
          program={state.program}
          application={state.application}
        />
      );
    case 'success':
      return (
        <ProgramApplySuccessView
          program={state.program}
          applicationId={state.applicationId}
          mode={state.mode}
        />
      );
    case 'ready':
      return (
        <ProgramApplyWizardView
          program={state.program}
          currentStep={currentStep}
          team={state.team}
          createName={createName}
          joinCode={joinCode}
          teamError={teamError}
          creating={creatingTeam}
          joining={joiningTeam}
          onCreateNameChange={setCreateName}
          onJoinCodeChange={setJoinCode}
          onCreate={() => void handleCreateTeam()}
          onJoin={() => void handleJoinTeam()}
          onContinue={() => setCurrentStep('application')}
          onNavigate={(step) => setCurrentStep(step)}
        >
          <ProgramApplyFormView
            program={state.program}
            template={state.template}
            applicantName={state.applicantName}
            githubHandle={state.githubHandle}
            team={state.team}
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
          />
        </ProgramApplyWizardView>
      );
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}
