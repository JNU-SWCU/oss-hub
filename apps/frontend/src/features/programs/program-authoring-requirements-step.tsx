import { FilePlus2, Info } from 'lucide-react';
import { FormSection } from '@/components/form-section';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  ProgramAuthoringAction,
  ProgramAuthoringState,
} from './program-authoring-model';
import { ProgramRequirementEditor } from './program-requirement-editor';
import type { ProgramAuthoringIssue } from './program-authoring-validation';
import { validateTemplateFile } from './program-authoring-validation';
import { messageFor } from './program-authoring-detail-steps';

export function ProgramAuthoringRequirementsStep({
  state,
  issues,
  dispatch,
  newId,
  onFileChange,
  onRemove,
}: {
  readonly state: ProgramAuthoringState;
  readonly issues: readonly ProgramAuthoringIssue[];
  readonly dispatch: (action: ProgramAuthoringAction) => void;
  readonly newId: () => string;
  readonly onFileChange: (
    milestoneId: string,
    requirementId: string,
    file: File | null,
  ) => void;
  readonly onRemove: (milestoneId: string, requirementId: string) => void;
}) {
  return (
    <FormSection
      title="요구서류/양식"
      description="마일스톤마다 받을 항목을 정하세요. 항목이 없는 마일스톤은 안내용으로 유지됩니다."
    >
      {state.milestones.map((milestone) => (
        <Card
          key={milestone.id}
          aria-label={`${milestone.name || '이름 없는 마일스톤'} 요구서류`}
        >
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div className="grid gap-1">
              <CardTitle>{milestone.name || '이름 없는 마일스톤'}</CardTitle>
              <p className="text-small text-muted-foreground">
                요구서류 {milestone.requirements.length}개
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={milestone.requirements.length >= 20}
              onClick={() =>
                dispatch({
                  type: 'add_requirement',
                  milestoneId: milestone.id,
                  requirementId: newId(),
                })
              }
            >
              <FilePlus2 aria-hidden="true" />
              항목 추가
            </Button>
          </CardHeader>
          <CardContent className="grid gap-4">
            {milestone.requirements.length === 0 ? (
              <Alert>
                <Info aria-hidden="true" />
                <AlertTitle>안내용 마일스톤</AlertTitle>
                <AlertDescription>
                  받을 항목이 없어도 생성할 수 있습니다.
                </AlertDescription>
              </Alert>
            ) : null}
            {milestone.requirements.map((requirement, index) => {
              const prefix = `requirements.${requirement.id}`;
              return (
                <section
                  key={requirement.id}
                  className="grid gap-4 rounded-card border border-border p-card"
                  aria-label={`${milestone.name || '마일스톤'} 요구서류 ${index + 1}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold">요구서류 {index + 1}</h3>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => onRemove(milestone.id, requirement.id)}
                    >
                      삭제
                    </Button>
                  </div>
                  <ProgramRequirementEditor
                    idPrefix={`authoring-${requirement.id}`}
                    value={requirement}
                    templateFile={requirement.templateFile}
                    errors={{
                      name: messageFor(issues, `${prefix}.name`),
                      templateFile: messageFor(
                        issues,
                        `${prefix}.templateFile`,
                      ),
                    }}
                    onNameChange={(name) =>
                      dispatch({
                        type: 'set_requirement_name',
                        milestoneId: milestone.id,
                        requirementId: requirement.id,
                        name,
                      })
                    }
                    onRequiredChange={(required) =>
                      dispatch({
                        type: 'set_requirement_required',
                        milestoneId: milestone.id,
                        requirementId: requirement.id,
                        required,
                      })
                    }
                    onTypeChange={(submissionType) => {
                      if (submissionType === 'TEXT') {
                        onFileChange(milestone.id, requirement.id, null);
                      }
                      dispatch({
                        type: 'set_requirement_type',
                        milestoneId: milestone.id,
                        requirementId: requirement.id,
                        submissionType,
                      });
                    }}
                    onTemplateFile={(file) => {
                      onFileChange(milestone.id, requirement.id, file);
                    }}
                    validateFile={validateTemplateFile}
                  />
                </section>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </FormSection>
  );
}
