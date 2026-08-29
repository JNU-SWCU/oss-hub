'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
  type ProgramAuthoringStep,
} from './program-authoring-model';
import { ProgramAuthoringShell } from './program-authoring-shell';
import { ProgramAuthoringStepContent } from './program-authoring-step-content';
import {
  clearProgramAuthoringState,
  loadProgramAuthoringState,
  persistProgramAuthoringState,
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

export function ProgramCreationPage() {
  const [state, dispatch] = useReducer(programAuthoringReducer, undefined, () =>
    createInitialProgramAuthoringState({
      idempotencyKey: newAuthoringId(),
      milestoneId: newAuthoringId(),
    }),
  );
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<readonly ProgramAuthoringIssue[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
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
    const restored = loadProgramAuthoringState(window.sessionStorage);
    if (restored !== null) {
      dispatch({ type: 'restore_state', state: restored });
      setDirty(false);
      setSaveStatus('임시 저장한 작성본을 불러왔습니다.');
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
    setSaveStatus(null);
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

  const saveDraft = (nextStep: ProgramAuthoringStep = state.currentStep) => {
    const savedState = { ...state, currentStep: nextStep };
    persistProgramAuthoringState(window.sessionStorage, savedState);
    setDirty(false);
    setSaveStatus(
      '임시 저장했습니다. 이 브라우저에서 이어서 작성할 수 있습니다.',
    );
  };

  const next = () => {
    const nextIssues = validateProgramAuthoringStep(state, state.currentStep);
    if (nextIssues.length > 0) {
      setIssues(nextIssues);
      return;
    }
    const target = targetStep(1);
    if (target === undefined) return;
    saveDraft(target);
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
        clearProgramAuthoringState(window.sessionStorage);
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
          persistProgramAuthoringState(window.sessionStorage, {
            ...state,
            idempotencyKey,
          });
        }
        setConfirmationOpen(false);
        setServerError(
          '이 생성 요청은 이전 내용과 충돌했습니다. 입력 내용은 유지되었습니다. 다시 확인한 뒤 생성해 주세요.',
        );
        return;
      case 'failure':
        setConfirmationOpen(false);
        setServerError(
          `${result.message} 입력은 그대로 유지했습니다. 내용을 확인한 뒤 다시 ‘프로그램 만들기’를 눌러 주세요.`,
        );
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
        {serverError ? (
          <Alert variant="destructive">
            <AlertTitle>생성 실패</AlertTitle>
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        ) : null}
        {issues.length > 0 ? (
          <Alert variant="destructive">
            <AlertTitle>입력 내용을 확인해 주세요</AlertTitle>
            <AlertDescription>
              {issues[0]?.message} 표시된 입력란을 고친 뒤 ‘저장하고 계속’을
              눌러 주세요.
            </AlertDescription>
          </Alert>
        ) : null}
        {saveStatus ? (
          <p role="status" className="text-small text-muted-foreground">
            {saveStatus}
          </p>
        ) : null}
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
          {state.currentStep !== 'type' ? (
            <Button type="button" variant="outline" onClick={() => move(-1)}>
              이전
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => saveDraft()}>
            임시 저장
          </Button>
          {state.currentStep === 'review' ? (
            <Button type="button" onClick={review}>
              프로그램 만들기
            </Button>
          ) : (
            <Button type="button" onClick={next}>
              저장하고 계속
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
