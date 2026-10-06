import { describe, expect, it } from 'vitest';
import { completedAuthoringState } from './program-creation-test-fixtures';
import type { ProgramAuthoringState } from './program-authoring-model';
import {
  validateProgramAuthoringStep,
  validateTemplateFile,
} from './program-authoring-validation';

describe('program authoring validation', () => {
  it('서버가 내려준 2 MB 상한을 넘는 첨부는 서버 표기로 거절한다', () => {
    const policy = { maxBytes: 2 * 1024 * 1024, maxLabel: '2 MB' };
    const file = new File(
      [new Uint8Array(policy.maxBytes + 1)],
      'template.pdf',
    );
    expect(validateTemplateFile(file, policy)).toBe(
      '파일은 2 MB 이하여야 합니다.',
    );
  });

  it('서버 상한과 같은 첨부는 허용한다', () => {
    const policy = { maxBytes: 2 * 1024 * 1024, maxLabel: '2 MB' };
    const file = new File([new Uint8Array(policy.maxBytes)], 'template.pdf');
    expect(validateTemplateFile(file, policy)).toBeNull();
  });
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

  it('marks both team fields when the minimum exceeds the shared maximum', () => {
    const state = {
      ...completedAuthoringState(),
      teamMinSize: '101',
      teamMaxSize: '101',
    };

    expect(validateProgramAuthoringStep(state, 'basic')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'teamMinSize' }),
        expect.objectContaining({ path: 'teamMaxSize' }),
      ]),
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

  // 빈 운영 종료와 시작보다 이른 운영 종료는 다른 상황이라 다른 말로 안내한다(#1420).
  it.each([
    ['an empty operation end', '', '운영 종료를 입력해 주세요.'],
    [
      'an operation end before its start',
      '2026-09-29T18:00',
      '운영 종료는 운영 시작보다 늦어야 합니다.',
    ],
  ])('explains %s in its own words', (_case, operationEndAt, message) => {
    const state = {
      ...completedAuthoringState(),
      operationStartAt: '2026-09-30T18:00',
      operationEndAt,
    };

    expect(
      validateProgramAuthoringStep(state, 'schedule')
        .filter((issue) => issue.path === 'operationEndAt')
        .map((issue) => issue.message),
    ).toEqual([message]);
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
