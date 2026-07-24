import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  type ProgramMilestoneEditor,
  type ProgramMilestoneField,
} from './program-edit-flow';
import type { SubmissionType } from './types';

const SUBMISSION_TYPES = [
  'FILE',
  'TEXT',
  'REPOSITORY_RELEASE',
] as const satisfies readonly SubmissionType[];

interface ProgramEditMilestoneFormProps {
  readonly editor: Exclude<ProgramMilestoneEditor, { readonly mode: 'closed' }>;
  readonly isBusy: boolean;
  readonly onCancel: () => void;
  readonly onFieldChange: (field: ProgramMilestoneField, value: string) => void;
  readonly onSave: (event: React.FormEvent<HTMLFormElement>) => void;
}

export function ProgramEditMilestoneForm({
  editor,
  isBusy,
  onCancel,
  onFieldChange,
  onSave,
}: ProgramEditMilestoneFormProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {editor.mode === 'create' ? '마일스톤 추가' : '마일스톤 수정'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={onSave}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="milestone-name">마일스톤명 *</FieldLabel>
              <Input
                id="milestone-name"
                value={editor.form.name}
                onChange={(event) => onFieldChange('name', event.target.value)}
              />
              <FieldError>{editor.errors.name}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="milestone-due-at">마감일 *</FieldLabel>
              <Input
                id="milestone-due-at"
                type="datetime-local"
                value={editor.form.dueAt}
                onChange={(event) => onFieldChange('dueAt', event.target.value)}
              />
              <FieldError>{editor.errors.dueAt}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="milestone-submission-type">
                제출 방식
              </FieldLabel>
              <select
                id="milestone-submission-type"
                className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                value={editor.form.submissionType}
                onChange={(event) =>
                  onFieldChange(
                    'submissionType',
                    toSubmissionType(event.target.value),
                  )
                }
              >
                {SUBMISSION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="milestone-instructions">
                제출 안내
              </FieldLabel>
              <textarea
                id="milestone-instructions"
                value={editor.form.instructions}
                onChange={(event) =>
                  onFieldChange('instructions', event.target.value)
                }
                className="min-h-28 rounded-lg border border-input bg-transparent p-3 text-sm"
              />
              <FieldError>{editor.errors.instructions}</FieldError>
            </Field>
            <FieldError>{editor.errors.general}</FieldError>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={isBusy}
              >
                취소
              </Button>
              <Button type="submit" disabled={isBusy}>
                {isBusy ? '저장 중…' : '저장'}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}

function toSubmissionType(value: string): SubmissionType {
  switch (value) {
    case 'FILE':
      return 'FILE';
    case 'TEXT':
      return 'TEXT';
    case 'REPOSITORY_RELEASE':
      return 'REPOSITORY_RELEASE';
    default:
      return DEFAULT_SUBMISSION_TYPE;
  }
}

const DEFAULT_SUBMISSION_TYPE = 'TEXT' satisfies SubmissionType;
