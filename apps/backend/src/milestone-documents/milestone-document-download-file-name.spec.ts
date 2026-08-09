// 합성 데이터만 사용한다 (docs/rules/security.md)
import {
  milestoneDocumentArchiveFolderName,
  milestoneDocumentDownloadFileName,
  milestoneDocumentTextEntryFileName,
} from './milestone-document-download-file-name';

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

describe('milestoneDocumentTextEntryFileName', () => {
  it.each<[string, string, string]>([
    // [팀명, 서류명, ZIP에 담길 이름]
    ['합성팀', '팀 활동 보고', '합성팀_팀 활동 보고.txt'],
    // 경로 구분자·헤더 구분자는 파일 제출과 같은 규칙으로 `_`가 된다.
    ['a/b\\c', 'x:y', 'a_b_c_x_y.txt'],
    ['합성\r\n팀', '보고"; x=1', '합성__팀_보고__ x=1.txt'],
    // 빈 이름·점뿐인 이름은 폴백으로 접는다(경로로 읽히면 안 된다).
    ['   ', '..', 'file_file.txt'],
  ])(
    '팀명 %p · 서류명 %p은 `%s`로 담는다 — 원본 파일이 없으므로 확장자는 .txt로 고정한다',
    (teamName, documentName, expected) => {
      // Given / When
      const result = milestoneDocumentTextEntryFileName({
        teamName,
        documentName,
      });

      // Then
      expect(result).toBe(expected);
    },
  );

  it('파일 제출과 `팀명_서류명` 부분을 그대로 공유한다', () => {
    // Given: 같은 마일스톤의 산출물이 제출 방식에 따라 다른 이름 규칙으로 섞이면 사업단이
    // 모아 놓고 정렬할 수 없다.
    const names = { teamName: '가나다팀', documentName: '계획서' };

    // When
    const textEntry = milestoneDocumentTextEntryFileName(names);
    const fileEntry = milestoneDocumentDownloadFileName({
      ...names,
      originalFileName: 'plan.pdf',
    });

    // Then
    expect(textEntry).toBe('가나다팀_계획서.txt');
    expect(fileEntry).toBe('가나다팀_계획서.pdf');
  });
});

describe('milestoneDocumentArchiveFolderName', () => {
  it.each<[string, string]>([
    // [폴더로 쓸 원본 이름, ZIP 안 폴더 한 칸의 이름]
    // 경로 구분자가 살아남으면 의도하지 않은 하위 경로가 생긴다(zip slip).
    ['a/b', 'a_b'],
    ['a\\b', 'a_b'],
    ['../../etc', '.._.._etc'],
    // 점만 남은 이름은 상위 폴더로 읽히므로 폴백으로 바꾼다.
    ['..', 'file'],
    ['.', 'file'],
    ['...', 'file'],
    ['', 'file'],
    ['   ', 'file'],
    // 한글은 살아남는다 — 폴더 이름이 통째로 `_`가 되면 팀을 구분할 수 없다.
    ['가나다팀', '가나다팀'],
    ['개인정보 수집·이용 동의서', '개인정보 수집·이용 동의서'],
    // 제어문자는 항상 치환하고 연속 공백은 한 칸으로 접는다.
    ['합성\r\n팀', '합성__팀'],
    ['팀  이름', '팀 이름'],
  ])('폴더 이름 %p은 `%s`가 된다', (value, expected) => {
    // Given / When
    const result = milestoneDocumentArchiveFolderName(value);

    // Then
    expect(result).toBe(expected);
    expect(result).not.toContain('/');
    expect(result).not.toContain('\\');
    expect(result).not.toBe('..');
  });
});
