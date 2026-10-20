import { describe, expect, it } from 'vitest';
import {
  createInitialProgramAuthoringState,
  createMilestoneDraft,
  createRequirementDraft,
  programAuthoringReducer,
} from './program-authoring-model';

describe('program authoring milestone model', () => {
  it('starts with no milestones and creates milestones without attachments', () => {
    const initial = createInitialProgramAuthoringState({
      idempotencyKey: 'request-1',
      milestoneId: 'unused-milestone-id',
    });

    const next = programAuthoringReducer(initial, {
      type: 'add_milestone',
      milestoneId: 'milestone-1',
    });

    expect(initial.milestones).toEqual([]);
    expect(next.milestones[0]?.requirements).toEqual([]);
  });

  it('derives an attachment target name from its selected file', () => {
    const milestone = createMilestoneDraft('milestone-1');
    const state = {
      ...createInitialProgramAuthoringState({
        idempotencyKey: 'request-1',
        milestoneId: 'unused-milestone-id',
      }),
      milestones: [
        {
          ...milestone,
          requirements: [createRequirementDraft('requirement-1')],
        },
      ],
    };

    const next = programAuthoringReducer(state, {
      type: 'set_requirement_file',
      milestoneId: 'milestone-1',
      requirementId: 'requirement-1',
      file: { name: 'reference.pdf', size: 1024, type: 'application/pdf' },
    });

    expect(next.milestones[0]?.requirements[0]).toMatchObject({
      name: 'reference.pdf',
      templateFile: {
        name: 'reference.pdf',
        requiresReselection: false,
      },
    });

    const renamed = programAuthoringReducer(next, {
      type: 'set_requirement_name',
      milestoneId: 'milestone-1',
      requirementId: 'requirement-1',
      name: '최종 결과물',
    });
    const reuploaded = programAuthoringReducer(renamed, {
      type: 'set_requirement_file',
      milestoneId: 'milestone-1',
      requirementId: 'requirement-1',
      file: {
        name: 'replacement.pdf',
        size: 2048,
        type: 'application/pdf',
      },
    });

    expect(reuploaded.milestones[0]?.requirements[0]).toMatchObject({
      name: '최종 결과물',
      templateFile: { name: 'replacement.pdf' },
    });
  });

  it('allows the last attachment target to be removed', () => {
    const state = {
      ...createInitialProgramAuthoringState({
        idempotencyKey: 'request-1',
        milestoneId: 'unused-milestone-id',
      }),
      milestones: [
        {
          ...createMilestoneDraft('milestone-1'),
          requirements: [createRequirementDraft('requirement-1')],
        },
      ],
    };

    const next = programAuthoringReducer(state, {
      type: 'remove_requirement',
      milestoneId: 'milestone-1',
      requirementId: 'requirement-1',
    });

    expect(next.milestones[0]?.requirements).toEqual([]);
  });

  it('reorders one milestone requirements without changing requirement objects or other milestones', () => {
    const requirementOne = {
      ...createRequirementDraft('requirement-1'),
      name: 'first.pdf',
      templateFile: {
        name: 'first.pdf',
        size: 1,
        type: 'application/pdf',
        requiresReselection: false,
      },
    };
    const requirementTwo = {
      ...createRequirementDraft('requirement-2'),
      name: 'second.pdf',
      templateFile: {
        name: 'second.pdf',
        size: 2,
        type: 'application/pdf',
        requiresReselection: true,
      },
    };
    const otherRequirement = createRequirementDraft('other-requirement');
    const state = {
      ...createInitialProgramAuthoringState({
        idempotencyKey: 'request-1',
        milestoneId: 'unused-milestone-id',
      }),
      milestones: [
        {
          ...createMilestoneDraft('milestone-1'),
          requirements: [requirementOne, requirementTwo],
        },
        {
          ...createMilestoneDraft('milestone-2'),
          requirements: [otherRequirement],
        },
      ],
    };

    const next = programAuthoringReducer(state, {
      type: 'reorder_requirements',
      milestoneId: 'milestone-1',
      requirementIds: ['requirement-2', 'requirement-1'],
    });

    expect(next.milestones[0]?.requirements).toEqual([
      requirementTwo,
      requirementOne,
    ]);
    expect(next.milestones[0]?.requirements[0]).toBe(requirementTwo);
    expect(next.milestones[0]?.requirements[1]).toBe(requirementOne);
    expect(next.milestones[1]).toBe(state.milestones[1]);
  });

  it.each([
    ['missing ID', ['requirement-1']],
    ['foreign ID', ['requirement-1', 'foreign-requirement']],
    ['duplicate ID', ['requirement-1', 'requirement-1']],
    ['extra ID', ['requirement-1', 'requirement-2', 'requirement-3']],
  ])(
    'preserves state when requirement order has a %s',
    (_description, requirementIds) => {
      const state = {
        ...createInitialProgramAuthoringState({
          idempotencyKey: 'request-1',
          milestoneId: 'unused-milestone-id',
        }),
        milestones: [
          {
            ...createMilestoneDraft('milestone-1'),
            requirements: [
              createRequirementDraft('requirement-1'),
              createRequirementDraft('requirement-2'),
            ],
          },
        ],
      };

      const next = programAuthoringReducer(state, {
        type: 'reorder_requirements',
        milestoneId: 'milestone-1',
        requirementIds,
      });

      expect(next).toBe(state);
    },
  );

  it('replaces only an existing milestone by the snapshot ID', () => {
    const state = {
      ...createInitialProgramAuthoringState({
        idempotencyKey: 'request-1',
        milestoneId: 'unused-milestone-id',
      }),
      milestones: [
        { ...createMilestoneDraft('milestone-1'), name: 'before' },
        { ...createMilestoneDraft('milestone-2'), name: 'concurrent edit' },
      ],
    };

    const restored = { ...createMilestoneDraft('milestone-1'), name: 'after' };
    const replaced = programAuthoringReducer(state, {
      type: 'replace_milestone',
      milestone: restored,
    });
    const missing = programAuthoringReducer(replaced, {
      type: 'replace_milestone',
      milestone: { ...createMilestoneDraft('missing'), name: 'not appended' },
    });

    expect(replaced.milestones.map((milestone) => milestone.name)).toEqual([
      'after',
      'concurrent edit',
    ]);
    expect(missing.milestones).toEqual(replaced.milestones);
  });
});
