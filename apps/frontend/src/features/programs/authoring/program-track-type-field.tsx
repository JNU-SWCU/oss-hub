import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import {
  PROGRAM_TRACK_TYPE_LABELS,
  PROGRAM_TRACK_TYPES,
  type ProgramTrackType,
} from '../program-contract';

const TRACK_OPTION_CLASS = cn(
  'relative inline-flex h-control cursor-pointer items-center border border-input bg-background px-5',
  'text-body transition-colors not-first:-ml-px first:rounded-l-control last:rounded-r-control',
  'hover:bg-muted has-checked:z-10 has-checked:border-primary has-checked:bg-primary',
  'has-checked:font-semibold has-checked:text-primary-foreground has-checked:hover:bg-primary',
  'has-focus-visible:z-20 has-focus-visible:border-ring has-focus-visible:ring-3',
  'has-focus-visible:ring-ring/50 in-aria-invalid:border-destructive',
);

export function invalidFieldFocusTarget(field: HTMLElement): HTMLElement {
  if (field.getAttribute('role') !== 'radiogroup') return field;
  return (
    field.querySelector<HTMLElement>('input:checked') ??
    field.querySelector<HTMLElement>('input') ??
    field
  );
}

export function ProgramTrackTypeField({
  value,
  error,
  onChange,
}: {
  readonly value: ProgramTrackType | '';
  readonly error?: string;
  readonly onChange: (trackType: ProgramTrackType) => void;
}) {
  return (
    <Field className="w-auto">
      <FieldLabel id="program-track-type-label">교과/비교과 *</FieldLabel>
      <div
        role="radiogroup"
        aria-labelledby="program-track-type-label"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? 'program-track-type-error' : undefined}
        className="flex"
      >
        {PROGRAM_TRACK_TYPES.map((trackType) => (
          <label key={trackType} className={TRACK_OPTION_CLASS}>
            <input
              type="radio"
              name="program-track-type"
              value={trackType}
              checked={value === trackType}
              className="sr-only"
              onChange={() => onChange(trackType)}
            />
            {PROGRAM_TRACK_TYPE_LABELS[trackType]}
          </label>
        ))}
      </div>
      <FieldError
        id="program-track-type-error"
        role="alert"
        className="contain-inline-size break-keep text-pretty"
      >
        {error}
      </FieldError>
    </Field>
  );
}
