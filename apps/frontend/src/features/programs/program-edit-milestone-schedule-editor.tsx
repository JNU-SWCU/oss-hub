import type {
  ProgramMilestoneEditor,
  ProgramMilestoneField,
} from './program-edit-flow';
import type { ProgramScheduleCalendarEvent } from './program-schedule-calendar-model';
import { dateKey } from './program-schedule-calendar-model';
import { ProgramScheduleRangeEditor } from './program-schedule-range-editor';
import type { ProgramScheduleEditableRange } from './program-schedule-range-types';

export function ProgramEditMilestoneScheduleEditor({
  editor,
  operationStartAt,
  operationEndAt,
  contextEvents,
  onFieldChange,
}: {
  readonly editor: Exclude<ProgramMilestoneEditor, { readonly mode: 'closed' }>;
  readonly operationStartAt: string;
  readonly operationEndAt: string;
  readonly contextEvents: readonly ProgramScheduleCalendarEvent[];
  readonly onFieldChange: (field: ProgramMilestoneField, value: string) => void;
}) {
  const rangeId = editor.form.id ?? 'new-milestone';
  const range: ProgramScheduleEditableRange = {
    id: rangeId,
    label: editor.form.name || '새 마일스톤',
    kind: 'MILESTONE',
    startAt: editor.form.startAt,
    endAt: editor.form.dueAt,
    minDate: dateKey(operationStartAt) ?? undefined,
    maxDate: dateKey(operationEndAt) ?? undefined,
    startInputId: 'milestone-start-at',
    endInputId: 'milestone-due-at',
    startError: editor.errors.startAt,
    endError: editor.errors.dueAt,
    onStartAtChange: (value) => onFieldChange('startAt', value),
    onEndAtChange: (value) => onFieldChange('dueAt', value),
  };

  return (
    <ProgramScheduleRangeEditor
      ranges={[range]}
      activeId={rangeId}
      onActiveIdChange={() => undefined}
      contextEvents={contextEvents}
    />
  );
}
