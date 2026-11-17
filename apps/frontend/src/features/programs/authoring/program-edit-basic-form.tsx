import { Minus, Plus } from 'lucide-react';
import { ProgramCoverField } from './program-cover-field';
import type { ProgramCoverSelection } from './program-cover-selection';
import { ProgramNoticeImport } from './program-notice-import';
import {
  FIELD_BOX_CLASS,
  FIELD_BOX_INPUT_CLASS,
  ProgramOrganizerField,
} from './program-organizer-field';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { FormSection } from '@/components/form-section';
import { cn } from '@/lib/utils';
import type { EditableProgram } from './dto';
import {
  type ProgramEditableField,
  type ProgramEditErrors,
  type ProgramEditFieldValue,
  type ProgramEditForm,
} from './program-edit-flow';
import {
  PROGRAM_TRACK_TYPE_LABELS,
  PROGRAM_TRACK_TYPES,
} from '../program-contract';
import { programHref } from '../program-paths';
import { ProgramDeadlineControl } from './program-deadline-control';

interface ProgramEditBasicFormProps {
  readonly coverSelection?: ProgramCoverSelection;
  readonly onCoverChange: (selection: ProgramCoverSelection) => void;
  readonly isSaving?: boolean;
  readonly program: EditableProgram;
  readonly form: ProgramEditForm;
  readonly errors: ProgramEditErrors;
  readonly onFieldChange: (
    field: ProgramEditableField,
    value: ProgramEditFieldValue,
  ) => void;
}

const TEAM_SIZE_FLOOR = 1;

const TRACK_OPTION_CLASS = cn(
  'relative inline-flex h-control cursor-pointer items-center border border-input bg-background px-5',
  'text-body transition-colors not-first:-ml-px first:rounded-l-control last:rounded-r-control',
  'hover:bg-muted has-checked:z-10 has-checked:border-primary has-checked:bg-primary',
  'has-checked:font-semibold has-checked:text-primary-foreground has-checked:hover:bg-primary',
  'has-focus-visible:z-20 has-focus-visible:border-ring has-focus-visible:ring-3',
  'has-focus-visible:ring-ring/50 in-aria-invalid:border-destructive',
);

const INLINE_ERROR_CLASS = 'contain-inline-size break-keep text-pretty';

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
  const size = Number.parseInt(value, 10);
  return (
    <div className={TEAM_STEPPER_CLASS}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={TEAM_STEPPER_BUTTON_CLASS}
        aria-label={`${label} 줄이기`}
        disabled={!(size > TEAM_SIZE_FLOOR)}
        onClick={() => onChange(String(size - 1))}
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
        aria-describedby={invalid ? 'program-team-size-error' : undefined}
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
          onChange(String(size >= TEAM_SIZE_FLOOR ? size + 1 : TEAM_SIZE_FLOOR))
        }
      >
        <Plus aria-hidden="true" />
      </Button>
    </div>
  );
}

