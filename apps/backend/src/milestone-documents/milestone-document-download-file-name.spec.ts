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

/**
 * 이름 한 칸을 100자로 자르는 방어.
 *
 * 「이상한 입력」을 막는 것이 아니라 **정상 입력**을 막는다 — DTO가 팀 이름 100자
 * (`create-application-request.dto.ts`), 서류 이름 200자(`upsert-milestone-document-request.dto.ts`)를
 * 허용하므로 자르지 않으면 `팀명_서류명`이 301자가 되고, NTFS의 이름 한 칸 상한(255)을 넘겨
 * 교직원이 받은 ZIP이 Windows에서 풀리지 않는다.
 */
describe('이름 한 칸의 길이 자르기', () => {
  /** NTFS·APFS·ext4가 공통으로 두는 이름 한 칸 상한. 경로 전체가 아니라 한 칸 기준이다. */
  const MAX_FILE_SYSTEM_NAME_LENGTH = 255;

  /**
   * 반쪽만 남은 서러게이트(짝 잃은 UTF-16 단위)가 있는지 본다. 코드포인트 단위로 순회하므로
   * 짝이 맞는 이모지는 길이 2의 조각으로, 반쪽만 남은 것은 길이 1의 서러게이트로 나온다.
   */
  const hasLoneSurrogate = (value: string): boolean =>
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return character.length === 1 && code >= 0xd800 && code <= 0xdfff;
    });

  it('DTO가 허용하는 최대 길이(팀 100자·서류 200자)로도 파일 시스템 상한을 넘지 않는다', () => {
    // Given: 둘 다 검증을 통과하는 정상 입력이다 — 여기서 넘치면 아무도 잘못하지 않았는데 깨진다.
    const input = {
      teamName: '가'.repeat(100),
      documentName: '나'.repeat(200),
      originalFileName: 'plan.pdf',
    };

    // When
    const result = milestoneDocumentDownloadFileName(input);

    // Then: 100 + `_` + 100 + `.pdf` = 205자.
    expect(result).toBe(`${'가'.repeat(100)}_${'나'.repeat(100)}.pdf`);
    expect(result.length).toBe(205);
    expect(result.length).toBeLessThanOrEqual(MAX_FILE_SYSTEM_NAME_LENGTH);
  });

  it('글·릴리스 제출의 .txt 이름도 같은 길이로 자른다', () => {
    // Given: 파일 제출과 이름 규칙을 공유하므로 길이 방어도 같이 걸려야 한다.
    const result = milestoneDocumentTextEntryFileName({
      teamName: '가'.repeat(100),
      documentName: '나'.repeat(200),
    });

    // Then
    expect(result).toBe(`${'가'.repeat(100)}_${'나'.repeat(100)}.txt`);
    expect(result.length).toBeLessThanOrEqual(MAX_FILE_SYSTEM_NAME_LENGTH);
  });

  it('ZIP 안 폴더 한 칸도 100자로 자른다', () => {
    // Given / When
    const result = milestoneDocumentArchiveFolderName('가'.repeat(150));

    // Then
    expect(result).toBe('가'.repeat(100));
    expect([...result]).toHaveLength(100);
  });

  it('100자 경계에 서러게이트 쌍(이모지)이 걸려도 반쪽 글자를 남기지 않는다', () => {
    // Given: 99번째까지 한글, 100번째가 이모지다. UTF-16 단위로 자르면 이모지의 앞쪽 절반만
    // 남아 깨진 글자(�)가 된다 — 코드포인트 단위로 잘라야 통째로 살거나 통째로 없어진다.
    const value = `${'가'.repeat(99)}😀${'나'.repeat(10)}`;

    // When
    const result = milestoneDocumentArchiveFolderName(value);

    // Then
    expect(result).toBe(`${'가'.repeat(99)}😀`);
    expect([...result]).toHaveLength(100);
    expect(hasLoneSurrogate(result)).toBe(false);
  });

  it('자른 자리에 이모지 시작이 걸리면 그 이모지는 통째로 빠진다', () => {
    // Given: 100번째까지 한글이고 101번째가 이모지다.
    const value = `${'가'.repeat(100)}😀나`;

    // When
    const result = milestoneDocumentArchiveFolderName(value);

    // Then: 반쪽이 남는 대신 아예 들어오지 않는다.
    expect(result).toBe('가'.repeat(100));
    expect(hasLoneSurrogate(result)).toBe(false);
  });

  it('자르고 나서 끝에 `.`이 걸리면 그 점도 떼어 낸다', () => {
    // Given: 100번째 글자가 `.`이다. 끝의 `.`은 Windows가 이름에 담지 못하므로 자르기가
    // 만들어 낸 `.`도 자르기 **뒤에** 떼어야 한다.
    const value = `${'가'.repeat(99)}...${'나'.repeat(10)}`;

    // When
    const result = milestoneDocumentArchiveFolderName(value);

    // Then
    expect(result).toBe('가'.repeat(99));
    expect(result.endsWith('.')).toBe(false);
  });

  it('자르고 나서 끝에 공백이 걸리면 그 공백도 떼어 낸다', () => {
    // Given: 100번째 글자가 공백이다 — 끝 공백도 Windows가 조용히 지워 이름이 달라진다.
    const value = `${'가'.repeat(99)} ${'나'.repeat(10)}`;

    // When
    const result = milestoneDocumentArchiveFolderName(value);

    // Then
    expect(result).toBe('가'.repeat(99));
    expect(result.endsWith(' ')).toBe(false);
  });

  it('100자 이하는 그대로 둔다 — 필요 없는 자르기는 하지 않는다', () => {
    // Given / When
    const result = milestoneDocumentArchiveFolderName('가'.repeat(100));

    // Then
    expect(result).toBe('가'.repeat(100));
  });
});

