import { describe, expect, it } from 'vitest';
import type { EditableMilestone, EditableProgram } from './api';
import { toMilestoneForm } from './program-edit-flow';
import { isMilestoneFormDirty, upsertMilestone } from './program-edit-state';

const milestone: EditableMilestone = {
  id: 'milestone-1',
  name: '기획서',
  startAt: '2026-08-16T09:30:59.000Z',
  dueAt: '2026-08-20T09:30:59.000Z',
  submissionType: 'TEXT',
  instructions: '초안 제출',
};

describe('milestone edit dialog state', () => {
  it('treats an unchanged or reverted form as clean', () => {
    const initial = toMilestoneForm(milestone);
    expect(isMilestoneFormDirty(initial, initial)).toBe(false);
    expect(isMilestoneFormDirty(initial, { ...initial, name: '변경' })).toBe(
      true,
    );
    expect(
      isMilestoneFormDirty(initial, { ...initial, name: initial.name }),
    ).toBe(false);
  });

  it('preserves the original startAt when only the name changes', () => {
    const initial = toMilestoneForm(milestone);
    expect(initial.originalStartAt).toBe(milestone.startAt);
  });

  it('upserts only the saved milestone and leaves its neighbor unchanged', () => {
    const adjacent = { ...milestone, id: 'milestone-2', name: '발표' };
    const program = { milestones: [milestone, adjacent] } as EditableProgram;
    const saved = { ...milestone, name: '기획서 수정' };
    const updated = upsertMilestone(program, saved);
    expect(updated.milestones.find(({ id }) => id === adjacent.id)).toBe(
      adjacent,
    );
    expect(updated.milestones.find(({ id }) => id === milestone.id)).toEqual(
      saved,
    );
  });
});
