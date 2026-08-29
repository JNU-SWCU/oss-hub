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
import type { ProgramScheduleCalendarEvent } from './program-schedule-calendar-model';
import { ProgramEditMilestoneScheduleEditor } from './program-edit-milestone-schedule-editor';

interface ProgramEditMilestoneFormProps {
  readonly editor: Exclude<ProgramMilestoneEditor, { readonly mode: 'closed' }>;
  readonly operationStartAt: string;
  readonly operationEndAt: string;
  readonly contextEvents: readonly ProgramScheduleCalendarEvent[];
  readonly isBusy: boolean;
  readonly onCancel: () => void;
  readonly onFieldChange: (field: ProgramMilestoneField, value: string) => void;
  readonly onSave: (event: React.FormEvent<HTMLFormElement>) => void;
}

export function ProgramEditMilestoneForm({
  editor,
  operationStartAt,
  operationEndAt,
  contextEvents,
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
                aria-invalid={Boolean(editor.errors.name)}
                aria-describedby={
                  editor.errors.name ? 'milestone-name-error' : undefined
                }
                onChange={(event) => onFieldChange('name', event.target.value)}
              />
              <FieldError id="milestone-name-error" role="alert">
                {editor.errors.name}
              </FieldError>
            </Field>
            <ProgramEditMilestoneScheduleEditor
              editor={editor}
              operationStartAt={operationStartAt}
              operationEndAt={operationEndAt}
              contextEvents={contextEvents}
              onFieldChange={onFieldChange}
            />
            <Field>
              <FieldLabel htmlFor="milestone-instructions">
                제출 안내
              </FieldLabel>
              <textarea
                id="milestone-instructions"
                value={editor.form.instructions}
                aria-invalid={Boolean(editor.errors.instructions)}
                aria-describedby={
                  editor.errors.instructions
                    ? 'milestone-instructions-error'
                    : undefined
                }
                onChange={(event) =>
                  onFieldChange('instructions', event.target.value)
                }
                className="min-h-28 rounded-control border border-input bg-transparent p-4 text-body"
              />
              <FieldError id="milestone-instructions-error" role="alert">
                {editor.errors.instructions}
              </FieldError>
            </Field>
            <FieldError role="alert">{editor.errors.general}</FieldError>
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
