import type { ReactNode } from 'react';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export function ProgramMilestoneFields({
  id,
  noticeId = `${id}-notice`,
  name,
  instructions,
  nameError,
  instructionsError,
  schedule,
  onNameChange,
  onInstructionsChange,
}: {
  readonly id: string;
  readonly noticeId?: string;
  readonly name: string;
  readonly instructions: string;
  readonly nameError?: string | null;
  readonly instructionsError?: string | null;
  readonly schedule: ReactNode;
  readonly onNameChange: (value: string) => void;
  readonly onInstructionsChange: (value: string) => void;
}) {
  const nameErrorId = `${id}-name-error`;
  const noticeErrorId = `${noticeId}-error`;

  return (
    <>
      {schedule}
      <Field>
        <FieldLabel htmlFor={`${id}-name`}>마일스톤 이름 *</FieldLabel>
        <Input
          id={`${id}-name`}
          value={name}
          aria-invalid={Boolean(nameError)}
          aria-describedby={nameError ? nameErrorId : undefined}
          onChange={(event) => onNameChange(event.target.value)}
        />
        <FieldError id={nameErrorId} role="alert">
          {nameError}
        </FieldError>
      </Field>
      <Field>
        <FieldLabel htmlFor={noticeId}>운영자 공지</FieldLabel>
        <textarea
          id={noticeId}
          value={instructions}
          aria-invalid={Boolean(instructionsError)}
          aria-describedby={instructionsError ? noticeErrorId : undefined}
          onChange={(event) => onInstructionsChange(event.target.value)}
          className="min-h-28 rounded-control border border-input bg-transparent p-4 text-body break-keep whitespace-pre-wrap [overflow-wrap:anywhere]"
        />
        <FieldError id={noticeErrorId} role="alert">
          {instructionsError}
        </FieldError>
      </Field>
    </>
  );
}
