import {
  milestoneDocumentArchiveFolderName,
  milestoneDocumentDownloadFileName,
  milestoneDocumentTextEntryFileName,
} from './milestone-document-download-file-name';

describe('milestoneDocumentDownloadFileName', () => {
  it('학생이 올린 원본 이름과 무관하게 `팀명_서류명.확장자`로 다시 붙인다', () => {
    const input = {
      teamName: '합성팀',
      documentName: '개인정보 수집·이용 동의서',
      originalFileName: '최종_진짜최종.hwp',
    };

    const result = milestoneDocumentDownloadFileName(input);

    expect(result).toBe('합성팀_개인정보 수집·이용 동의서.hwp');
  });

  it('확장자는 원본 파일명의 마지막 점 뒤에서 가져온다', () => {
    const input = {
      teamName: '합성팀',
      documentName: '계획서',
      originalFileName: 'plan.v2.final.pdf',
    };

    const result = milestoneDocumentDownloadFileName(input);

    expect(result).toBe('합성팀_계획서.pdf');
  });

  it('원본에 확장자가 없으면 확장자를 붙이지 않는다', () => {
    const input = {
      teamName: '합성팀',
      documentName: '계획서',
      originalFileName: '확장자없음',
    };

    const result = milestoneDocumentDownloadFileName(input);

    expect(result).toBe('합성팀_계획서');
  });

  it('숨김 파일처럼 점으로 시작하기만 하는 이름은 확장자로 보지 않는다', () => {
    const input = {
      teamName: '합성팀',
      documentName: '계획서',
      originalFileName: '.hwp',
    };

    const result = milestoneDocumentDownloadFileName(input);

    expect(result).toBe('합성팀_계획서');
  });

  it('점으로 끝나면 빈 확장자를 붙이지 않는다', () => {
    const input = {
      teamName: '합성팀',
      documentName: '계획서',
      originalFileName: 'plan.',
    };

    const result = milestoneDocumentDownloadFileName(input);

    expect(result).toBe('합성팀_계획서');
  });

  it('팀명·서류명의 경로 구분자를 `_`로 바꿔 경로로 읽히지 않게 한다', () => {
    const input = {
      teamName: '../../etc',
      documentName: 'a/b\\c',
      originalFileName: 'plan.pdf',
    };

    const result = milestoneDocumentDownloadFileName(input);

    expect(result).toBe('.._.._etc_a_b_c.pdf');
    expect(result).not.toContain('/');
    expect(result).not.toContain('\\');
  });

  it('제어문자와 헤더 구분자(`"`·`;`)를 `_`로 바꾼다', () => {
    const input = {
      teamName: '합성\r\n팀',
      documentName: '동의서"; x=1',
      originalFileName: 'plan.pdf',
    };

    const result = milestoneDocumentDownloadFileName(input);

    expect(result).toBe('합성__팀_동의서__ x=1.pdf');
    expect(result).not.toContain('"');
    expect(result).not.toContain(';');
    expect(result).not.toContain('\r');
    expect(result).not.toContain('\n');
  });

  it('한글은 지우지 않는다 — ASCII 폴백 규칙(asciiFallbackFileName)과 다르다', () => {
    const input = {
      teamName: '가나다팀',
      documentName: '팀 구성 확인서',
      originalFileName: 'x.png',
    };

    const result = milestoneDocumentDownloadFileName(input);

    expect(result).toBe('가나다팀_팀 구성 확인서.png');
  });

  it('팀명·서류명이 비었거나 점뿐이면 폴백 이름을 쓴다', () => {
    const input = {
      teamName: '   ',
      documentName: '..',
      originalFileName: 'plan.pdf',
    };

    const result = milestoneDocumentDownloadFileName(input);

    expect(result).toBe('file_file.pdf');
  });

  it('확장자에 섞인 위험한 글자도 정규화한다', () => {
    const input = {
      teamName: '합성팀',
      documentName: '계획서',
      originalFileName: 'plan.pd/f',
    };

    const result = milestoneDocumentDownloadFileName(input);

    expect(result).toBe('합성팀_계획서.pd_f');
  });
});

