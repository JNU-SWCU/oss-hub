import { describe, expect, it } from 'vitest';
import type { EditableMilestone, EditableProgram } from './api';
import { toMilestoneForm } from './program-edit-flow';
import {
  hasUnsavedMilestoneEdit,
  isMilestoneFormDirty,
  upsertMilestone,
} from './program-edit-state';

const milestone: EditableMilestone = {
  id: 'milestone-1',
  name: '기획서',
  startAt: '2026-08-16T09:30:59.000Z',
  dueAt: '2026-08-20T09:30:59.000Z',
  submissionType: 'TEXT',
  instructions: '초안 제출',
};

const program: EditableProgram = {
  id: 'program-1',
  name: 'OSS',
  organizer: 'Center',
  category: 'OSS_CONTEST',
  lifecycle: 'PUBLISHED',
  applicationTemplateKey: 'oss-contest',
  applicationTemplateVersion: 1,
  applicationCount: 0,
  categoryLocked: {
    locked: false,
    byApplications: false,
    byTeams: false,
    applicationCount: 0,
    teamCount: 0,
  },
  applicationStartAt: '2026-08-01T09:30:59.000Z',
  applicationEndAt: '2026-08-15T09:30:59.000Z',
  startAt: '2026-08-16T09:30:59.000Z',
  endAt: '2026-08-31T09:30:59.000Z',
  repositoryProvisioningEnabled: false,
  notifyOnDeadline: false,
  description: 'overview',
  teamMinSize: 2,
  teamMaxSize: 4,
  milestones: [],
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
    expect(
      hasUnsavedMilestoneEdit({
        mode: 'edit',
        initialForm: initial,
        form: { ...initial, name: initial.name },
        errors: {},
      }),
    ).toBe(false);
  });

  it('preserves the original startAt when only the name changes', () => {
    const initial = toMilestoneForm(milestone);
    expect(initial.originalStartAt).toBe(milestone.startAt);
  });

  it('upserts only the saved milestone and leaves its neighbor unchanged', () => {
    const adjacent = { ...milestone, id: 'milestone-2', name: '발표' };
    const saved = { ...milestone, name: '기획서 수정' };
    const updated = upsertMilestone(
      { ...program, milestones: [milestone, adjacent] },
      saved,
    );
    expect(updated.milestones.find(({ id }) => id === adjacent.id)).toBe(
      adjacent,
    );
    expect(updated.milestones.find(({ id }) => id === milestone.id)).toEqual(
      saved,
    );
  });
});
