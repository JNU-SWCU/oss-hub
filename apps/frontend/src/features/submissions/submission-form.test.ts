import { describe, expect, it } from 'vitest';
import { validateSubmissionContent } from './submission-form';

describe('validateSubmissionContent', () => {
  it('TEXT는 공백만 있는 제출을 거절하고 입력값은 유지한다', () => {
    // Given
    const input = { text: '   ', releaseUrl: '' };

    // When
    const errors = validateSubmissionContent('TEXT', input);

    // Then
    expect(errors).toEqual({ text: '제출 내용을 입력해 주세요.' });
    expect(input.text).toBe('   ');
  });

  it('REPOSITORY_RELEASE는 http URL이 아니면 field 오류를 반환한다', () => {
    // Given
    const input = { text: '', releaseUrl: 'not-a-url' };

    // When
    const errors = validateSubmissionContent('REPOSITORY_RELEASE', input);

    // Then
    expect(errors).toEqual({
      releaseUrl: '태그 또는 릴리스의 전체 URL을 입력해 주세요.',
    });
  });

  it('연결 저장소의 URL 형태는 서버 검증을 위해 통과시킨다', () => {
    // Given
    const input = {
      text: '',
      releaseUrl:
        'https://github.com/JNU-SWCU/synthetic-repository/releases/tag/v1.0.0',
    };

    // When
    const errors = validateSubmissionContent('REPOSITORY_RELEASE', input);

    // Then
    expect(errors).toEqual({});
  });
});
