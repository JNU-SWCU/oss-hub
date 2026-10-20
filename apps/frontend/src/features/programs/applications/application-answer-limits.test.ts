import { describe, expect, it } from 'vitest';
import { applicationAnswerMaxLength } from './application-answer-limits';
import {
  mapApplyProblemFieldErrors,
  resolveApplySubmitFailure,
} from './program-apply-flow';

describe('신청 항목 길이 조회', () => {
  it('제거된 필드와 프로토타입 속성에 길이 제한을 만들지 않는다', () => {
    for (const key of [
      'summary',
      'applicantName',
      'unknown',
      'constructor',
      'toString',
    ]) {
      expect(applicationAnswerMaxLength(key)).toBeUndefined();
    }
  });
});

describe('현재 화면에 없는 필드 오류', () => {
  it('제거된 summary 오류가 보이지 않는 입력칸으로 사라지지 않는다', () => {
    const fieldErrors = [
      { field: 'summary', code: 'APP_024', message: '이전 양식 오류' },
    ];
    expect(mapApplyProblemFieldErrors(fieldErrors)).toEqual({});
    const failure = resolveApplySubmitFailure(
      {
        type: 'about:blank',
        title: 'bad request',
        status: 400,
        detail: '신청 항목이 너무 깁니다.',
        instance: 'urn:test',
        code: 'APP_024',
        fieldErrors,
      },
      'submit',
    );
    expect(failure.fieldErrors).toEqual({});
    expect(failure.serverError).toContain('입력한 내용을 확인');
    expect(failure.serverError).not.toContain('요약');
  });

  it('필드 정보가 없어도 저장 실패 안내를 유지한다', () => {
    expect(mapApplyProblemFieldErrors(undefined)).toEqual({});
    const failure = resolveApplySubmitFailure(
      {
        type: 'about:blank',
        title: 'error',
        status: 500,
        detail: '',
        instance: 'urn:test',
        code: 'UNKNOWN',
      },
      'save',
    );
    expect(failure.serverError).toContain('입력한 내용은 그대로 남아');
  });
});
