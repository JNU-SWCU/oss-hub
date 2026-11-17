import { ProgramCoverField } from './program-cover-field';
import { ProgramNoticeImport } from './program-notice-import';
import { ProgramOrganizerField } from './program-organizer-field';
import { ProgramTeamSizeField } from './program-team-size-field';
import { ProgramTrackTypeField } from './program-track-type-field';
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

type StepProps = {
  readonly state: ProgramAuthoringState;
  readonly issues: readonly ProgramAuthoringIssue[];
  readonly dispatch: (action: ProgramAuthoringAction) => void;
};

export function ProgramAuthoringBasicStep({
  state,
  issues,
  dispatch,
}: StepProps) {
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
        onChange={(file) => dispatch({ type: 'set_cover_file', file })}
      />
      <ProgramOrganizerField
        id="authoring-organizers"
        value={state.organizers}
        error={messageFor(issues, 'organizers')}
        onChange={(organizers) =>
          dispatch({ type: 'set_organizers', organizers })
        }
      />
      <div className="flex flex-wrap gap-x-12 gap-y-5">
        <ProgramTrackTypeField
          value={state.trackType}
          error={messageFor(issues, 'trackType')}
          onChange={(trackType) =>
            dispatch({ type: 'set_track_type', trackType })
          }
        />
        <ProgramTeamSizeField
          minSize={state.teamMinSize}
          maxSize={state.teamMaxSize}
          minError={messageFor(issues, 'teamMinSize')}
          maxError={messageFor(issues, 'teamMaxSize')}
          onMinSizeChange={(value) =>
            dispatch({
              type: 'set_program_field',
              field: 'teamMinSize',
              value,
            })
          }
          onMaxSizeChange={(value) =>
            dispatch({
              type: 'set_program_field',
              field: 'teamMaxSize',
              value,
            })
          }
        />
      </div>
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
