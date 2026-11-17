import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  FIELD_BOX_CLASS,
  FIELD_BOX_INPUT_CLASS,
} from './program-organizer-field';
import { teamSizeValue } from './program-team-size';

const TEAM_SIZE_FLOOR = 1;

const TEAM_SIZE_ERROR_ID = 'program-team-size-error';

const TEAM_STEPPER_CLASS = cn(
  FIELD_BOX_CLASS,
  'inline-flex h-control items-center',
);

const TEAM_STEPPER_INPUT_CLASS = cn(
  FIELD_BOX_INPUT_CLASS,
  'h-full w-10 px-0 text-center [appearance:textfield]',
  '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
);

const TEAM_STEPPER_BUTTON_CLASS = 'h-full w-9 text-muted-foreground';

function TeamSizeStepper({
  id,
  label,
  value,
  invalid,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly invalid: boolean;
  readonly onChange: (value: string) => void;
}) {
  const parsed = teamSizeValue(value);
  const size = parsed !== null && Number.isFinite(parsed) ? parsed : Number.NaN;
  return (
    <div className={TEAM_STEPPER_CLASS}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={TEAM_STEPPER_BUTTON_CLASS}
        aria-label={`${label} 줄이기`}
        disabled={!(size > TEAM_SIZE_FLOOR)}
        onClick={() =>
          onChange(String(Math.max(TEAM_SIZE_FLOOR, Math.ceil(size) - 1)))
        }
      >
        <Minus aria-hidden="true" />
      </Button>
      <Input
        id={id}
        type="number"
        min={TEAM_SIZE_FLOOR}
        value={value}
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={invalid ? TEAM_SIZE_ERROR_ID : undefined}
        className={TEAM_STEPPER_INPUT_CLASS}
        onChange={(event) => onChange(event.target.value)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={TEAM_STEPPER_BUTTON_CLASS}
        aria-label={`${label} 늘리기`}
        onClick={() =>
          onChange(
            String(
              size >= TEAM_SIZE_FLOOR ? Math.floor(size) + 1 : TEAM_SIZE_FLOOR,
            ),
          )
        }
      >
        <Plus aria-hidden="true" />
      </Button>
    </div>
  );
}

export function ProgramTeamSizeField({
  minSize,
  maxSize,
  minError,
  maxError,
  onMinSizeChange,
  onMaxSizeChange,
}: {
  readonly minSize: string;
  readonly maxSize: string;
  readonly minError?: string;
  readonly maxError?: string;
  readonly onMinSizeChange: (value: string) => void;
  readonly onMaxSizeChange: (value: string) => void;
}) {
  return (
    <Field className="w-auto" aria-labelledby="program-team-size-label">
      <FieldLabel id="program-team-size-label" htmlFor="program-team-min-size">
        인원 *
      </FieldLabel>
      <div className="flex items-center gap-2">
        <TeamSizeStepper
          id="program-team-min-size"
          label="최소 인원"
          value={minSize}
          invalid={Boolean(minError)}
          onChange={onMinSizeChange}
        />
        <span aria-hidden="true">~</span>
        <TeamSizeStepper
          id="program-team-max-size"
          label="최대 인원"
          value={maxSize}
          invalid={Boolean(maxError)}
          onChange={onMaxSizeChange}
        />
      </div>
      <FieldError
        id={TEAM_SIZE_ERROR_ID}
        role="alert"
        className="contain-inline-size break-keep text-pretty"
        errors={[minError, maxError].flatMap((message) =>
          message ? [{ message }] : [],
        )}
      />
    </Field>
  );
}
