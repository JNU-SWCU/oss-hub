import { describe, expect, it } from 'vitest';

import {
  APPLICATION_ANSWER_MAX_LENGTHS,
  applicationAnswerMaxLength,
} from './application-answer-limits';
import {
  mapApplyProblemFieldErrors,
  mapCreateApplicationError,
  resolveApplySubmitFailure,
  validateApplyForm,
} from './program-apply-flow';
import type { ProgramApplyFormValues } from './program-apply-flow';

function values(
  overrides?: Partial<ProgramApplyFormValues>,
): ProgramApplyFormValues {
  return {
    title: '합성 제목',
    summary: '합성 요약',
    repositoryConnectionMode: 'new',
    repositoryUrl: '',
    isRepositoryPublicationPlanned: true,
    personalDataConsent: true,
    ...overrides,
  } as ProgramApplyFormValues;
}

describe('신청 항목 길이 상한', () => {
  it.each(['title', 'summary'] as const)(
    '%s 는 상한을 숫자로 돌려준다',
    (key) => {
      // 서버와 값이 같은지는 drift 테스트가 본다(백엔드 소스를 직접 읽는다).
      // 여기서는 "조회가 되긴 하는가"만 본다.
      expect(applicationAnswerMaxLength(key)).toBeGreaterThan(0);
    },
  );

  it('상한을 모르는 칸에는 제한을 걸지 않는다', () => {
    // `maxLength={undefined}` 여야 속성이 아예 안 붙는다 — 0 이면 아무것도 못 친다.
    expect(applicationAnswerMaxLength('applicantName')).toBeUndefined();
  });

  it.each(['title', 'summary'] as const)(
    '이미 저장된 %s 가 상한을 넘으면 제출 전에 무엇을 줄일지 말해 준다',
    (key) => {
      // Given: 상한이 생기기 전에 저장된 값을 수정 화면이 불러온 상태.
      // 입력칸의 `maxLength` 는 새로 치는 글자만 막으므로 이 값은 그대로 남는다.
      const limit = APPLICATION_ANSWER_MAX_LENGTHS[key];
      const errors = validateApplyForm(
        values({ [key]: '가'.repeat(limit + 1) }),
        'edit',
      );

      // Then: 그 칸에 상한을 담은 안내가 붙는다.
      expect(errors[key]).toBeTruthy();
      expect(errors[key]).toContain(limit.toLocaleString('ko-KR'));
    },
  );

  it.each(['title', 'summary'] as const)(
    '%s 가 상한과 같으면 막지 않는다',
    (key) => {
      const limit = APPLICATION_ANSWER_MAX_LENGTHS[key];
      const errors = validateApplyForm(
        values({ [key]: '가'.repeat(limit) }),
        'edit',
      );
      expect(errors[key]).toBeUndefined();
    },
  );
});

describe('서버가 보낸 칸별 안내를 그 칸으로 옮긴다', () => {
  it('title·summary 오류를 각 입력칸 오류로 옮긴다', () => {
    // ⚠ 안 옮기면 배너 하나만 뜨고 어느 칸을 줄일지 학생이 모른다.
    const mapped = mapApplyProblemFieldErrors([
      { field: 'title', code: 'APP_024', message: '제목은 200자를…' },
      { field: 'summary', code: 'APP_024', message: '요약은 10,000자를…' },
    ]);

    expect(mapped).toEqual({
      title: '제목은 200자를…',
      summary: '요약은 10,000자를…',
    });
  });

  it('모르는 칸은 옮기지 않는다', () => {
    // 화면에 없는 칸을 옮기면 아무 데도 안 붙어 조용히 사라진다.
    expect(
      mapApplyProblemFieldErrors([
        { field: 'applicantName', code: 'APP_024', message: '…' },
      ]),
    ).toEqual({});
  });

  it('칸 정보가 없으면 빈 결과를 준다 — 그때는 배너가 맡는다', () => {
    expect(mapApplyProblemFieldErrors(undefined)).toEqual({});
  });

  it('APP_024 배너 문구는 두 칸을 모두 짚는 마지막 안전망이다', () => {
    // 칸을 하나도 못 옮겼을 때만 쓰인다.
    const message = mapCreateApplicationError({
      type: 'about:blank',
      title: 'bad request',
      status: 400,
      detail: '신청 항목이 너무 깁니다.',
      instance: 'urn:test',
      code: 'APP_024',
    });

    expect(message).toContain('제목');
    expect(message).toContain('요약');
  });
});

describe('상한 값 자체', () => {
  it('제품 결정으로 정한 값이다 — 바꾸려면 이 테스트도 함께 고쳐야 한다', () => {
    // drift 테스트는 「양쪽이 같은가」만 본다. 둘을 함께 바꾸면 거기선 안 걸린다.
    // 200·10,000 은 「어떻게 될지 모르니 최대한 길게」라는 결정으로 고른 값이다.
    expect(APPLICATION_ANSWER_MAX_LENGTHS).toEqual({
      title: 200,
      summary: 10_000,
    });
  });
});

describe('제출 실패를 칸과 배너로 가른다', () => {
  const problem = (
    fieldErrors?: readonly { field: string; code: string; message: string }[],
  ) => ({
    type: 'about:blank',
    title: 'bad request',
    status: 400,
    detail: '신청 항목이 너무 깁니다.',
    instance: 'urn:test',
    code: 'APP_024',
    ...(fieldErrors ? { fieldErrors } : {}),
  });

  it('서버가 칸을 짚어 주면 그 칸에 붙이고 배너는 띄우지 않는다', () => {
    // 같은 말을 배너와 칸 두 군데서 하면 학생이 어느 쪽을 따라야 할지 헷갈린다.
    const resolved = resolveApplySubmitFailure(
      problem([
        { field: 'title', code: 'APP_024', message: '제목은 200자를…' },
      ]),
      'submit',
    );

    expect(resolved.fieldErrors).toEqual({ title: '제목은 200자를…' });
    expect(resolved.serverError).toBeNull();
  });

  it('칸을 하나도 못 짚으면 배너로 알린다 — 조용히 사라지지 않는다', () => {
    const resolved = resolveApplySubmitFailure(problem(), 'submit');

    expect(resolved.fieldErrors).toEqual({});
    expect(resolved.serverError).toBeTruthy();
    expect(resolved.serverError).toContain('제목');
  });

  it('화면에 없는 칸만 왔으면 배너로 넘긴다', () => {
    // 옮길 데가 없는데 배너까지 비우면 학생은 아무 안내도 못 받는다.
    const resolved = resolveApplySubmitFailure(
      problem([{ field: 'applicantName', code: 'APP_024', message: '…' }]),
      'submit',
    );

    expect(resolved.fieldErrors).toEqual({});
    expect(resolved.serverError).toBeTruthy();
  });
});