describe('이름 한 칸의 길이 자르기', () => {
  const MAX_FILE_SYSTEM_NAME_LENGTH = 255;

  const hasLoneSurrogate = (value: string): boolean =>
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return character.length === 1 && code >= 0xd800 && code <= 0xdfff;
    });

  it('DTO가 허용하는 최대 길이(팀 100자·서류 200자)로도 파일 시스템 상한을 넘지 않는다', () => {
    const input = {
      teamName: '가'.repeat(100),
      documentName: '나'.repeat(200),
      originalFileName: 'plan.pdf',
    };

    const result = milestoneDocumentDownloadFileName(input);

    expect(result).toBe(`${'가'.repeat(100)}_${'나'.repeat(100)}.pdf`);
    expect(result.length).toBe(205);
    expect(result.length).toBeLessThanOrEqual(MAX_FILE_SYSTEM_NAME_LENGTH);
  });

  it('글 제출의 .txt 이름도 같은 길이로 자른다', () => {
    const result = milestoneDocumentTextEntryFileName({
      teamName: '가'.repeat(100),
      documentName: '나'.repeat(200),
    });

    expect(result).toBe(`${'가'.repeat(100)}_${'나'.repeat(100)}.txt`);
    expect(result.length).toBeLessThanOrEqual(MAX_FILE_SYSTEM_NAME_LENGTH);
  });

  it('ZIP 안 폴더 한 칸도 100자로 자른다', () => {
    const result = milestoneDocumentArchiveFolderName('가'.repeat(150));

    expect(result).toBe('가'.repeat(100));
    expect([...result]).toHaveLength(100);
  });

  it('경계에 서러게이트 쌍(이모지)이 걸려도 반쪽 글자를 남기지 않는다', () => {
    const value = `${'가'.repeat(98)}😀${'나'.repeat(10)}`;

    const result = milestoneDocumentArchiveFolderName(value);

    expect(result).toBe(`${'가'.repeat(98)}😀`);
    expect(result.length).toBe(100);
    expect(hasLoneSurrogate(result)).toBe(false);
  });

  it('세는 단위가 글자 수가 아니라 UTF-16 코드 단위다 — 이모지는 둘을 먹는다', () => {
    const result = milestoneDocumentDownloadFileName({
      teamName: '😀'.repeat(50),
      documentName: '😀'.repeat(100),
      originalFileName: 'a.pdf',
    });

    expect(result.length).toBeLessThanOrEqual(MAX_FILE_SYSTEM_NAME_LENGTH);
    expect(hasLoneSurrogate(result)).toBe(false);

    expect(result).toBe(`${'😀'.repeat(50)}_${'😀'.repeat(50)}.pdf`);
  });

  it('자른 자리에 이모지 시작이 걸리면 그 이모지는 통째로 빠진다', () => {
    const value = `${'가'.repeat(99)}😀나`;

    const result = milestoneDocumentArchiveFolderName(value);

    expect(result).toBe('가'.repeat(99));
    expect(hasLoneSurrogate(result)).toBe(false);
  });

  it('자르고 나서 끝에 `.`이 걸리면 그 점도 떼어 낸다', () => {
    const value = `${'가'.repeat(99)}...${'나'.repeat(10)}`;

    const result = milestoneDocumentArchiveFolderName(value);

    expect(result).toBe('가'.repeat(99));
    expect(result.endsWith('.')).toBe(false);
  });

  it('자르고 나서 끝에 공백이 걸리면 그 공백도 떼어 낸다', () => {
    const value = `${'가'.repeat(99)} ${'나'.repeat(10)}`;

    const result = milestoneDocumentArchiveFolderName(value);

    expect(result).toBe('가'.repeat(99));
    expect(result.endsWith(' ')).toBe(false);
  });

  it('위첨자 숫자로 적은 장치 이름도 비켜 간다', () => {
    expect(milestoneDocumentArchiveFolderName('COM¹')).toBe('COM¹_');
    expect(milestoneDocumentArchiveFolderName('lpt²')).toBe('lpt²_');
    expect(milestoneDocumentArchiveFolderName('COM³.txt')).toBe('COM³.txt_');

    expect(milestoneDocumentArchiveFolderName('COM¹')).toContain('¹');

    expect(milestoneDocumentArchiveFolderName('가¹팀')).toBe('가¹팀');
  });

  it('100자 이하는 그대로 둔다 — 필요 없는 자르기는 하지 않는다', () => {
    const result = milestoneDocumentArchiveFolderName('가'.repeat(100));

    expect(result).toBe('가'.repeat(100));
  });
});

describe('milestoneDocumentArchiveFolderName — Windows 예약 장치 이름', () => {
  it.each<[string, string]>([
    ['CON', 'CON_'],
    ['PRN', 'PRN_'],
    ['AUX', 'AUX_'],
    ['NUL', 'NUL_'],
    ['COM1', 'COM1_'],
    ['COM9', 'COM9_'],
    ['LPT1', 'LPT1_'],
    ['LPT9', 'LPT9_'],

    ['con', 'con_'],
    ['Nul', 'Nul_'],
    ['cOm1', 'cOm1_'],

    ['CON.txt', 'CON.txt_'],
    ['NUL.pdf', 'NUL.pdf_'],
    ['com1.hwp.zip', 'com1.hwp.zip_'],

    ['CON.', 'CON_'],
  ])('예약 이름 %p은 `%s`로 비껴간다', (value, expected) => {
    const result = milestoneDocumentArchiveFolderName(value);

    expect(result).toBe(expected);
  });

  it.each<[string]>([
    ['CONSOLE'],
    ['CONTENT'],
    ['CONSOLE.txt'],
    ['COM0'],
    ['COM10'],
    ['LPT0'],
    ['NULL'],
    ['가나다팀'],
    ['CON팀'],
    ['CON 1'],
    ['team-CON'],
  ])('예약이 아닌 이름 %p은 그대로 둔다', (value) => {
    const result = milestoneDocumentArchiveFolderName(value);

    expect(result).toBe(value);
  });

  it('`팀명_서류명` 파일 이름에는 예약 회피를 걸지 않는다 — `_`로 이어져 한 낱말이 될 수 없다', () => {
    const input = {
      teamName: 'CON',
      documentName: 'NUL',
      originalFileName: 'plan.pdf',
    };

    const result = milestoneDocumentDownloadFileName(input);

    expect(result).toBe('CON_NUL.pdf');
  });
});

