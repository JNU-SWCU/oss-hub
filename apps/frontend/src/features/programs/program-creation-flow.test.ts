import { describe, expect, it, vi } from 'vitest';
import type { CreatedProgram } from './api';
import {
  buildCreateProgramInput,
  EMPTY_PROGRAM_FORM,
  hasProgramFormInput,
  startProgramSubmission,
  validateProgramForm,
  type ProgramForm,
  type ProgramSubmissionLock,
} from './program-creation-flow';
import type { ProgramTemplateDefinition } from './program-templates';

const teamTemplate: ProgramTemplateDefinition = {
  category: 'OSS_CONTEST',
  label: 'OSS경진대회',
  template: {
    key: 'oss-contest',
    version: 1,
    name: 'OSS경진대회 신청서',
    participation: 'team',
    fields: [],
  },
};

const completedForm: ProgramForm = {
  name: '합성 프로그램',
  organizer: '합성 주관기관',
  applicationStartAt: '2026-08-01T09:00',
  applicationEndAt: '2026-08-08T18:00',
  endAt: '2026-08-31T18:00',
  teamMinSize: '2',
  teamMaxSize: '4',
  description: '합성 프로그램 설명',
};

describe('program creation dirty state', () => {
  it('입력값이 없으면 clean 상태다', () => {
    expect(hasProgramFormInput(EMPTY_PROGRAM_FORM)).toBe(false);
  });

  it('입력값이 하나라도 있으면 dirty 상태다', () => {
    // Given
    const form = { ...EMPTY_PROGRAM_FORM, name: '작성 중' };

    expect(hasProgramFormInput(form)).toBe(true);
  });
});
describe('program creation end date', () => {
  it('sends the entered end date as an exact ISO endAt', () => {
    expect(buildCreateProgramInput(completedForm, teamTemplate).endAt).toBe(
      new Date(2026, 7, 31, 18).toISOString(),
    );
  });

  it('shows an endAt field error when it precedes applicationEndAt', () => {
    expect(
      validateProgramForm(
        { ...completedForm, endAt: '2026-08-08T17:59' },
        teamTemplate,
      ).endAt,
    ).toBe('프로그램 종료일은 신청 종료일보다 늦어야 합니다.');
  });
});

describe('program end validation', () => {
  it.each([
    ['', '필수'],
    ['2026-08-08T18:00', '신청 종료일과 같음'],
    ['2026-08-08T17:59', '신청 종료일보다 이전'],
  ])('프로그램 종료일이 유효하지 않으면 오류를 반환한다: %s (%s)', (endAt) => {
    const errors = validateProgramForm(
      { ...completedForm, endAt },
      teamTemplate,
    );

    expect(errors.endAt).toBe(
      '프로그램 종료일은 신청 종료일보다 늦어야 합니다.',
    );
  });

  it('프로그램 종료일이 신청 종료일보다 늦으면 통과한다', () => {
    const errors = validateProgramForm(completedForm, teamTemplate);

    expect(errors.endAt).toBeUndefined();
  });

  it('별도의 프로그램 종료일을 ISO 형식으로 정확히 생성 API 입력에 포함한다', () => {
    const input = buildCreateProgramInput(completedForm, teamTemplate);

    expect(input).toEqual({
      name: '합성 프로그램',
      organizer: '합성 주관기관',
      category: 'OSS_CONTEST',
      applicationStartAt: new Date(
        completedForm.applicationStartAt,
      ).toISOString(),
      applicationEndAt: new Date(completedForm.applicationEndAt).toISOString(),
      endAt: new Date(completedForm.endAt).toISOString(),
      teamMinSize: 2,
      teamMaxSize: 4,
      description: '합성 프로그램 설명',
    });
    expect(input.endAt).not.toBe(input.applicationEndAt);
  });
});

describe('program creation vertical flow', () => {
  it('선택 유형으로 한 번만 생성하고 생성된 상세 화면으로 이동한다', async () => {
    // Given
    let resolveCreation: ((program: CreatedProgram) => void) | undefined;
    const creation = new Promise<CreatedProgram>((resolve) => {
      resolveCreation = resolve;
    });
    const create = vi.fn(() => creation);
    const navigate = vi.fn();
    const lock: ProgramSubmissionLock = { current: false };
    const input = buildCreateProgramInput(completedForm, teamTemplate);

    // When
    const first = startProgramSubmission(lock, input, create, navigate);
    const duplicate = startProgramSubmission(lock, input, create, navigate);

    // Then
    expect(duplicate).toEqual({ status: 'ignored' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'OSS_CONTEST',
        teamMinSize: 2,
        teamMaxSize: 4,
      }),
    );

    resolveCreation?.({
      id: 'synthetic-program',
      category: 'OSS_CONTEST',
      applicationTemplateKey: 'oss-contest',
      applicationTemplateVersion: 1,
      detailUrl: '/programs/synthetic-program',
    });

    expect(first.status).toBe('started');
    if (first.status === 'started') await first.completion;
    expect(navigate).toHaveBeenCalledWith('/programs/synthetic-program');
  });
});
