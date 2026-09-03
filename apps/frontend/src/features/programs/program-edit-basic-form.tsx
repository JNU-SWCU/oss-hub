import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { FormSection } from '@/components/form-section';
import type { EditableProgram } from './api';
import {
  type ProgramEditableField,
  type ProgramEditErrors,
  type ProgramEditForm,
} from './program-edit-flow';
import {
  PROGRAM_TRACK_TYPE_LABELS,
  PROGRAM_TRACK_TYPES,
  type ProgramTrackType,
} from './program-templates';
import { ProgramDeadlineControl } from './program-deadline-control';
import { ProgramEditScheduleEditor } from './program-edit-schedule-editor';

interface ProgramEditBasicFormProps {
  readonly program: EditableProgram;
  readonly form: ProgramEditForm;
  readonly errors: ProgramEditErrors;
  readonly isSaving: boolean;
  readonly onFieldChange: (
    field: ProgramEditableField,
    value: string | boolean,
  ) => void;
  readonly onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}

export function ProgramEditBasicForm({
  program,
  form,
  errors,
  isSaving,
  onFieldChange,
  onSubmit,
}: ProgramEditBasicFormProps) {
  return (
    <FormSection title="기본 정보">
      <form className="grid gap-5" onSubmit={onSubmit}>
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
          <Field>
            <FieldLabel htmlFor="program-organizer">주관기관 *</FieldLabel>
            <Input
              id="program-organizer"
              value={form.organizer}
              aria-invalid={Boolean(errors.organizer)}
              aria-describedby={
                errors.organizer ? 'program-organizer-error' : undefined
              }
              onChange={(event) =>
                onFieldChange('organizer', event.target.value)
              }
            />
            <FieldError id="program-organizer-error" role="alert">
              {errors.organizer}
            </FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="program-track-type">교과/비교과 *</FieldLabel>
            <select
              id="program-track-type"
              className="h-control rounded-control border border-input bg-background px-4 text-body"
              value={form.trackType}
              aria-invalid={Boolean(errors.trackType)}
              aria-describedby={
                errors.trackType ? 'program-track-type-error' : undefined
              }
              onChange={(event) =>
                onFieldChange('trackType', event.target.value)
              }
            >
              <option value="">선택</option>
              {PROGRAM_TRACK_TYPES.map((trackType) => (
                <option key={trackType} value={trackType}>
                  {PROGRAM_TRACK_TYPE_LABELS[trackType]}
                </option>
              ))}
            </select>
            <FieldError id="program-track-type-error" role="alert">
              {errors.trackType}
            </FieldError>
          </Field>
          <ProgramEditScheduleEditor
            program={program}
            form={form}
            errors={errors}
            onFieldChange={onFieldChange}
          />
          <Field>
            <FieldLabel>팀 인원 *</FieldLabel>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-2">
                <FieldLabel
                  className="text-small"
                  htmlFor="program-team-min-size"
                >
                  최소
                </FieldLabel>
                <Input
                  id="program-team-min-size"
                  type="number"
                  min="1"
                  value={form.teamMinSize}
                  aria-invalid={Boolean(errors.team)}
                  aria-describedby={`program-team-size-description${errors.team ? ' program-team-size-error' : ''}`}
                  onChange={(event) =>
                    onFieldChange('teamMinSize', event.target.value)
                  }
                />
              </div>
              <div className="space-y-2">
                <FieldLabel
                  className="text-small"
                  htmlFor="program-team-max-size"
                >
                  최대
                </FieldLabel>
                <Input
                  id="program-team-max-size"
                  type="number"
                  min="1"
                  value={form.teamMaxSize}
                  aria-invalid={Boolean(errors.team)}
                  aria-describedby={`program-team-size-description${errors.team ? ' program-team-size-error' : ''}`}
                  onChange={(event) =>
                    onFieldChange('teamMaxSize', event.target.value)
                  }
                />
              </div>
            </div>
            <FieldError id="program-team-size-error" role="alert">
              {errors.team}
            </FieldError>
            <FieldDescription id="program-team-size-description">
              개인 신청도 1인 팀으로 다뤄집니다. 팀을 받지 않으려면 최소·최대를
              모두 1로 둡니다.
            </FieldDescription>
          </Field>
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
          <Field orientation="horizontal">
            <input
              id="repository-provisioning"
              type="checkbox"
              checked={form.repositoryProvisioningEnabled}
              onChange={(event) =>
                onFieldChange(
                  'repositoryProvisioningEnabled',
                  event.target.checked,
                )
              }
            />
            <FieldLabel htmlFor="repository-provisioning">
              신청 승인 시 GitHub 저장소 자동 생성
            </FieldLabel>
          </Field>
          <ProgramDeadlineControl
            enabled={form.notifyOnDeadline}
            persistedEnabled={program.notifyOnDeadline}
            programId={program.id}
            onEnabledChange={(enabled) =>
              onFieldChange('notifyOnDeadline', enabled)
            }
          />
          <FieldError role="alert">{errors.general}</FieldError>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? '저장 중…' : '변경사항 저장'}
            </Button>
          </div>
        </FieldGroup>
      </form>
    </FormSection>
  );
}

function isProgramTrackType(value: string): value is ProgramTrackType {
  return value === 'CURRICULAR' || value === 'EXTRACURRICULAR';
}
