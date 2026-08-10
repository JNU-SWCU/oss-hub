import { FormSection } from '@/components/form-section';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import {
  messageFor,
  ProgramAuthoringDatePair,
  ProgramAuthoringTextField,
} from './program-authoring-fields';
import type {
  ProgramAuthoringAction,
  ProgramAuthoringState,
} from './program-authoring-model';
import type { ProgramAuthoringIssue } from './program-authoring-validation';

type ScheduleStepProps = {
  readonly state: ProgramAuthoringState;
  readonly issues: readonly ProgramAuthoringIssue[];
  readonly dispatch: (action: ProgramAuthoringAction) => void;
};

export function ProgramAuthoringScheduleStep({
  state,
  issues,
  dispatch,
}: ScheduleStepProps) {
  return (
    <FormSection
      title="신청/운영 일정"
      description="모든 시각은 Asia/Seoul 기준입니다. 신청 종료와 운영 시작은 같아도 됩니다."
    >
      <ProgramAuthoringDatePair
        legend="신청 일정"
        first={{
          id: 'application-start',
          label: '신청 시작 *',
          value: state.applicationStartAt,
          error: messageFor(issues, 'applicationStartAt'),
          onChange: (value) =>
            dispatch({
              type: 'set_program_field',
              field: 'applicationStartAt',
              value,
            }),
        }}
        second={{
          id: 'application-end',
          label: '신청 종료 *',
          value: state.applicationEndAt,
          min: state.applicationStartAt || undefined,
          error: messageFor(issues, 'applicationEndAt'),
          onChange: (value) =>
            dispatch({
              type: 'set_program_field',
              field: 'applicationEndAt',
              value,
            }),
        }}
      />
      <ProgramAuthoringDatePair
        legend="운영 일정"
        first={{
          id: 'operation-start',
          label: '운영 시작 *',
          value: state.operationStartAt,
          min: state.applicationEndAt || undefined,
          error: messageFor(issues, 'operationStartAt'),
          onChange: (value) =>
            dispatch({
              type: 'set_program_field',
              field: 'operationStartAt',
              value,
            }),
        }}
        second={{
          id: 'operation-end',
          label: '운영 종료 *',
          value: state.operationEndAt,
          min: state.operationStartAt || undefined,
          error: messageFor(issues, 'operationEndAt'),
          onChange: (value) =>
            dispatch({
              type: 'set_program_field',
              field: 'operationEndAt',
              value,
            }),
        }}
      />
      <Field>
        <FieldLabel>팀 인원 *</FieldLabel>
        <div className="grid gap-3 sm:grid-cols-2">
          <ProgramAuthoringTextField
            id="team-minimum"
            label="최소"
            type="number"
            min="1"
            max="100"
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
            min={state.teamMinSize || '1'}
            max="100"
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
        <FieldDescription>기본값은 1명부터 1명입니다.</FieldDescription>
      </Field>
    </FormSection>
  );
}
