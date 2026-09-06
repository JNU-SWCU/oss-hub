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

  /**
   * 범위가 하나라 `layout="simple"` 을 쓴다 — 달력을 먼저 놓고 번호·「선택 중」 배지를
   * 내지 않는 배치다. 선택기 자체는 `ranges.length === 1` 이라 편집기가 렌더하지
   * 않는다 — `onActiveIdChange` 가 no-op 이므로 눌러도 아무 일도 일어나지 않는
   * 컨트롤이었다.
   */
  return (
    <ProgramScheduleRangeEditor
      ranges={[range]}
      activeId={rangeId}
      onActiveIdChange={() => undefined}
      contextEvents={contextEvents}
      layout="simple"
    />
  );
}
