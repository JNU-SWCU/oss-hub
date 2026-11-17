import { ProgramCoverField } from './program-cover-field';
import type { ProgramCoverSelection } from './program-cover-selection';
import { ProgramNoticeImport } from './program-notice-import';
import { ProgramOrganizerField } from './program-organizer-field';
import { ProgramTeamSizeField } from './program-team-size-field';
import { ProgramTrackTypeField } from './program-track-type-field';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { FormSection } from '@/components/form-section';
import type { EditableProgram } from './dto';
import type {
  ProgramEditableField,
  ProgramEditErrors,
  ProgramEditFieldValue,
  ProgramEditForm,
} from './program-edit-flow';
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
            currentOrganizers={form.organizers}
            applicationStartAt={form.applicationStartAt}
            applicationEndAt={form.applicationEndAt}
            operationStartAt={form.startAt}
            operationEndAt={form.endAt}
            teamMinSize={form.teamMinSize}
            teamMaxSize={form.teamMaxSize}
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
              if (patch.organizers !== undefined)
                onFieldChange('organizers', patch.organizers);
              if (patch.applicationStartAt !== undefined)
                onFieldChange('applicationStartAt', patch.applicationStartAt);
              if (patch.applicationEndAt !== undefined)
                onFieldChange('applicationEndAt', patch.applicationEndAt);
              if (patch.operationStartAt !== undefined)
                onFieldChange('startAt', patch.operationStartAt);
              if (patch.operationEndAt !== undefined)
                onFieldChange('endAt', patch.operationEndAt);
              if (patch.teamMinSize !== undefined)
                onFieldChange('teamMinSize', patch.teamMinSize);
              if (patch.teamMaxSize !== undefined)
                onFieldChange('teamMaxSize', patch.teamMaxSize);
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
            <ProgramTrackTypeField
              value={form.trackType}
              error={errors.trackType}
              onChange={(trackType) => onFieldChange('trackType', trackType)}
            />
            <ProgramTeamSizeField
              minSize={form.teamMinSize}
              maxSize={form.teamMaxSize}
              minError={errors.team}
              maxError={errors.team}
              onMinSizeChange={(value) => onFieldChange('teamMinSize', value)}
              onMaxSizeChange={(value) => onFieldChange('teamMaxSize', value)}
            />
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
