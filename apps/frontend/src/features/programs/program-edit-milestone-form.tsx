import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldGroup } from '@/components/ui/field';
import {
  type ProgramMilestoneEditor,
  type ProgramMilestoneField,
} from './program-edit-flow';
import type { ProgramScheduleCalendarEvent } from './program-schedule-calendar-model';
import { ProgramEditMilestoneScheduleEditor } from './program-edit-milestone-schedule-editor';
import { ProgramMilestoneFields } from './program-milestone-fields';

interface ProgramEditMilestoneFormProps {
  readonly editor: Exclude<ProgramMilestoneEditor, { readonly mode: 'closed' }>;
  readonly operationStartAt: string;
  readonly operationEndAt: string;
  readonly contextEvents: readonly ProgramScheduleCalendarEvent[];
  readonly isBusy: boolean;
  readonly isSaveDisabled?: boolean;
  readonly layout?: 'card' | 'dialog';
  readonly children?: React.ReactNode;
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
  isSaveDisabled = false,
  layout = 'card',
  children,
  onCancel,
  onFieldChange,
  onSave,
}: ProgramEditMilestoneFormProps) {
  const form = (
    <form
      className={
        layout === 'dialog' ? 'flex min-h-0 flex-1 flex-col' : 'grid gap-4'
      }
      onSubmit={onSave}
    >
      <div
        className={
          layout === 'dialog'
            ? 'min-h-0 flex-1 overflow-y-auto px-card py-5'
            : undefined
        }
      >
        <fieldset disabled={isBusy} className="min-w-0">
          <FieldGroup>
            <ProgramMilestoneFields
              id="milestone"
              noticeId="milestone-instructions"
              name={editor.form.name}
              instructions={editor.form.instructions}
              nameError={editor.errors.name}
              instructionsError={editor.errors.instructions}
              schedule={
                <ProgramEditMilestoneScheduleEditor
                  editor={editor}
                  operationStartAt={operationStartAt}
                  operationEndAt={operationEndAt}
                  contextEvents={contextEvents}
                  onFieldChange={onFieldChange}
                />
              }
              onNameChange={(value) => onFieldChange('name', value)}
              onInstructionsChange={(value) =>
                onFieldChange('instructions', value)
              }
            />
            {children}
            <FieldError role="alert">{editor.errors.general}</FieldError>
          </FieldGroup>
        </fieldset>
      </div>
      <div
        className={
          layout === 'dialog'
            ? 'flex shrink-0 justify-end gap-2 border-t border-border px-card py-4'
            : 'flex justify-end gap-2'
        }
      >
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isBusy}
          data-dialog-cancel={layout === 'dialog' ? '' : undefined}
        >
          취소
        </Button>
        <Button type="submit" disabled={isBusy || isSaveDisabled}>
          {isBusy ? '저장 중…' : '저장'}
        </Button>
      </div>
    </form>
  );
  if (layout === 'dialog') return form;
  return (
    <Card>
      <CardHeader>
        <CardTitle>마일스톤 추가</CardTitle>
      </CardHeader>
      <CardContent>{form}</CardContent>
    </Card>
  );
}
