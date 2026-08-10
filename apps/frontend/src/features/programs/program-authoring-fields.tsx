import type { HTMLInputTypeAttribute } from 'react';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { ProgramAuthoringIssue } from './program-authoring-validation';

export type ProgramAuthoringTextFieldProps = {
  readonly id: string;
  readonly label: string;
  readonly type?: HTMLInputTypeAttribute;
  readonly min?: string;
  readonly max?: string;
  readonly value: string;
  readonly error?: string;
  readonly onChange: (value: string) => void;
};

export function ProgramAuthoringTextField({
  id,
  label,
  type,
  min,
  max,
  value,
  error,
  onChange,
}: ProgramAuthoringTextFieldProps) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type={type}
        min={min}
        max={max}
        value={value}
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldError>{error}</FieldError>
    </Field>
  );
}

export function ProgramAuthoringDatePair({
  legend,
  first,
  second,
}: {
  readonly legend: string;
  readonly first: ProgramAuthoringTextFieldProps;
  readonly second: ProgramAuthoringTextFieldProps;
}) {
  return (
    <Field>
      <FieldLabel>{legend}</FieldLabel>
      <div className="grid gap-3 sm:grid-cols-2">
        <ProgramAuthoringTextField {...first} type="datetime-local" />
        <ProgramAuthoringTextField {...second} type="datetime-local" />
      </div>
    </Field>
  );
}

export function messageFor(
  issues: readonly ProgramAuthoringIssue[],
  path: string,
): string | undefined {
  return issues.find((issue) => issue.path === path)?.message;
}
