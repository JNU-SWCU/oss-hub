'use client';

import { X } from 'lucide-react';
import {
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
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

export const FIELD_BOX_CLASS = cn(
  'rounded-control border border-input transition-colors dark:bg-input/30',
  'has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3',
  'has-[input:focus-visible]:ring-ring/50 has-[input[aria-invalid=true]]:border-destructive',
  'has-[input[aria-invalid=true]]:ring-3 has-[input[aria-invalid=true]]:ring-destructive/20',
);

export const FIELD_BOX_INPUT_CLASS = cn(
  'rounded-none border-0 focus-visible:ring-0 disabled:bg-transparent aria-invalid:ring-0',
  'dark:bg-transparent dark:disabled:bg-transparent',
);

const ORGANIZER_BOX_CLASS = cn(
  FIELD_BOX_CLASS,
  'flex min-h-control cursor-text flex-wrap items-center gap-2 px-2 py-1.5',
  'has-[input:disabled]:cursor-not-allowed has-[input:disabled]:bg-input/50',
);

const ORGANIZER_INPUT_CLASS = cn(FIELD_BOX_INPUT_CLASS, 'min-w-32 flex-1 px-2');

function addOrganizers(
  current: readonly string[],
  candidates: readonly string[],
): { readonly next: string[]; readonly rejected: string[] } {
  const next = [...current];
  const rejected: string[] = [];
  for (const candidate of candidates) {
    const label = candidate.trim().slice(0, PROGRAM_ORGANIZER_MAX_LENGTH);
    if (label === '' || next.includes(label) || rejected.includes(label))
      continue;
    if (next.length >= PROGRAM_ORGANIZER_MAX_COUNT) rejected.push(label);
    else next.push(label);
  }
  return { next, rejected };
}

export function ProgramOrganizerField({
  id,
  value,
  onChange,
  error,
  disabled,
}: ProgramOrganizerFieldProps) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const full = value.length >= PROGRAM_ORGANIZER_MAX_COUNT;

  const commitSegments = (segments: readonly string[], rest: string) => {
    const { next, rejected } = addOrganizers(value, segments);
    if (next.length !== value.length) onChange(next);
    setDraft(
      rejected.length === 0
        ? rest.slice(0, PROGRAM_ORGANIZER_MAX_LENGTH)
        : [...rejected, rest.trim()].filter((part) => part !== '').join(', '),
    );
  };

  const commitDraft = () => commitSegments(draft.split(','), '');

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const text = event.target.value;
    if (!text.includes(',')) {
      setDraft(text.slice(0, PROGRAM_ORGANIZER_MAX_LENGTH));
      return;
    }
    const segments = text.split(',');
    const rest = segments.pop() ?? '';
    commitSegments(segments, rest);
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text/plain');
    if (!pasted.includes(',')) return;
    event.preventDefault();
    const { value: text, selectionStart, selectionEnd } = event.currentTarget;
    const start = selectionStart ?? text.length;
    const end = selectionEnd ?? start;
    commitSegments(
      `${text.slice(0, start)}${pasted}${text.slice(end)}`.split(','),
      '',
    );
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

  const focusInput = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('button'))
      return;
    inputRef.current?.focus();
  };

  const placeholder = full
    ? undefined
    : value.length === 0
      ? '기관 이름 입력 후 Enter'
      : '+ 추가';

  return (
    <Field>
      <FieldLabel htmlFor={id}>주관기관 *</FieldLabel>
      <div className={ORGANIZER_BOX_CLASS} onClick={focusInput}>
        {value.length > 0 ? (
          <ul className="contents" aria-label="입력한 주관기관">
            {value.map((label) => (
              <li key={label} className={ORGANIZER_CHIP_CLASS}>
                <span className="py-1">{label}</span>
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
          ref={inputRef}
          id={id}
          value={draft}
          disabled={disabled}
          maxLength={PROGRAM_ORGANIZER_MAX_LENGTH}
          autoComplete="off"
          enterKeyHint="enter"
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          aria-describedby={
            error ? `${descriptionId} ${errorId}` : descriptionId
          }
          className={ORGANIZER_INPUT_CLASS}
          onChange={handleChange}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          onBlur={commitDraft}
        />
      </div>
      <FieldDescription
        id={descriptionId}
        className={full ? undefined : 'sr-only'}
      >
        {full ? PROGRAM_ORGANIZER_MESSAGES.tooMany : ORGANIZER_HINT}
      </FieldDescription>
      <FieldError id={errorId} role="alert">
        {error}
      </FieldError>
    </Field>
  );
}
