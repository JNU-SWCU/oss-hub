import { describe, expect, it } from 'vitest';

import {
  APPLICATION_ANSWER_MAX_LENGTHS,
  applicationAnswerMaxLength,
} from './application-answer-limits';
import { validateApplyForm } from './program-apply-flow';
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
