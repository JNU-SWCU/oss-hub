import type { EditableMilestone } from './api';
import type {
  ProgramEditForm,
  ProgramMilestoneEditor,
} from './program-edit-flow';
import { toDateTimeLocal } from './program-edit-flow';
import type { ProgramScheduleCalendarEvent } from './program-schedule-calendar-model';

export function editScheduleEvents(
  form: ProgramEditForm,
  milestones: readonly EditableMilestone[],
  editor: ProgramMilestoneEditor,
): readonly ProgramScheduleCalendarEvent[] {
  const events: ProgramScheduleCalendarEvent[] = [];
  if (form.applicationStartAt && form.applicationEndAt) {
    events.push({
      id: 'application',
      label: '신청 기간',
      kind: 'APPLICATION',
      startAt: form.applicationStartAt,
      endAt: form.applicationEndAt,
    });
  }
  if (form.startAt && form.endAt && !form.endAtUndecided) {
    events.push({
      id: 'operation',
      label: '운영 기간',
      kind: 'OPERATION',
      startAt: form.startAt,
      endAt: form.endAt,
    });
  }
  milestones.forEach((milestone, index) => {
    const edited =
      editor.mode === 'edit' && editor.form.id === milestone.id
        ? editor.form
        : null;
    const startAt = edited?.startAt ?? toDateTimeLocal(milestone.startAt);
    const dueAt = edited?.dueAt ?? toDateTimeLocal(milestone.dueAt);
    if (!startAt || !dueAt) return;
    events.push({
      id: milestone.id,
      label: edited?.name || milestone.name || `마일스톤 ${index + 1}`,
      kind: 'MILESTONE',
      startAt,
      endAt: dueAt,
    });
  });
  if (editor.mode === 'create' && editor.form.startAt && editor.form.dueAt) {
    events.push({
      id: 'new-milestone',
      label: editor.form.name || '새 마일스톤',
      kind: 'MILESTONE',
      startAt: editor.form.startAt,
      endAt: editor.form.dueAt,
    });
  }
  return events;
}
