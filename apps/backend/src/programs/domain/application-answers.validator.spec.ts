import {
  APPLICATION_ANSWER_MAX_LENGTHS,
  checkApplicationTemplateVersion,
  normalizeAndValidateApplicationAnswers,
} from './application-answers.validator';

describe('normalizeAndValidateApplicationAnswers', () => {
  const applicantName = '홍길동';

  it('summary 없이 선택적인 title을 정규화하고 서버 applicantName을 주입한다', () => {
    const result = normalizeAndValidateApplicationAnswers(
      { title: '  제목  ' },
      applicantName,
      'enforce-length',
    );

    expect(result).toEqual({
      ok: true,
      answers: {
        applicantName: '홍길동',
        title: '제목',
      },
    });
  });

  it('새 신청의 빈 answers도 신청자만 서버에서 채워 유효하다', () => {
    expect(
      normalizeAndValidateApplicationAnswers(
        {},
        applicantName,
        'enforce-length',
      ),
    ).toEqual({
      ok: true,
      answers: { applicantName, title: '' },
    });
  });

  it('클라이언트가 보낸 applicantName은 무시하고 서버 값으로 덮어쓴다', () => {
    const result = normalizeAndValidateApplicationAnswers(
      { applicantName: '위조이름', title: '제목' },
      '서버이름',
      'enforce-length',
    );

    expect(result).toEqual({
      ok: true,
      answers: {
        applicantName: '서버이름',
        title: '제목',
      },
    });
  });

  it('제거된 summary를 새 쓰기에서 보내면 UNKNOWN_KEYS다', () => {
    expect(
      normalizeAndValidateApplicationAnswers(
        { summary: '요약' },
        applicantName,
        'enforce-length',
      ),
    ).toEqual({
      ok: false,
      reason: 'UNKNOWN_KEYS',
      unknownKeys: ['summary'],
    });
  });

  it('읽을 때 기존 summary는 버리고 기본값을 만들지 않는다', () => {
    const result = normalizeAndValidateApplicationAnswers(
      { title: '기존 제목', summary: '이전 요약' },
      applicantName,
      'skip-length',
    );

    expect(result).toEqual({
      ok: true,
      answers: {
        applicantName,
        title: '기존 제목',
      },
    });
    if (result.ok) {
      expect(result.answers).not.toHaveProperty('summary');
    }
  });

  it('알 수 없는 키가 있으면 UNKNOWN_KEYS다', () => {
    expect(
      normalizeAndValidateApplicationAnswers(
        { title: '제목', extra: 'nope' },
        applicantName,
        'enforce-length',
      ),
    ).toEqual({
      ok: false,
      reason: 'UNKNOWN_KEYS',
      unknownKeys: ['extra'],
    });
  });

  it('신청자 이름이 없으면 MISSING_REQUIRED다', () => {
    expect(
      normalizeAndValidateApplicationAnswers(
        { title: '제목' },
        '   ',
        'enforce-length',
      ),
    ).toEqual({
      ok: false,
      reason: 'MISSING_REQUIRED',
      missingKeys: ['applicantName'],
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

  function answersOf(overrides: { readonly title?: string }) {
    return { title: '합성 제목', ...overrides };
  }

  it.each(['title'] as const)(
    '%s 가 상한을 넘으면 쓰기에서 거절한다',
    (key) => {
      const limit = APPLICATION_ANSWER_MAX_LENGTHS[key];
      const answers = answersOf({ [key]: '가'.repeat(limit + 1) });

      const result = normalizeAndValidateApplicationAnswers(
        answers,
        applicantName,
        'enforce-length',
      );

      expect(result).toEqual({
        ok: false,
        reason: 'TOO_LONG',
        tooLongKeys: [key],
      });
    },
  );

  it.each(['title'] as const)('%s 가 상한과 같은 길이면 통과한다', (key) => {
    const limit = APPLICATION_ANSWER_MAX_LENGTHS[key];
    const answers = answersOf({ [key]: '가'.repeat(limit) });

    const result = normalizeAndValidateApplicationAnswers(
      answers,
      applicantName,
      'enforce-length',
    );
    expect(result.ok).toBe(true);
  });

  it('앞뒤 공백을 덜어 낸 뒤의 길이로 잰다', () => {
    const limit = APPLICATION_ANSWER_MAX_LENGTHS.title;
    const answers = answersOf({ title: `  ${'가'.repeat(limit)}  ` });

    expect(
      normalizeAndValidateApplicationAnswers(
        answers,
        applicantName,
        'enforce-length',
      ).ok,
    ).toBe(true);
  });

  it('읽기에서는 상한을 넘는 기존 title도 그대로 돌려준다', () => {
    const tooLong = '가'.repeat(APPLICATION_ANSWER_MAX_LENGTHS.title + 1);

    const result = normalizeAndValidateApplicationAnswers(
      { title: tooLong, summary: '이전 요약' },
      applicantName,
      'skip-length',
    );

    expect(result).toEqual({
      ok: true,
      answers: { applicantName, title: tooLong },
    });
  });
});
