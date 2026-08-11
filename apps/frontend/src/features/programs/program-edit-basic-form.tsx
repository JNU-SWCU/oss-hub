import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { FormSection } from '@/components/form-section';
import type { EditableProgram } from './api';
import { programHref } from './program-paths';
import {
  type ProgramEditableField,
  type ProgramEditErrors,
  type ProgramEditForm,
} from './program-edit-flow';
import { PROGRAM_TEMPLATE_DEFINITIONS } from './program-templates';
import { ProgramDeadlineControl } from './program-deadline-control';

interface ProgramEditBasicFormProps {
  readonly program: EditableProgram;
  readonly form: ProgramEditForm;
  readonly errors: ProgramEditErrors;
  readonly isSaving: boolean;
  readonly onFieldChange: (
    field: ProgramEditableField,
    value: string | boolean,
  ) => void;
  readonly onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}

export function ProgramEditBasicForm({
  program,
  form,
  errors,
  isSaving,
  onFieldChange,
  onSubmit,
}: ProgramEditBasicFormProps) {
  const templateLockReason = categoryLockReason(program);
  const selectedTemplate = PROGRAM_TEMPLATE_DEFINITIONS.find(
    (definition) => definition.category === form.category,
  );
  const requiresTeam = selectedTemplate?.template.participation === 'team';

  return (
    <FormSection title="기본 정보">
      <form className="grid gap-5" onSubmit={onSubmit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="program-name">프로그램명 *</FieldLabel>
            <Input
              id="program-name"
              value={form.name}
              aria-invalid={Boolean(errors.name)}
              onChange={(event) => onFieldChange('name', event.target.value)}
            />
            <FieldError>{errors.name}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="program-organizer">주관기관 *</FieldLabel>
            <Input
              id="program-organizer"
              value={form.organizer}
              aria-invalid={Boolean(errors.organizer)}
              onChange={(event) =>
                onFieldChange('organizer', event.target.value)
              }
            />
            <FieldError>{errors.organizer}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="program-category">유형</FieldLabel>
            <select
              id="program-category"
              className="h-control rounded-control border border-input bg-background px-4 text-body disabled:opacity-60"
              value={form.category}
              disabled={templateLockReason !== null}
              aria-invalid={Boolean(errors.category)}
              onChange={(event) =>
                onFieldChange('category', event.target.value)
              }
            >
              {PROGRAM_TEMPLATE_DEFINITIONS.map((item) => (
                <option key={item.category} value={item.category}>
                  {item.label}
                </option>
              ))}
            </select>
            {templateLockReason ? (
              <p className="text-small text-muted-foreground">
                {templateLockReason}
              </p>
            ) : null}
            <FieldError>{errors.category}</FieldError>
          </Field>
          <Field>
            <FieldLabel>신청 기간 *</FieldLabel>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-2">
                <FieldLabel
                  className="text-small"
                  htmlFor="program-application-start-at"
                >
                  시작일시
                </FieldLabel>
                <Input
                  id="program-application-start-at"
                  type="datetime-local"
                  value={form.applicationStartAt}
                  aria-invalid={Boolean(errors.period)}
                  onChange={(event) =>
                    onFieldChange('applicationStartAt', event.target.value)
                  }
                />
              </div>
              <div className="space-y-2">
                <FieldLabel
                  className="text-small"
                  htmlFor="program-application-end-at"
                >
                  마감일시
                </FieldLabel>
                <Input
                  id="program-application-end-at"
                  type="datetime-local"
                  value={form.applicationEndAt}
                  aria-invalid={Boolean(errors.period)}
                  onChange={(event) =>
                    onFieldChange('applicationEndAt', event.target.value)
                  }
                />
              </div>
            </div>
            <FieldError>{errors.period}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="program-end-at">프로그램 종료 *</FieldLabel>
            <Input
              id="program-end-at"
              type="datetime-local"
              value={form.endAt}
              disabled={form.endAtUndecided}
              required={!form.endAtUndecided && form.originalEndAt !== null}
              aria-invalid={Boolean(errors.endAt)}
              onChange={(event) => onFieldChange('endAt', event.target.value)}
            />
            <Field orientation="horizontal">
              <input
                id="program-end-at-undecided"
                type="checkbox"
                checked={form.endAtUndecided}
                onChange={(event) =>
                  onFieldChange('endAtUndecided', event.target.checked)
                }
              />
              <FieldLabel htmlFor="program-end-at-undecided">
                종료일 미정
              </FieldLabel>
            </Field>
            <FieldDescription>
              종료일을 아직 정하지 않았으면 「종료일 미정」을 선택하세요.
              프로그램은 끝나지 않은 것으로 다뤄집니다. 나중에 정하려면 체크를
              풀고 날짜를 고르면 됩니다.
            </FieldDescription>
            <FieldError>{errors.endAt}</FieldError>
          </Field>
          {requiresTeam ? (
            <Field>
              <FieldLabel>팀 인원 *</FieldLabel>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-2">
                  <FieldLabel
                    className="text-small"
                    htmlFor="program-team-min-size"
                  >
                    최소
                  </FieldLabel>
                  <Input
                    id="program-team-min-size"
                    type="number"
                    min="1"
                    value={form.teamMinSize}
                    aria-invalid={Boolean(errors.team)}
                    onChange={(event) =>
                      onFieldChange('teamMinSize', event.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <FieldLabel
                    className="text-small"
                    htmlFor="program-team-max-size"
                  >
                    최대
                  </FieldLabel>
                  <Input
                    id="program-team-max-size"
                    type="number"
                    min="1"
                    value={form.teamMaxSize}
                    aria-invalid={Boolean(errors.team)}
                    onChange={(event) =>
                      onFieldChange('teamMaxSize', event.target.value)
                    }
                  />
                </div>
              </div>
              <FieldError>{errors.team}</FieldError>
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="program-description">소개/설명 *</FieldLabel>
            <textarea
              id="program-description"
              value={form.description}
              aria-invalid={Boolean(errors.description)}
              onChange={(event) =>
                onFieldChange('description', event.target.value)
              }
              className="min-h-32 rounded-control border border-input bg-transparent p-4 text-body"
            />
            <FieldError>{errors.description}</FieldError>
          </Field>
          <Field orientation="horizontal">
            <input
              id="repository-provisioning"
              type="checkbox"
              checked={form.repositoryProvisioningEnabled}
              onChange={(event) =>
                onFieldChange(
                  'repositoryProvisioningEnabled',
                  event.target.checked,
                )
              }
            />
            <FieldLabel htmlFor="repository-provisioning">
              신청 승인 시 GitHub 저장소 자동 생성
            </FieldLabel>
          </Field>
          <ProgramDeadlineControl
            enabled={form.notifyOnDeadline}
            persistedEnabled={program.notifyOnDeadline}
            programId={program.id}
            onEnabledChange={(enabled) =>
              onFieldChange('notifyOnDeadline', enabled)
            }
          />
          <FieldError>{errors.general}</FieldError>
          <div className="flex justify-between gap-2">
            <Button asChild type="button" variant="outline">
              <Link href={programHref(program.id)}>취소</Link>
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? '저장 중…' : '저장'}
            </Button>
          </div>
        </FieldGroup>
      </form>
    </FormSection>
  );
}

function categoryLockReason(program: EditableProgram): string | null {
  return program.categoryLocked.locked
    ? categoryLockedMessage(program.categoryLocked)
    : null;
}

function categoryLockedMessage(
  lock: EditableProgram['categoryLocked'],
): string {
  if (lock.byApplications && lock.byTeams) {
    return `신청자가 ${lock.applicationCount}명, 팀이 ${lock.teamCount}개 있어 유형을 변경할 수 없습니다.`;
  }
  if (lock.byTeams) {
    return `팀이 ${lock.teamCount}개 있어 유형을 변경할 수 없습니다.`;
  }
  if (lock.byApplications) {
    return `신청자가 ${lock.applicationCount}명 있어 유형을 변경할 수 없습니다.`;
  }
  return '신청 또는 팀이 있어 유형을 변경할 수 없습니다.';
}
