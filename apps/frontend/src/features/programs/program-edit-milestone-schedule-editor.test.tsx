import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { toMilestoneForm } from './program-edit-flow';
import { ProgramEditMilestoneScheduleEditor } from './program-edit-milestone-schedule-editor';

describe('ProgramEditMilestoneScheduleEditor', () => {
  it('shows only operation boundaries and the active milestone when application events are supplied', () => {
    const form = toMilestoneForm({
      id: 'milestone-1',
      name: '기획서',
      startAt: '2026-09-10T00:00:00.000Z',
      dueAt: '2026-09-20T00:00:00.000Z',
      submissionType: 'TEXT',
      instructions: null,
    });
    const contextEvents = [
      { id: 'application', label: '신청 기간', kind: 'APPLICATION' as const },
      { id: 'operation', label: '운영 기간', kind: 'OPERATION' as const },
      { id: 'milestone-2', label: '다른 마일스톤', kind: 'MILESTONE' as const },
    ].map((event) => ({
      ...event,
      startAt: '2026-09-01T00:00',
      endAt: '2026-09-30T23:59',
    }));

    const html = renderToStaticMarkup(
      <ProgramEditMilestoneScheduleEditor
        editor={{ mode: 'edit', form, initialForm: form, errors: {} }}
        operationStartAt="2026-09-01T00:00"
        operationEndAt="2026-09-30T23:59"
        contextEvents={contextEvents}
        onFieldChange={vi.fn()}
      />,
    );

    expect(html).toContain('운영 기간');
    expect(html).toContain('기획서');
    expect(html).not.toContain('신청 기간');
    expect(html).not.toContain('다른 마일스톤');
    expect(html).not.toContain('data-schedule-range-selector');
    expect(html).not.toContain('달력을 좌우로 밀어');
  });
});