export function ProgramEditBasicForm({
  coverSelection,
  onCoverChange,
  isSaving,
  program,
  form,
  errors,
  onFieldChange,
}: ProgramEditBasicFormProps) {
  return (
    <FormSection
      aria-labelledby="edit-basic-title"
      className="[&>legend]:w-full"
      title={
        <span className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <span id="edit-basic-title">기본 정보</span>
          <ProgramNoticeImport
            currentName={form.name}
            currentDescription={form.description}
            hasCover={Boolean(
              coverSelection ||
              (coverSelection === undefined && program.coverImageUrl),
            )}
            sourceUrl={program.externalCover?.sourceUrl}
            disabled={isSaving}
            onApply={(patch) => {
              if (patch.name !== undefined) onFieldChange('name', patch.name);
              if (patch.description !== undefined)
                onFieldChange('description', patch.description);
              if (patch.externalCover !== undefined)
                onCoverChange(patch.externalCover);
            }}
          />
        </span>
      }
      description="프로그램 목록과 상세 화면에 표시할 정보를 입력하세요."
    >
      <div className="grid items-start gap-8 md:grid-cols-[14rem_minmax(0,1fr)]">
        <ProgramCoverField
          selection={coverSelection}
          currentImageUrl={program.coverImageUrl}
          disabled={isSaving}
          serverError={errors.coverUploadId}
          onChange={onCoverChange}
        />
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="program-name">프로그램명 *</FieldLabel>
            <Input
              id="program-name"
              value={form.name}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'program-name-error' : undefined}
              onChange={(event) => onFieldChange('name', event.target.value)}
            />
            <FieldError id="program-name-error" role="alert">
              {errors.name}
            </FieldError>
          </Field>
          <ProgramOrganizerField
            id="program-organizers"
            value={form.organizers}
            error={errors.organizers}
            disabled={isSaving}
            onChange={(organizers) => onFieldChange('organizers', organizers)}
          />
          <div className="flex flex-wrap gap-x-12 gap-y-5">
            <Field className="w-auto">
              <FieldLabel id="program-track-type-label">
                교과/비교과 *
              </FieldLabel>
              <div
                role="radiogroup"
                aria-labelledby="program-track-type-label"
                aria-invalid={Boolean(errors.trackType)}
                aria-describedby={
                  errors.trackType ? 'program-track-type-error' : undefined
                }
                className="flex"
              >
                {PROGRAM_TRACK_TYPES.map((trackType) => (
                  <label key={trackType} className={TRACK_OPTION_CLASS}>
                    <input
                      type="radio"
                      name="program-track-type"
                      value={trackType}
                      checked={form.trackType === trackType}
                      className="sr-only"
                      onChange={() => onFieldChange('trackType', trackType)}
                    />
                    {PROGRAM_TRACK_TYPE_LABELS[trackType]}
                  </label>
                ))}
              </div>
              <FieldError
                id="program-track-type-error"
                role="alert"
                className={INLINE_ERROR_CLASS}
              >
                {errors.trackType}
              </FieldError>
            </Field>
            <Field className="w-auto" aria-labelledby="program-team-size-label">
              <FieldLabel
                id="program-team-size-label"
                htmlFor="program-team-min-size"
              >
                인원 *
              </FieldLabel>
              <div className="flex items-center gap-2">
                <TeamSizeStepper
                  id="program-team-min-size"
                  label="최소 인원"
                  value={form.teamMinSize}
                  invalid={Boolean(errors.team)}
                  onChange={(value) => onFieldChange('teamMinSize', value)}
                />
                <span aria-hidden="true">~</span>
                <TeamSizeStepper
                  id="program-team-max-size"
                  label="최대 인원"
                  value={form.teamMaxSize}
                  invalid={Boolean(errors.team)}
                  onChange={(value) => onFieldChange('teamMaxSize', value)}
                />
              </div>
              <FieldError
                id="program-team-size-error"
                role="alert"
                className={INLINE_ERROR_CLASS}
              >
                {errors.team}
              </FieldError>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="program-description">소개/설명 *</FieldLabel>
            <textarea
              id="program-description"
              value={form.description}
              aria-invalid={Boolean(errors.description)}
              aria-describedby={
                errors.description ? 'program-description-error' : undefined
              }
              onChange={(event) =>
                onFieldChange('description', event.target.value)
              }
              className="min-h-32 rounded-control border border-input bg-transparent p-4 text-body"
            />
            <FieldError id="program-description-error" role="alert">
              {errors.description}
            </FieldError>
          </Field>
        </FieldGroup>
      </div>
    </FormSection>
  );
}

export function ProgramEditOperationsSection({
  program,
  form,
  onFieldChange,
}: Pick<ProgramEditBasicFormProps, 'program' | 'form' | 'onFieldChange'>) {
  return (
    <FormSection
      id="operations"
      title="운영 설정"
      description="신청 승인 이후의 저장소 발급과 제출 마감 알림을 설정하세요."
    >
      <Field orientation="horizontal">
        <input
          id="repository-provisioning"
          type="checkbox"
          checked={form.repositoryProvisioningEnabled}
          onChange={(event) =>
            onFieldChange('repositoryProvisioningEnabled', event.target.checked)
          }
        />
        <FieldLabel htmlFor="repository-provisioning">
          신청 승인 시 GitHub 저장소 자동 생성
        </FieldLabel>
      </Field>
      <ProgramDeadlineControl
        id="program-deadline-notification"
        enabled={form.notifyOnDeadline}
        persistedEnabled={program.notifyOnDeadline}
        notificationsHref={programHref(program.id, '/notifications')}
        onEnabledChange={(enabled) =>
          onFieldChange('notifyOnDeadline', enabled)
        }
      />
    </FormSection>
  );
}
