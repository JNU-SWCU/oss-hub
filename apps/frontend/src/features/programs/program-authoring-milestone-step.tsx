import { FilePlus2 } from 'lucide-react';
import { FormSection } from '@/components/form-section';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import type {
  ProgramAuthoringAction,
  ProgramAuthoringState,
} from './program-authoring-model';
import { ProgramAuthoringSubmissionItem } from './program-authoring-submission-item';
import type { ProgramAuthoringIssue } from './program-authoring-validation';
import { messageFor } from './program-authoring-detail-steps';

export function ProgramAuthoringMilestoneStep({
  state,
  issues,
  dispatch,
  newId,
  onRequirementFileChange,
  onRequirementRemove,
}: {
  readonly state: ProgramAuthoringState;
  readonly issues: readonly ProgramAuthoringIssue[];
  readonly dispatch: (action: ProgramAuthoringAction) => void;
  readonly newId: () => string;
  readonly onRemove: (milestoneId: string) => void;
  readonly onRequirementFileChange: (
    milestoneId: string,
    requirementId: string,
    file: File | null,
  ) => void;
  readonly onRequirementRemove: (
    milestoneId: string,
    requirementId: string,
  ) => void;
}) {
  return (
    <FormSection
      title="마일스톤 안내와 제출 항목"
      description="마일스톤 안내와 제출 항목을 정하세요. 학생은 각 항목에 내용, 파일, 또는 둘 다 제출할 수 있습니다. 날짜를 바꾸려면 신청/운영 일정 화면으로 이동하세요."
    >
      <FieldError>{messageFor(issues, 'milestones')}</FieldError>
      <div className="grid gap-4">
        {state.milestones.map((milestone, index) => (
          <Card key={milestone.id}>
            <CardHeader>
              <CardTitle>
                {index + 1}. {milestone.name || '이름 없는 마일스톤'}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5">
              <Field>
                <FieldLabel htmlFor={`${milestone.id}-instructions`}>
                  학생에게 보여줄 안내
                </FieldLabel>
                <textarea
                  id={`${milestone.id}-instructions`}
                  className="min-h-28 break-keep rounded-control border border-input bg-transparent p-4 text-pretty text-body outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  placeholder="준비할 내용과 제출 기한을 적어 주세요."
                  value={milestone.instructions}
                  onChange={(event) =>
                    dispatch({
                      type: 'set_milestone_field',
                      milestoneId: milestone.id,
                      field: 'instructions',
                      value: event.target.value,
                    })
                  }
                />
              </Field>
              <section
                className="grid gap-4 border-t border-border pt-5"
                aria-label={`${milestone.name || '이름 없는 마일스톤'} 제출 항목`}
              >
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="grid gap-1">
                    <h3 className="font-semibold">제출 항목</h3>
                    <p className="text-small text-muted-foreground">
                      학생이 무엇을 내야 하는지 알 수 있는 쉬운 이름을 적어
                      주세요.
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
                    제출 항목 추가
                  </Button>
                </div>
                {milestone.requirements.map((requirement, itemIndex) => (
                  <ProgramAuthoringSubmissionItem
                    key={requirement.id}
                    milestoneId={milestone.id}
                    itemIndex={itemIndex}
                    requirement={requirement}
                    issues={issues}
                    dispatch={dispatch}
                    canRemove={milestone.requirements.length > 1}
                    onFileChange={onRequirementFileChange}
                    onRemove={onRequirementRemove}
                  />
                ))}
              </section>
            </CardContent>
          </Card>
        ))}
      </div>
    </FormSection>
  );
}