describe('보이지 않는 서식 문자', () => {
  const RTL_OVERRIDE = '\u202e';
  const ZERO_WIDTH_SPACE = '\u200b';

  it.each<[string, string]>([
    ['ZWSP(U+200B)', '\u200b'],
    ['ZWNJ(U+200C)', '\u200c'],
    ['ZWJ(U+200D)', '\u200d'],
    ['LRM(U+200E)', '\u200e'],
    ['RLM(U+200F)', '\u200f'],
    ['LRE(U+202A)', '\u202a'],
    ['RLO(U+202E)', '\u202e'],
    ['LRI(U+2066)', '\u2066'],
    ['PDI(U+2069)', '\u2069'],
    ['BOM(U+FEFF)', '\ufeff'],
  ])('%s는 `_`로 바꾼다', (_name, invisible) => {
    const result = milestoneDocumentArchiveFolderName(`가나${invisible}다팀`);

    expect(result).toBe('가나_다팀');
    expect(result).not.toContain(invisible);
  });

  it('오른쪽 정렬 재정의로 확장자가 뒤집혀 보이는 이름을 그대로 담지 않는다', () => {
    const input = {
      teamName: '합성팀',
      documentName: `계획서${RTL_OVERRIDE}gpj`,
      originalFileName: 'plan.pdf',
    };

    const result = milestoneDocumentDownloadFileName(input);

    expect(result).toBe('합성팀_계획서_gpj.pdf');
    expect(result).not.toContain(RTL_OVERRIDE);
  });

  it('원본 파일명의 확장자에 섞인 서식 문자도 치환한다', () => {
    const input = {
      teamName: '합성팀',
      documentName: '계획서',
      originalFileName: `plan.p${ZERO_WIDTH_SPACE}df`,
    };

    const result = milestoneDocumentDownloadFileName(input);

    expect(result).toBe('합성팀_계획서.p_df');
  });

  it.each<[string]>([
    ['가나다팀'],
    ['개인정보 수집·이용 동의서'],
    ['Team ABC 123'],
    ['팀 이름 2026'],
    ['a-b(1)'],
    ['emoji 😀 팀'],
  ])('한글·영문·숫자·공백이 섞인 %p은 그대로 살아남는다', (value) => {
    const result = milestoneDocumentArchiveFolderName(value);

    expect(result).toBe(value);
    expect(result).not.toContain('_');
  });
});

describe('milestoneDocumentTextEntryFileName', () => {
  it.each<[string, string, string]>([
    ['합성팀', '팀 활동 보고', '합성팀_팀 활동 보고.txt'],

    ['a/b\\c', 'x:y', 'a_b_c_x_y.txt'],
    ['합성\r\n팀', '보고"; x=1', '합성__팀_보고__ x=1.txt'],

    ['   ', '..', 'file_file.txt'],
  ])(
    '팀명 %p · 서류명 %p은 `%s`로 담는다 — 원본 파일이 없으므로 확장자는 .txt로 고정한다',
    (teamName, documentName, expected) => {
      const result = milestoneDocumentTextEntryFileName({
        teamName,
        documentName,
      });

      expect(result).toBe(expected);
    },
  );

  it('파일 제출과 `팀명_서류명` 부분을 그대로 공유한다', () => {
    const names = { teamName: '가나다팀', documentName: '계획서' };

    const textEntry = milestoneDocumentTextEntryFileName(names);
    const fileEntry = milestoneDocumentDownloadFileName({
      ...names,
      originalFileName: 'plan.pdf',
    });

    expect(textEntry).toBe('가나다팀_계획서.txt');
    expect(fileEntry).toBe('가나다팀_계획서.pdf');
  });
});

describe('milestoneDocumentArchiveFolderName', () => {
  it.each<[string, string]>([
    ['a/b', 'a_b'],
    ['a\\b', 'a_b'],
    ['../../etc', '.._.._etc'],

    ['..', 'file'],
    ['.', 'file'],
    ['...', 'file'],
    ['', 'file'],
    ['   ', 'file'],

    ['가나다팀', '가나다팀'],
    ['개인정보 수집·이용 동의서', '개인정보 수집·이용 동의서'],

    ['합성\r\n팀', '합성__팀'],
    ['팀  이름', '팀 이름'],
  ])('폴더 이름 %p은 `%s`가 된다', (value, expected) => {
    const result = milestoneDocumentArchiveFolderName(value);

    expect(result).toBe(expected);
    expect(result).not.toContain('/');
    expect(result).not.toContain('\\');
    expect(result).not.toBe('..');
  });
});
