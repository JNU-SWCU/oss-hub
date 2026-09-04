import {
  APPLICATION_ANSWER_MAX_LENGTHS,
  checkApplicationTemplateVersion,
  normalizeAndValidateApplicationAnswers,
} from './application-answers.validator';

describe('normalizeAndValidateApplicationAnswers', () => {
  const applicantName = '홍길동';

  it('서버 applicantName을 주입하고 title·summary를 정규화한다', () => {
    const result = normalizeAndValidateApplicationAnswers(
      { title: '  제목  ', summary: ' 요약 ' },
      applicantName,
      'enforce-length',
    );

    expect(result).toEqual({
      ok: true,
      answers: {
        applicantName: '홍길동',
        title: '제목',
        summary: '요약',
      },
    });
  });

  it('클라이언트가 보낸 applicantName은 무시하고 서버 값으로 덮어쓴다', () => {
    const result = normalizeAndValidateApplicationAnswers(
      {
        applicantName: '위조이름',
        title: '제목',
        summary: '요약',
      },
      '서버이름',
      'enforce-length',
    );

    expect(result).toEqual({
      ok: true,
      answers: {
        applicantName: '서버이름',
        title: '제목',
        summary: '요약',
      },
    });
  });

  it('알 수 없는 키가 있으면 UNKNOWN_KEYS다', () => {
    const result = normalizeAndValidateApplicationAnswers(
      { title: '제목', summary: '요약', extra: 'nope' },
      applicantName,
      'enforce-length',
    );

    expect(result).toEqual({
      ok: false,
      reason: 'UNKNOWN_KEYS',
      unknownKeys: ['extra'],
    });
  });

  it('summary 누락만 MISSING_REQUIRED다', () => {
    expect(
      normalizeAndValidateApplicationAnswers(
        { title: '', summary: '요약' },
        applicantName,
        'enforce-length',
      ),
    ).toEqual({
      ok: true,
      answers: { applicantName, title: '', summary: '요약' },
    });

    expect(
      normalizeAndValidateApplicationAnswers(
        { title: '제목' },
        applicantName,
        'enforce-length',
      ),
    ).toEqual({
      ok: false,
      reason: 'MISSING_REQUIRED',
      missingKeys: ['summary'],
    });
  });

  it('비객체 answers는 INVALID_SHAPE다', () => {
    expect(
      normalizeAndValidateApplicationAnswers(
        null,
        applicantName,
        'enforce-length',
      ),
    ).toEqual({ ok: false, reason: 'INVALID_SHAPE' });
    expect(
      normalizeAndValidateApplicationAnswers(
        ['a'],
        applicantName,
        'enforce-length',
      ),
    ).toEqual({ ok: false, reason: 'INVALID_SHAPE' });
  });
});

describe('checkApplicationTemplateVersion', () => {
  it('버전이 일치하면 ok다', () => {
    expect(checkApplicationTemplateVersion(1, 1)).toEqual({ ok: true });
  });

  it('버전 불일치·비정수는 VERSION_MISMATCH다 (409 경로)', () => {
    expect(checkApplicationTemplateVersion(1, 2)).toEqual({
      ok: false,
      reason: 'VERSION_MISMATCH',
    });
    expect(checkApplicationTemplateVersion(1.5, 1)).toEqual({
      ok: false,
      reason: 'VERSION_MISMATCH',
    });
  });
});

describe('신청 항목 길이 상한', () => {
  const applicantName = '합성 학생';

  function answersOf(overrides: {
    readonly title?: string;
    readonly summary?: string;
  }) {
    return { title: '합성 제목', summary: '합성 지원 동기', ...overrides };
  }

  it.each(['title', 'summary'] as const)(
    '%s 가 상한을 넘으면 쓰기에서 거절한다',
    (key) => {
      // Given: 그 칸만 상한보다 한 글자 길다.
      // ⚠ 상한 값은 소스에서 읽는다 — 테스트에 숫자를 베껴 적으면 상한을 바꿔도 안 걸린다.
      const limit = APPLICATION_ANSWER_MAX_LENGTHS[key];
      const answers = answersOf({ [key]: '가'.repeat(limit + 1) });

      // When: 쓰기로 검증한다.
      const result = normalizeAndValidateApplicationAnswers(
        answers,
        applicantName,
        'enforce-length',
      );

      // Then: 어느 칸이 넘쳤는지까지 알려 준다.
      expect(result).toEqual({
        ok: false,
        reason: 'TOO_LONG',
        tooLongKeys: [key],
      });
    },
  );

  it.each(['title', 'summary'] as const)(
    '%s 가 상한과 같은 길이면 통과한다',
    (key) => {
      // Given: 딱 상한만큼이다(경계).
      const limit = APPLICATION_ANSWER_MAX_LENGTHS[key];
      const answers = answersOf({ [key]: '가'.repeat(limit) });

      // When·Then
      const result = normalizeAndValidateApplicationAnswers(
        answers,
        applicantName,
        'enforce-length',
      );
      expect(result.ok).toBe(true);
    },
  );

  it('앞뒤 공백을 덜어 낸 뒤의 길이로 잰다', () => {
    // Given: 공백을 빼면 상한 안에 들어온다.
    const limit = APPLICATION_ANSWER_MAX_LENGTHS.title;
    const answers = answersOf({ title: `  ${'가'.repeat(limit)}  ` });

    // When·Then: 공백 때문에 거절당하지 않는다.
    expect(
      normalizeAndValidateApplicationAnswers(
        answers,
        applicantName,
        'enforce-length',
      ).ok,
    ).toBe(true);
  });

  it('읽기에서는 상한을 넘는 저장분도 그대로 돌려준다', () => {
    // Given: 상한이 생기기 전에 저장된 긴 지원 동기다.
    // ⚠ 여기서 거절하면 학생이 **자기 신청서를 열지도 못한다** — 고치라고 만든
    //   상한이 고칠 길을 막는다.
    const tooLong = '가'.repeat(APPLICATION_ANSWER_MAX_LENGTHS.summary + 1);
    const answers = answersOf({ summary: tooLong });

    // When: 읽기로 검증한다.
    const result = normalizeAndValidateApplicationAnswers(
      answers,
      applicantName,
      'skip-length',
    );

    // Then: 통과하고 내용도 안 잘린다.
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.answers.summary).toBe(tooLong);
  });

  it('두 칸이 함께 넘치면 둘 다 알려 준다', () => {
    const answers = {
      title: '가'.repeat(APPLICATION_ANSWER_MAX_LENGTHS.title + 1),
      summary: '나'.repeat(APPLICATION_ANSWER_MAX_LENGTHS.summary + 1),
    };

    const result = normalizeAndValidateApplicationAnswers(
      answers,
      applicantName,
      'enforce-length',
    );

    expect(result).toMatchObject({
      reason: 'TOO_LONG',
      tooLongKeys: ['title', 'summary'],
    });
  });
});
