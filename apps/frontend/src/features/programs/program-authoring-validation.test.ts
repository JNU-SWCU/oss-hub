import { describe, expect, it } from 'vitest';
import { completedAuthoringState } from './program-creation-test-fixtures';
import type { ProgramAuthoringState } from './program-authoring-model';
import { validateProgramAuthoringStep } from './program-authoring-validation';

describe('program authoring validation', () => {
  it('routes team-size errors to the basic information step', () => {
    const state = {
      ...completedAuthoringState(),
      teamMinSize: '0',
      teamMaxSize: '101',
    };

    expect(validateProgramAuthoringStep(state, 'basic')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'teamMinSize', step: 'basic' }),
        expect.objectContaining({ path: 'teamMaxSize', step: 'basic' }),
      ]),
    );
    const scheduleIssues = validateProgramAuthoringStep(state, 'schedule');
    expect(scheduleIssues).not.toContainEqual(
      expect.objectContaining({ path: 'teamMinSize' }),
    );
    expect(scheduleIssues).not.toContainEqual(
      expect.objectContaining({ path: 'teamMaxSize' }),
    );
  });

  it('accepts an application period that partially overlaps operations', () => {
    const state = {
      ...completedAuthoringState(),
      applicationEndAt: '2026-09-10T18:00',
    };

    expect(validateProgramAuthoringStep(state, 'schedule')).toEqual([]);
  });

  it('rejects an application period ending after operations', () => {
    const state = {
      ...completedAuthoringState(),
      applicationEndAt: '2026-10-01T18:00',
    };

    expect(validateProgramAuthoringStep(state, 'schedule')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'applicationEndAt', step: 'schedule' }),
      ]),
    );
  });

  it('accepts a milestone ending exactly with operations', () => {
    const state = completedAuthoringState();
    const milestone = state.milestones[0];
    if (milestone === undefined) throw new TypeError('Missing milestone.');

    expect(
      validateProgramAuthoringStep(
        {
          ...state,
          milestones: [{ ...milestone, dueAt: state.operationEndAt }],
        },
        'milestones',
      ),
    ).toEqual([]);
  });

  it.each<readonly [string, Partial<ProgramAuthoringState>, string]>([
    [
      'a reversed application period',
      {
        applicationStartAt: '2026-09-02T09:00',
        applicationEndAt: '2026-09-01T18:00',
      },
      'applicationEndAt',
    ],
    [
      'a non-increasing operation period',
      {
        operationStartAt: '2026-09-30T18:00',
        operationEndAt: '2026-09-30T18:00',
      },
      'operationEndAt',
    ],
  ])('rejects %s', (_case, schedule, path) => {
    const state = { ...completedAuthoringState(), ...schedule };

    expect(validateProgramAuthoringStep(state, 'schedule')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path, step: 'schedule' }),
      ]),
    );
  });
});
