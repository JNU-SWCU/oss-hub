import { ProgramCoverField } from './program-cover-field';
import { ProgramNoticeImport } from './program-notice-import';
import { FormSection } from '@/components/form-section';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import {
  messageFor,
  ProgramAuthoringTextField,
} from './program-authoring-fields';
import type {
  ProgramAuthoringAction,
  ProgramAuthoringState,
} from './program-authoring-model';
import type { ProgramAuthoringIssue } from './program-authoring-validation';
import {
  PROGRAM_TRACK_TYPE_LABELS,
  PROGRAM_TRACK_TYPES,
} from './program-templates';

type StepProps = {
  readonly state: ProgramAuthoringState;
  readonly issues: readonly ProgramAuthoringIssue[];
  readonly dispatch: (action: ProgramAuthoringAction) => void;
};

export function ProgramAuthoringBasicStep({
  state,
  issues,
  dispatch,
  onCoverErrorChange,
}: StepProps & {
  readonly onCoverErrorChange?: (message: string | null) => void;
}) {
  return (
    <FormSection
      aria-labelledby="authoring-basic-title"
      className="[&>legend]:w-full"
      title={
        <span className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <span id="authoring-basic-title">기본 정보</span>
          <ProgramNoticeImport
            currentName={state.name}
            currentDescription={state.description}
            hasCover={Boolean(state.coverFile || state.externalCover)}
            sourceUrl={state.externalCover?.sourceUrl}
            onApply={(patch) => dispatch({ type: 'apply_notice', patch })}
          />
        </span>
      }
      description="프로그램 목록과 상세 화면에 표시할 정보를 입력하세요."
    >
      <ProgramAuthoringTextField
        id="program-name"
        label="프로그램명 *"
        value={state.name}
        error={messageFor(issues, 'name')}
        onChange={(value) =>
          dispatch({ type: 'set_program_field', field: 'name', value })
        }
      />
      <ProgramCoverField
        selection={state.externalCover ?? state.coverFile ?? null}
        onChange={(file) =>
          dispatch({ type: 'set_cover_file', file: file ?? null })
        }
        onLocalErrorChange={onCoverErrorChange}
      />
      <ProgramAuthoringTextField
        id="authoring-organizer"
        label="주관기관/학과 *"
        value={state.organizer}
        error={messageFor(issues, 'organizer')}
        onChange={(value) =>
          dispatch({ type: 'set_program_field', field: 'organizer', value })
        }
      />
      <Field>
        <FieldLabel htmlFor="program-track-type">교과/비교과 *</FieldLabel>
        <select
          id="program-track-type"
          className="h-control rounded-control border border-input bg-background px-4 text-body"
          value={state.trackType}
          aria-invalid={Boolean(messageFor(issues, 'trackType'))}
          aria-describedby={
            messageFor(issues, 'trackType')
              ? 'program-track-type-error'
              : undefined
          }
          onChange={(event) =>
            dispatch({
              type: 'set_track_type',
              trackType: event.target
                .value as (typeof PROGRAM_TRACK_TYPES)[number],
            })
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
          {messageFor(issues, 'trackType')}
        </FieldError>
      </Field>
      <Field>
        <FieldLabel>참여 인원 / 팀 규모 *</FieldLabel>
        <div className="grid gap-3 sm:grid-cols-2">
          <ProgramAuthoringTextField
            id="team-minimum"
            label="최소"
            type="number"
            value={state.teamMinSize}
            error={messageFor(issues, 'teamMinSize')}
            onChange={(value) =>
              dispatch({
                type: 'set_program_field',
                field: 'teamMinSize',
                value,
              })
            }
          />
          <ProgramAuthoringTextField
            id="team-maximum"
            label="최대"
            type="number"
            value={state.teamMaxSize}
            error={messageFor(issues, 'teamMaxSize')}
            onChange={(value) =>
              dispatch({
                type: 'set_program_field',
                field: 'teamMaxSize',
                value,
              })
            }
          />
        </div>
      </Field>
      <Field>
        <FieldLabel htmlFor="program-description">소개/설명 *</FieldLabel>
        <textarea
          id="program-description"
          value={state.description}
          aria-invalid={Boolean(messageFor(issues, 'description'))}
          aria-describedby={
            messageFor(issues, 'description')
              ? 'program-description-error'
              : undefined
          }
          onChange={(event) =>
            dispatch({
              type: 'set_program_field',
              field: 'description',
              value: event.target.value,
            })
          }
          className="min-h-32 rounded-control border border-input bg-transparent p-4 text-body"
        />
        <FieldError id="program-description-error" role="alert">
          {messageFor(issues, 'description')}
        </FieldError>
      </Field>
    </FormSection>
  );
}
