// 합성 데이터만 사용한다 (docs/rules/security.md)
import { milestoneDocumentDownloadFileName } from './milestone-document-download-file-name';

describe('milestoneDocumentDownloadFileName', () => {
  it('학생이 올린 원본 이름과 무관하게 `팀명_서류명.확장자`로 다시 붙인다', () => {
    // Given: 학생이 구분되지 않는 이름으로 올렸다.
    const input = {
      teamName: '합성팀',
      documentName: '개인정보 수집·이용 동의서',
      originalFileName: '최종_진짜최종.hwp',
    };

    // When
    const result = milestoneDocumentDownloadFileName(input);

    // Then
    expect(result).toBe('합성팀_개인정보 수집·이용 동의서.hwp');
  });

  it('확장자는 원본 파일명의 마지막 점 뒤에서 가져온다', () => {
    // Given
    const input = {
      teamName: '합성팀',
      documentName: '계획서',
      originalFileName: 'plan.v2.final.pdf',
    };

    // When
    const result = milestoneDocumentDownloadFileName(input);

    // Then
    expect(result).toBe('합성팀_계획서.pdf');
  });

  it('원본에 확장자가 없으면 확장자를 붙이지 않는다', () => {
    // Given
    const input = {
      teamName: '합성팀',
      documentName: '계획서',
      originalFileName: '확장자없음',
    };

    // When
    const result = milestoneDocumentDownloadFileName(input);

    // Then
    expect(result).toBe('합성팀_계획서');
  });

  it('숨김 파일처럼 점으로 시작하기만 하는 이름은 확장자로 보지 않는다', () => {
    // Given
    const input = {
      teamName: '합성팀',
      documentName: '계획서',
      originalFileName: '.hwp',
    };

    // When
    const result = milestoneDocumentDownloadFileName(input);

    // Then
    expect(result).toBe('합성팀_계획서');
  });

  it('점으로 끝나면 빈 확장자를 붙이지 않는다', () => {
    // Given
    const input = {
      teamName: '합성팀',
      documentName: '계획서',
      originalFileName: 'plan.',
    };

    // When
    const result = milestoneDocumentDownloadFileName(input);

    // Then
    expect(result).toBe('합성팀_계획서');
  });

  it('팀명·서류명의 경로 구분자를 `_`로 바꿔 경로로 읽히지 않게 한다', () => {
    // Given
    const input = {
      teamName: '../../etc',
      documentName: 'a/b\\c',
      originalFileName: 'plan.pdf',
    };

    // When
    const result = milestoneDocumentDownloadFileName(input);

    // Then
    expect(result).toBe('.._.._etc_a_b_c.pdf');
    expect(result).not.toContain('/');
    expect(result).not.toContain('\\');
  });

  it('제어문자와 헤더 구분자(`"`·`;`)를 `_`로 바꾼다', () => {
    // Given: Content-Disposition 헤더를 쪼갤 수 있는 글자들.
    const input = {
      teamName: '합성\r\n팀',
      documentName: '동의서"; x=1',
      originalFileName: 'plan.pdf',
    };

    // When
    const result = milestoneDocumentDownloadFileName(input);

    // Then
    expect(result).toBe('합성__팀_동의서__ x=1.pdf');
    expect(result).not.toContain('"');
    expect(result).not.toContain(';');
    expect(result).not.toContain('\r');
    expect(result).not.toContain('\n');
  });

  it('한글은 지우지 않는다 — ASCII 폴백 규칙(asciiFallbackFileName)과 다르다', () => {
    // Given
    const input = {
      teamName: '가나다팀',
      documentName: '팀 구성 확인서',
      originalFileName: 'x.png',
    };

    // When
    const result = milestoneDocumentDownloadFileName(input);

    // Then
    expect(result).toBe('가나다팀_팀 구성 확인서.png');
  });

  it('팀명·서류명이 비었거나 점뿐이면 폴백 이름을 쓴다', () => {
    // Given
    const input = {
      teamName: '   ',
      documentName: '..',
      originalFileName: 'plan.pdf',
    };

    // When
    const result = milestoneDocumentDownloadFileName(input);

    // Then
    expect(result).toBe('file_file.pdf');
  });

  it('확장자에 섞인 위험한 글자도 정규화한다', () => {
    // Given
    const input = {
      teamName: '합성팀',
      documentName: '계획서',
      originalFileName: 'plan.pd/f',
    };

    // When
    const result = milestoneDocumentDownloadFileName(input);

    // Then
    expect(result).toBe('합성팀_계획서.pd_f');
  });
});
