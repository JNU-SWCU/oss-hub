'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  createAuthoringProgram,
  deleteAuthoringUpload,
  uploadAuthoringFile,
} from './program-authoring-api';
import { ProgramAuthoringConfirmationDialog } from './program-authoring-confirmation-dialog';
import {
  PROGRAM_AUTHORING_STEPS,
  createInitialProgramAuthoringState,
  programAuthoringReducer,
  type ProgramAuthoringAction,
  type ProgramAuthoringState,
  type ProgramAuthoringStep,
} from './program-authoring-model';
import { ProgramAuthoringShell } from './program-authoring-shell';
import { ProgramAuthoringStepContent } from './program-authoring-step-content';
import {
  clearProgramAuthoringRecoveryKey,
  loadProgramAuthoringRecoveryKey,
  persistProgramAuthoringRecoveryKey,
} from './program-authoring-storage';
import {
  createProgramSubmissionRuntime,
  submitProgramAuthoring,
} from './program-authoring-submit';
import {
  validateProgramAuthoringManifest,
  validateProgramAuthoringStep,
  type ProgramAuthoringIssue,
} from './program-authoring-validation';
import { useProgramExitGuard } from './use-program-exit-guard';

export function ProgramCreationPage({
  initialState,
}: {
  readonly initialState?: ProgramAuthoringState;
}) {
  const [state, dispatch] = useReducer(
    programAuthoringReducer,
    undefined,
    () =>
      initialState ??
      createInitialProgramAuthoringState({
        idempotencyKey: newAuthoringId(),
        milestoneId: newAuthoringId(),
      }),
  );
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<readonly ProgramAuthoringIssue[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const filesRef = useRef(new Map<string, File>());
  const runtimeRef = useRef(createProgramSubmissionRuntime());
  const stepRegionRef = useRef<HTMLDivElement>(null);

  const discardUnsavedFiles = () => {
    filesRef.current.clear();
    void Promise.allSettled(
      [...runtimeRef.current.uploads.values()].map((upload) =>
        deleteAuthoringUpload(upload.id),
      ),
    );
    runtimeRef.current.uploads.clear();
  };
  const { completeAndNavigate } = useProgramExitGuard(
    dirty,
    discardUnsavedFiles,
  );

  useEffect(() => {
    const idempotencyKey = loadProgramAuthoringRecoveryKey(
      window.sessionStorage,
    );
    if (idempotencyKey !== null) {
      dispatch({ type: 'rotate_idempotency_key', key: idempotencyKey });
    }
  }, []);

  useEffect(() => {
    if (issues.length === 0) return;
    const firstInvalidField =
      stepRegionRef.current?.querySelector<HTMLElement>(
        '[aria-invalid="true"]:not(:disabled)',
      ) ?? null;
    if (firstInvalidField === null) {
      stepRegionRef.current?.focus();
      return;
    }
    firstInvalidField.focus({ preventScroll: true });
    firstInvalidField.scrollIntoView?.({ block: 'center' });
  }, [issues, state.currentStep]);

  const update = (action: ProgramAuthoringAction) => {
    setDirty(true);
    setIssues([]);
    setServerError(null);
    dispatch(action);
  };

  const navigate = (step: ProgramAuthoringStep) => {
    setIssues([]);
    dispatch({ type: 'go_to_step', step });
    window.requestAnimationFrame(() => stepRegionRef.current?.focus());
  };

  const targetStep = (direction: -1 | 1): ProgramAuthoringStep | undefined => {
    const index = PROGRAM_AUTHORING_STEPS.findIndex(
      (step) => step.id === state.currentStep,
    );
    return PROGRAM_AUTHORING_STEPS[index + direction]?.id;
  };

  const move = (direction: -1 | 1) => {
    const target = targetStep(direction);
    if (target !== undefined) navigate(target);
  };

  const next = () => {
    const nextIssues = validateProgramAuthoringStep(state, state.currentStep);
    if (nextIssues.length > 0) {
      setIssues(nextIssues);
      return;
    }
    const target = targetStep(1);
    if (target === undefined) return;
    navigate(target);
  };

  const review = () => {
    const nextIssues = validateProgramAuthoringManifest(state);
    if (nextIssues.length > 0) {
      setIssues(nextIssues);
      const first = nextIssues[0];
      if (first !== undefined) {
        dispatch({ type: 'go_to_step', step: first.step });
      }
      return;
    }
    setConfirmationOpen(true);
  };

  const submit = async () => {
    setSubmitting(true);
    setServerError(null);
    const result = await submitProgramAuthoring({
      state,
      files: filesRef.current,
      runtime: runtimeRef.current,
      api: {
        uploadFile: uploadAuthoringFile,
        deleteUpload: deleteAuthoringUpload,
        createProgram: createAuthoringProgram,
      },
    });
    setSubmitting(false);
    switch (result.kind) {
      case 'ignored':
        return;
      case 'success':
        clearProgramAuthoringRecoveryKey(window.sessionStorage);
        filesRef.current.clear();
        runtimeRef.current.uploads.clear();
        setDirty(false);
        setConfirmationOpen(false);
        completeAndNavigate(
          `/programs/${encodeURIComponent(result.programId)}`,
        );
        return;
      case 'conflict':
        {
          const idempotencyKey = newAuthoringId();
          dispatch({ type: 'rotate_idempotency_key', key: idempotencyKey });
          persistProgramAuthoringRecoveryKey(
            window.sessionStorage,
            idempotencyKey,
          );
        }
        setConfirmationOpen(false);
        setServerError(
          '이전 생성 요청과 내용이 충돌했습니다. 다시 확인해 주세요.',
        );
        return;
      case 'failure':
        setConfirmationOpen(false);
        setServerError(result.message);
        return;
      default:
        return assertNever(result);
    }
  };

  return (
    <ProgramAuthoringShell
      currentStep={state.currentStep}
      onNavigate={navigate}
    >
      <div
        ref={stepRegionRef}
        tabIndex={-1}
        className="grid gap-8 outline-none"
      >
        <ProgramAuthoringStepContent
          step={state.currentStep}
          state={state}
          issues={issues}
          dispatch={update}
          files={filesRef.current}
          runtime={runtimeRef.current}
          newId={newAuthoringId}
        />
        <div className="flex flex-wrap justify-end gap-3 border-t border-border pt-6">
          {serverError ? (
            <p
              role="alert"
              className="mr-auto self-center text-small text-destructive break-keep"
            >
              {serverError}
            </p>
          ) : null}
          {state.currentStep !== 'type' ? (
            <Button type="button" variant="outline" onClick={() => move(-1)}>
              이전
            </Button>
          ) : null}
          {state.currentStep === 'review' ? (
            <Button type="button" onClick={review}>
              프로그램 만들기
            </Button>
          ) : (
            <Button type="button" onClick={next}>
              계속
            </Button>
          )}
        </div>
      </div>
      {confirmationOpen ? (
        <ProgramAuthoringConfirmationDialog
          submitting={submitting}
          onCancel={() => setConfirmationOpen(false)}
          onConfirm={() => void submit()}
        />
      ) : null}
    </ProgramAuthoringShell>
  );
}

function newAuthoringId(): string {
  return globalThis.crypto.randomUUID();
}

function assertNever(value: never): never {
  throw new TypeError(`Unhandled authoring value: ${String(value)}`);
}
