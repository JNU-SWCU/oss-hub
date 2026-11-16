'use client';

import { X } from 'lucide-react';
import { useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  PROGRAM_ORGANIZER_MAX_COUNT,
  PROGRAM_ORGANIZER_MAX_LENGTH,
  PROGRAM_ORGANIZER_MESSAGES,
} from '../program-contract';

export type ProgramOrganizerFieldProps = {
  readonly id: string;
  readonly value: readonly string[];
  readonly onChange: (next: string[]) => void;
  readonly error?: string;
  readonly disabled?: boolean;
};

const ORGANIZER_HINT = `Enter 또는 쉼표(,)로 추가합니다. 최대 ${PROGRAM_ORGANIZER_MAX_COUNT}개.`;

const ORGANIZER_CHIP_CLASS = cn(
  'inline-flex max-w-full min-h-control items-center gap-1 rounded-full border border-secondary bg-secondary pl-4',
  'text-small font-semibold text-secondary-foreground break-keep [overflow-wrap:anywhere]',
);

function addOrganizers(
  current: readonly string[],
  candidates: readonly string[],
): string[] | null {
  const next = [...current];
  for (const candidate of candidates) {
    const label = candidate.trim().slice(0, PROGRAM_ORGANIZER_MAX_LENGTH);
    if (label === '' || next.includes(label)) continue;
    if (next.length >= PROGRAM_ORGANIZER_MAX_COUNT) break;
    next.push(label);
  }
  return next.length === current.length ? null : next;
}

export function ProgramOrganizerField({
  id,
  value,
  onChange,
  error,
  disabled,
}: ProgramOrganizerFieldProps) {
  const [draft, setDraft] = useState('');
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const full = value.length >= PROGRAM_ORGANIZER_MAX_COUNT;

  const commitLabels = (candidates: readonly string[]) => {
    const next = addOrganizers(value, candidates);
    if (next !== null) onChange(next);
  };

  const commitDraft = () => {
    const label = draft.trim();
    if (label !== '' && full && !value.includes(label)) return;
    commitLabels([label]);
    setDraft('');
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const text = event.target.value;
    if (!text.includes(',')) {
      setDraft(text.slice(0, PROGRAM_ORGANIZER_MAX_LENGTH));
      return;
    }
    const parts = text.split(',');
    const rest = parts.pop() ?? '';
    commitLabels(parts);
    setDraft(rest.slice(0, PROGRAM_ORGANIZER_MAX_LENGTH));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commitDraft();
      return;
    }
    if (event.key === 'Backspace' && draft === '' && value.length > 0) {
      event.preventDefault();
      onChange(value.slice(0, -1));
    }
  };

  return (
    <Field>
      <FieldLabel htmlFor={id}>주관기관 *</FieldLabel>
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="입력한 주관기관">
          {value.map((label) => (
            <li key={label} className={ORGANIZER_CHIP_CLASS}>
              <span className="py-2">{label}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="rounded-full"
                disabled={disabled}
                aria-label={`${label} 삭제`}
                onClick={() =>
                  onChange(value.filter((organizer) => organizer !== label))
                }
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <Input
        id={id}
        value={draft}
        disabled={disabled}
        maxLength={PROGRAM_ORGANIZER_MAX_LENGTH}
        autoComplete="off"
        enterKeyHint="enter"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${descriptionId} ${errorId}` : descriptionId}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={commitDraft}
      />
      <FieldDescription id={descriptionId}>
        {full ? PROGRAM_ORGANIZER_MESSAGES.tooMany : ORGANIZER_HINT}
      </FieldDescription>
      <FieldError id={errorId} role="alert">
        {error}
      </FieldError>
    </Field>
  );
}
