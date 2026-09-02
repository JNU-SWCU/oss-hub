import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  messageFor,
  ProgramAuthoringTextField,
} from './program-authoring-fields';
import type { ProgramAuthoringAction } from './program-authoring-model';
import type { ProgramAuthoringIssue } from './program-authoring-validation';

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