/**
 * Windows 예약 장치 이름 회피.
 *
 * 폴더 이름은 팀 이름(또는 서류 이름) **그 자체**라 한 낱말이 될 수 있다. `CON`인 팀이 하나
 * 있으면 Windows에서 그 팀 폴더만 통째로 풀리지 않고, 그것은 압축을 푸는 쪽에서 조용히
 * 일어나는 실패라 서버는 모른다.
 */
describe('milestoneDocumentArchiveFolderName — Windows 예약 장치 이름', () => {
  it.each<[string, string]>([
    // [원본 이름, 비껴간 이름]
    ['CON', 'CON_'],
    ['PRN', 'PRN_'],
    ['AUX', 'AUX_'],
    ['NUL', 'NUL_'],
    ['COM1', 'COM1_'],
    ['COM9', 'COM9_'],
    ['LPT1', 'LPT1_'],
    ['LPT9', 'LPT9_'],
    // 대소문자를 가리지 않는다 — Windows의 이름 비교가 대소문자를 가리지 않기 때문이다.
    ['con', 'con_'],
    ['Nul', 'Nul_'],
    ['cOm1', 'cOm1_'],
    // 확장자가 붙어도 예약은 예약이다. 전체 문자열만 비교하면 이 이름들이 그대로 통과한다.
    ['CON.txt', 'CON.txt_'],
    ['NUL.pdf', 'NUL.pdf_'],
    ['com1.hwp.zip', 'com1.hwp.zip_'],
    // 끝의 `.`이 먼저 떨어져 나가 예약 이름이 드러나는 경우도 잡는다.
    ['CON.', 'CON_'],
  ])('예약 이름 %p은 `%s`로 비껴간다', (value, expected) => {
    // Given / When
    const result = milestoneDocumentArchiveFolderName(value);

    // Then
    expect(result).toBe(expected);
  });

  it.each<[string]>([
    // 예약 목록에 없는 이름을 건드리면 팀 이름이 이유 없이 달라진다(과잉 회피).
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
    // Given / When
    const result = milestoneDocumentArchiveFolderName(value);

    // Then
    expect(result).toBe(value);
  });

  it('`팀명_서류명` 파일 이름에는 예약 회피를 걸지 않는다 — `_`로 이어져 한 낱말이 될 수 없다', () => {
    // Given: 팀도 서류도 예약 이름이지만 이어 붙은 결과는 `CON_NUL`이라 예약이 아니다.
    const input = {
      teamName: 'CON',
      documentName: 'NUL',
      originalFileName: 'plan.pdf',
    };

    // When
    const result = milestoneDocumentDownloadFileName(input);

    // Then: 필요 없는 `_`가 더 붙지 않는다.
    expect(result).toBe('CON_NUL.pdf');
  });
});

/**
 * 보이지 않는 서식 문자 치환.
 *
 * `계획서\u202egpj.exe` 같은 이름은 탐색기에서 `계획서exe.jpg`로 **뒤집혀 보인다.** 「보이는 이름」과
 * 「실제 이름」이 갈리는 것 자체가 이 모듈이 없애려는 상태다. 폭 없는 공백은 서로 다른 두 팀
 * 이름을 육안으로 같아 보이게 만든다.
 */
describe('보이지 않는 서식 문자', () => {
  // 눈에 안 보이는 글자는 소스에 그대로 적으면 편집기·diff에서 사라지므로 escape로 적는다.
  const RTL_OVERRIDE = '\u202e';
  const ZERO_WIDTH_SPACE = '\u200b';

  it.each<[string, string]>([
    // [글자 이름, 팀 이름 가운데 끼워 넣을 글자]
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
    // Given / When
    const result = milestoneDocumentArchiveFolderName(`가나${invisible}다팀`);

    // Then: 남겨 두면 두 팀 이름이 육안으로 같아 보인다.
    expect(result).toBe('가나_다팀');
    expect(result).not.toContain(invisible);
  });

  it('오른쪽 정렬 재정의로 확장자가 뒤집혀 보이는 이름을 그대로 담지 않는다', () => {
    // Given: 탐색기에서 `계획서exe.jpg`로 보이지만 실제 이름은 `계획서<RLO>gpj`다.
    const input = {
      teamName: '합성팀',
      documentName: `계획서${RTL_OVERRIDE}gpj`,
      originalFileName: 'plan.pdf',
    };

    // When
    const result = milestoneDocumentDownloadFileName(input);

    // Then
    expect(result).toBe('합성팀_계획서_gpj.pdf');
    expect(result).not.toContain(RTL_OVERRIDE);
  });

  it('원본 파일명의 확장자에 섞인 서식 문자도 치환한다', () => {
    // Given
    const input = {
      teamName: '합성팀',
      documentName: '계획서',
      originalFileName: `plan.p${ZERO_WIDTH_SPACE}df`,
    };

    // When
    const result = milestoneDocumentDownloadFileName(input);

    // Then
    expect(result).toBe('합성팀_계획서.p_df');
  });

  it.each<[string]>([
    // 눈에 보이는 글자를 건드리면 팀 이름이 이유 없이 달라진다(과잉 치환).
    ['가나다팀'],
    ['개인정보 수집·이용 동의서'],
    ['Team ABC 123'],
    ['팀 이름 2026'],
    ['a-b(1)'],
    ['emoji 😀 팀'],
  ])('한글·영문·숫자·공백이 섞인 %p은 그대로 살아남는다', (value) => {
    // Given / When
    const result = milestoneDocumentArchiveFolderName(value);

    // Then
    expect(result).toBe(value);
    expect(result).not.toContain('_');
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
