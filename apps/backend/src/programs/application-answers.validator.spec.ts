import {
  checkApplicationTemplateVersion,
  normalizeAndValidateApplicationAnswers,
} from './application-answers.validator';

describe('normalizeAndValidateApplicationAnswers', () => {
  const applicantName = '홍길동';

  it('서버 applicantName을 주입하고 title·summary를 정규화한다', () => {
    const result = normalizeAndValidateApplicationAnswers(
      { title: '  제목  ', summary: ' 요약 ' },
      applicantName,
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
    );

    expect(result).toEqual({
      ok: false,
      reason: 'UNKNOWN_KEYS',
      unknownKeys: ['extra'],
    });
  });

  it('title 또는 summary 누락·공백은 MISSING_REQUIRED다', () => {
    expect(
      normalizeAndValidateApplicationAnswers(
        { title: '', summary: '요약' },
        applicantName,
      ),
    ).toEqual({
      ok: false,
      reason: 'MISSING_REQUIRED',
      missingKeys: ['title'],
    });

    expect(
      normalizeAndValidateApplicationAnswers({ title: '제목' }, applicantName),
    ).toEqual({
      ok: false,
      reason: 'MISSING_REQUIRED',
      missingKeys: ['summary'],
    });
  });

  it('비객체 answers는 INVALID_SHAPE다', () => {
    expect(
      normalizeAndValidateApplicationAnswers(null, applicantName),
    ).toEqual({ ok: false, reason: 'INVALID_SHAPE' });
    expect(
      normalizeAndValidateApplicationAnswers(['a'], applicantName),
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
