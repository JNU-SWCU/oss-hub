import { CalendarClock, FileUp, TextCursorInput } from 'lucide-react';
import { FormSection } from '@/components/form-section';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type {
  ProgramAuthoringAction,
  ProgramAuthoringState,
} from './program-authoring-model';
import type { ProgramAuthoringIssue } from './program-authoring-validation';
import { messageFor } from './program-authoring-detail-steps';

export function ProgramAuthoringMilestoneStep({
  state,
  issues,
  dispatch,
  newId,
  onRemove,
}: {
  readonly state: ProgramAuthoringState;
  readonly issues: readonly ProgramAuthoringIssue[];
  readonly dispatch: (action: ProgramAuthoringAction) => void;
  readonly newId: () => string;
  readonly onRemove: (milestoneId: string) => void;
}) {
  return (
    <FormSection
      title="마일스톤"
      description="운영 기간 안에서 하나 이상 등록하세요. 기간이 서로 겹쳐도 됩니다."
    >
      <FieldError>{messageFor(issues, 'milestones')}</FieldError>
      <div className="grid gap-4">
        {state.milestones.map((milestone, index) => {
          const prefix = `milestones.${milestone.id}`;
          return (
            <Card key={milestone.id}>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <CardTitle>마일스톤 {index + 1}</CardTitle>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => onRemove(milestone.id)}
                >
                  삭제
                </Button>
              </CardHeader>
              <CardContent className="grid gap-5">
                <Field>
                  <FieldLabel htmlFor={`${milestone.id}-name`}>
                    마일스톤명 *
                  </FieldLabel>
                  <Input
                    id={`${milestone.id}-name`}
                    value={milestone.name}
                    aria-invalid={Boolean(messageFor(issues, `${prefix}.name`))}
                    onChange={(event) =>
                      dispatch({
                        type: 'set_milestone_field',
                        milestoneId: milestone.id,
                        field: 'name',
                        value: event.target.value,
                      })
                    }
                  />
                  <FieldError>
                    {messageFor(issues, `${prefix}.name`)}
                  </FieldError>
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor={`${milestone.id}-start`}>
                      시작 *
                    </FieldLabel>
                    <Input
                      id={`${milestone.id}-start`}
                      type="datetime-local"
                      min={state.operationStartAt || undefined}
                      value={milestone.startAt}
                      aria-invalid={Boolean(
                        messageFor(issues, `${prefix}.startAt`),
                      )}
                      onChange={(event) =>
                        dispatch({
                          type: 'set_milestone_field',
                          milestoneId: milestone.id,
                          field: 'startAt',
                          value: event.target.value,
                        })
                      }
                    />
                    <FieldError>
                      {messageFor(issues, `${prefix}.startAt`)}
                    </FieldError>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${milestone.id}-due`}>
                      마감 *
                    </FieldLabel>
                    <Input
                      id={`${milestone.id}-due`}
                      type="datetime-local"
                      min={
                        milestone.startAt || state.operationStartAt || undefined
                      }
                      max={state.operationEndAt || undefined}
                      value={milestone.dueAt}
                      aria-invalid={Boolean(
                        messageFor(issues, `${prefix}.dueAt`),
                      )}
                      onChange={(event) =>
                        dispatch({
                          type: 'set_milestone_field',
                          milestoneId: milestone.id,
                          field: 'dueAt',
                          value: event.target.value,
                        })
                      }
                    />
                    <FieldError>
                      {messageFor(issues, `${prefix}.dueAt`)}
                    </FieldError>
                  </Field>
                </div>
                <Field>
                  <FieldLabel>기본 제출 방식</FieldLabel>
                  <div className="grid gap-3 sm:grid-cols-2" role="radiogroup">
                    <TypeChoice
                      checked={milestone.submissionType === 'FILE'}
                      icon={<FileUp aria-hidden="true" />}
                      label="파일 중심"
                      name={`${milestone.id}-type`}
                      onChange={() =>
                        dispatch({
                          type: 'set_milestone_type',
                          milestoneId: milestone.id,
                          submissionType: 'FILE',
                        })
                      }
                    />
                    <TypeChoice
                      checked={milestone.submissionType === 'TEXT'}
                      icon={<TextCursorInput aria-hidden="true" />}
                      label="텍스트 중심"
                      name={`${milestone.id}-type`}
                      onChange={() =>
                        dispatch({
                          type: 'set_milestone_type',
                          milestoneId: milestone.id,
                          submissionType: 'TEXT',
                        })
                      }
                    />
                  </div>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${milestone.id}-instructions`}>
                    제출 안내
                  </FieldLabel>
                  <textarea
                    id={`${milestone.id}-instructions`}
                    className="min-h-28 rounded-control border border-input bg-transparent p-4 text-body outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Button
        type="button"
        variant="outline"
        className="justify-self-start"
        disabled={state.milestones.length >= 50}
        onClick={() =>
          dispatch({ type: 'add_milestone', milestoneId: newId() })
        }
      >
        <CalendarClock aria-hidden="true" />
        마일스톤 추가
      </Button>
    </FormSection>
  );
}

function TypeChoice({
  checked,
  icon,
  label,
  name,
  onChange,
}: {
  readonly checked: boolean;
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly name: string;
  readonly onChange: () => void;
}) {
  return (
    <label className="flex min-h-control cursor-pointer items-center gap-3 rounded-card border border-border p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50">
      <input
        className="sr-only"
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
      />
      <span className="text-primary">{icon}</span>
      <span className="font-semibold">{label}</span>
    </label>
  );
}
