import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type {
  ProgramAuthoringAction,
  ProgramAuthoringRequirement,
} from './program-authoring-model';
import { ProgramRequirementEditor } from './program-requirement-editor';
import type { ProgramAuthoringIssue } from './program-authoring-validation';
import { validateTemplateFile } from './program-authoring-validation';
import { messageFor } from './program-authoring-detail-steps';

export function ProgramAuthoringSubmissionItem({
  milestoneId,
  itemIndex,
  requirement,
  issues,
  dispatch,
  onFileChange,
  onRemove,
  canRemove,
}: {
  readonly milestoneId: string;
  readonly itemIndex: number;
  readonly requirement: ProgramAuthoringRequirement;
  readonly issues: readonly ProgramAuthoringIssue[];
  readonly dispatch: (action: ProgramAuthoringAction) => void;
  readonly onFileChange: (
    milestoneId: string,
    requirementId: string,
    file: File | null,
  ) => void;
  readonly onRemove: (milestoneId: string, requirementId: string) => void;
  readonly canRemove: boolean;
}) {
  const prefix = `requirements.${requirement.id}`;
  return (
    <div className="grid gap-4 rounded-card border border-border p-card">
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-semibold">제출 항목 {itemIndex + 1}</h4>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!canRemove}
          onClick={() => onRemove(milestoneId, requirement.id)}
        >
          <Trash2 aria-hidden="true" />
          삭제
        </Button>
      </div>
      <ProgramRequirementEditor
        idPrefix={`authoring-${requirement.id}`}
        value={requirement}
        templateFile={requirement.templateFile}
        errors={{
          name: messageFor(issues, `${prefix}.name`),
          templateFile: messageFor(issues, `${prefix}.templateFile`),
        }}
        onNameChange={(name) =>
          dispatch({
            type: 'set_requirement_name',
            milestoneId,
            requirementId: requirement.id,
            name,
          })
        }
        onRequiredChange={(required) =>
          dispatch({
            type: 'set_requirement_required',
            milestoneId,
            requirementId: requirement.id,
            required,
          })
        }
        onTemplateFile={(file) =>
          onFileChange(milestoneId, requirement.id, file)
        }
        validateFile={validateTemplateFile}
      />
    </div>
  );
}
