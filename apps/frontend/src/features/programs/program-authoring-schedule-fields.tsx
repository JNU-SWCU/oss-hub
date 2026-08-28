import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import {
  messageFor,
  ProgramAuthoringTextField,
} from './program-authoring-fields';
import type {
  ProgramAuthoringAction,
  ProgramAuthoringState,
} from './program-authoring-model';
import type { ProgramAuthoringIssue } from './program-authoring-validation';

export function ProgramAuthoringTeamSizeFields({
  state,
  issues,
  dispatch,
}: {
  readonly state: ProgramAuthoringState;
  readonly issues: readonly ProgramAuthoringIssue[];
  readonly dispatch: (action: ProgramAuthoringAction) => void;
}) {
  return (
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
  );
}

export function ProgramAuthoringMilestoneDetails({
  milestoneId,
  name,
  index,
  issues,
  dispatch,
  canRemove,
  onRemove,
}: {
  readonly milestoneId: string;
  readonly name: string;
  readonly index: number;
  readonly issues: readonly ProgramAuthoringIssue[];
  readonly dispatch: (action: ProgramAuthoringAction) => void;
  readonly canRemove: boolean;
  readonly onRemove: (milestoneId: string) => void;
}) {
  return (
    <section className="grid gap-3 rounded-card border border-border bg-background p-4">
      <ProgramAuthoringTextField
        id={`${milestoneId}-name`}
        label={`마일스톤 ${index + 1} 이름 *`}
        value={name}
        error={messageFor(issues, `milestones.${milestoneId}.name`)}
        onChange={(value) =>
          dispatch({
            type: 'set_milestone_field',
            milestoneId,
            field: 'name',
            value,
          })
        }
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="justify-self-end"
        disabled={!canRemove}
        title={canRemove ? undefined : '마일스톤은 최소 1개가 필요합니다.'}
        onClick={() => onRemove(milestoneId)}
      >
        <Trash2 aria-hidden="true" />
        마일스톤 삭제
      </Button>
    </section>
  );
}
