'use client';

import { useState, type ReactElement, type RefObject } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Field, FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import { renameProgramTeam } from './api';
import { DialogShell } from '@/components';

const TEAM_NAME_MAX_LENGTH = 100;

export function TeamNameDialog({
  programId,
  teamId,
  currentName,
  returnFocusRef,
  onRenamed,
  onCancel,
}: {
  readonly programId: string;
  readonly teamId: string;
  readonly currentName: string;

  readonly returnFocusRef: RefObject<HTMLElement | null>;
  readonly onRenamed: (name: string) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const [draft, setDraft] = useState(currentName);
  const [busy, setBusy] = useState(false);

  const [attempted, setAttempted] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const trimmed = draft.trim();
  const emptyError = trimmed === '' ? '팀 이름을 입력해 주세요.' : null;

  async function save(): Promise<void> {
    if (busy) return;
    setAttempted(true);
    if (emptyError !== null) return;

    if (trimmed === currentName) {
      onCancel();
      return;
    }
    setBusy(true);
    setErrorMessage(null);
    try {
      const renamed = await renameProgramTeam(programId, teamId, trimmed);
      onRenamed(renamed.name);
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof ApiError
          ? error.problem.detail
          : '팀 이름을 바꾸지 못했습니다.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell
      title="팀 이름 변경"
      busy={busy}
      returnFocusRef={returnFocusRef}
      onCancel={onCancel}
      onSave={() => void save()}
    >
      <Field>
        <Input
          aria-label="팀 이름"
          value={draft}
          disabled={busy}
          maxLength={TEAM_NAME_MAX_LENGTH}
          aria-invalid={attempted && emptyError !== null}
          aria-describedby={
            attempted && emptyError !== null ? 'team-name-error' : undefined
          }
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void save();
          }}
        />
        <FieldError id="team-name-error">
          {attempted ? emptyError : null}
        </FieldError>
      </Field>
      {errorMessage !== null ? (
        <Alert variant="destructive">
          <AlertTitle>저장하지 못했습니다</AlertTitle>
          <AlertDescription className="[word-break:keep-all]">
            {errorMessage}
          </AlertDescription>
        </Alert>
      ) : null}
    </DialogShell>
  );
}
