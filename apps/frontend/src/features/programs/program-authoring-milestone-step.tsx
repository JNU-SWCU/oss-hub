import {
  CalendarClock,
  FilePlus2,
  FileUp,
  Info,
  TextCursorInput,
} from 'lucide-react';
import { FormSection } from '@/components/form-section';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type {
  ProgramAuthoringAction,
  ProgramAuthoringState,
} from './program-authoring-model';
import { ProgramRequirementEditor } from './program-requirement-editor';
import type { ProgramAuthoringIssue } from './program-authoring-validation';
import { validateTemplateFile } from './program-authoring-validation';
import { messageFor } from './program-authoring-detail-steps';

export function ProgramAuthoringMilestoneStep({
  state,
  issues,
  dispatch,
  newId,
  onRemove,
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
      title="마일스톤"
      description="운영 기간 안에서 하나 이상 등록하세요. 기간이 서로 겹쳐도 됩니다."
    >
      <FieldError>{messageFor(issues, 'milestones')}</FieldError>
      <div className="grid gap-4">
        {state.milestones.map((milestone, index) => {
          const prefix = `milestones.${milestone.id}`;
          const isOnlyMilestone = state.milestones.length <= 1;
          return (
            <Card key={milestone.id}>
              <CardHeader>
                <CardTitle>마일스톤 {index + 1}</CardTitle>
                <CardAction>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={isOnlyMilestone}
                    title={
                      isOnlyMilestone
                        ? '마일스톤은 최소 1개가 필요합니다.'
                        : undefined
                    }
                    onClick={() => onRemove(milestone.id)}
                  >
                    삭제
                  </Button>
                </CardAction>
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
                <section
                  className="grid gap-4 border-t border-border pt-5"
                  aria-label={`${milestone.name || '이름 없는 마일스톤'} 요구서류`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="grid gap-1">
                      <h3 className="font-semibold">요구서류/양식</h3>
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
                  </div>
                  {milestone.requirements.length === 0 ? (
                    <Alert>
                      <Info aria-hidden="true" />
                      <AlertTitle>안내용 마일스톤</AlertTitle>
                      <AlertDescription>
                        받을 항목이 없어도 생성할 수 있습니다.
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  {milestone.requirements.map(
                    (requirement, requirementIndex) => {
                      const requirementPrefix = `requirements.${requirement.id}`;
                      return (
                        <div
                          key={requirement.id}
                          className="grid gap-4 rounded-card border border-border p-card"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <h4 className="font-semibold">
                              요구서류 {requirementIndex + 1}
                            </h4>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              onClick={() =>
                                onRequirementRemove(
                                  milestone.id,
                                  requirement.id,
                                )
                              }
                            >
                              삭제
                            </Button>
                          </div>
                          <ProgramRequirementEditor
                            idPrefix={`authoring-${requirement.id}`}
                            value={requirement}
                            templateFile={requirement.templateFile}
                            errors={{
                              name: messageFor(
                                issues,
                                `${requirementPrefix}.name`,
                              ),
                              templateFile: messageFor(
                                issues,
                                `${requirementPrefix}.templateFile`,
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
                                onRequirementFileChange(
                                  milestone.id,
                                  requirement.id,
                                  null,
                                );
                              }
                              dispatch({
                                type: 'set_requirement_type',
                                milestoneId: milestone.id,
                                requirementId: requirement.id,
                                submissionType,
                              });
                            }}
                            onTemplateFile={(file) => {
                              onRequirementFileChange(
                                milestone.id,
                                requirement.id,
                                file,
                              );
                            }}
                            validateFile={validateTemplateFile}
                          />
                        </div>
                      );
                    },
                  )}
                </section>
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
