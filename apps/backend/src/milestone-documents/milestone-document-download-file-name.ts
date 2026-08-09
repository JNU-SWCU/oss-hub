/**
 * 교직원이 학생 제출 파일을 내려받을 때 붙는 이름을 `팀명_서류명.확장자`로 다시 만든다.
 * 학생이 올린 원본 이름(`최종_진짜최종.hwp` 등)은 사업단이 모아 두면 서로 구분되지 않으므로
 * 다운로드 시점에 팀과 서류로 식별되는 이름으로 바꾼다. 순수 함수로 둔 이유는 ZIP 일괄
 * 내려받기가 같은 규칙을 그대로 재사용해야 하기 때문이다.
 *
 * 확장자는 원본 파일명에서만 가져온다(마지막 `.` 뒤). 원본에 확장자가 없으면 붙이지 않는다.
 *
 * controller의 `asciiFallbackFileName`은 ASCII 폴백 전용이라 한글을 모두 `_`로 지운다.
 * 여기서는 한글을 살려야 하므로 경로 구분자·제어문자·헤더 구분자만 골라 `_`로 바꾼다.
 * RFC 5987 인코딩은 `attachmentDisposition()`이 이어서 처리한다.
 */

/** 파일명·Content-Disposition에서 위험한 글자. 그 밖의 글자(한글 포함)는 그대로 남긴다. */
const UNSAFE_CHARACTERS = new Set([
  '/',
  '\\',
  ':',
  '*',
  '?',
  '"',
  '<',
  '>',
  '|',
  ';',
  ',',
  "'",
]);

const FALLBACK_SEGMENT = 'file';

/**
 * 이름 한 칸(팀명·서류명)의 최대 길이, **UTF-16 코드 단위**. 둘을 `_`로 이어도 201이라
 * NTFS의 이름 한 칸 상한(255)에 확장자까지 넣고도 남는다.
 */
const MAX_SEGMENT_UNITS = 100;

/**
 * Windows가 이름으로 쓸 수 없는 예약 장치 이름(대소문자 무관). 규격은 Win32 파일 이름 규칙이고
 * 이 목록이 전부다 — 실제 Windows에서 확인한 것이 아니라 규칙을 옮긴 것이라는 점을 밝혀 둔다.
 */
const WINDOWS_RESERVED_NAMES: ReadonlySet<string> = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_unused, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_unused, index) => `LPT${index + 1}`),
]);

export interface MilestoneDocumentDownloadFileNameInput {
  readonly teamName: string;
  readonly documentName: string;
  readonly originalFileName: string;
}

export function milestoneDocumentDownloadFileName(
  input: MilestoneDocumentDownloadFileNameInput,
): string {
  return `${baseName(input)}${extensionOf(input.originalFileName)}`;
}

/**
 * 글·저장소 릴리스로 낸 제출을 ZIP에 **파일로** 담을 때의 이름 — `팀명_서류명.txt`.
 *
 * 원본 파일이 없으므로 확장자를 가져올 곳이 없어 여기서 `.txt`로 고정한다. 파일 제출과
 * `팀명_서류명` 부분을 공유하는 것이 요점이다 — 같은 마일스톤의 산출물이 제출 방식에 따라
 * 다른 이름 규칙으로 섞이면 사업단이 모아 놓고 정렬할 수 없다.
 */
export function milestoneDocumentTextEntryFileName(
  input: Omit<MilestoneDocumentDownloadFileNameInput, 'originalFileName'>,
): string {
  return `${baseName(input)}.txt`;
}

/**
 * ZIP 안 폴더 한 칸(팀명 또는 서류명)의 이름. 파일명과 **같은 치환 규칙**을 쓰고, 거기에
 * Windows 예약 장치 이름을 한 겹 더 피한다 — 폴더만 규칙이 다르면 `/`가 살아남아 의도하지
 * 않은 하위 경로가 생긴다(zip slip).
 *
 * ⚠ 예약 이름 회피가 **`팀명_서류명` 파일명에는 필요 없는** 이유: 그 이름은 언제나 `_`로 이어져
 * `CON`·`NUL` 같은 한 낱말과 같아질 수 없다. 반면 폴더는 팀 이름(또는 서류 이름) **그 자체**이고
 * 팀 이름은 학생이 정하므로, `CON`인 팀이 하나 있으면 **Windows에서 그 팀 폴더만 통째로 풀리지
 * 않는다.** 압축을 푸는 사람 쪽에서 조용히 일어나는 실패라 우리는 모른다.
 *
 * ⚠ 이름이 「한 낱말」인 자리가 하나 더 있다 — **내려받는 ZIP 파일 이름의 마일스톤 부분**
 * (`milestone-document-archive.service.ts`의 `archiveFileName`)이 이 함수를 쓴다. 그래서 함수
 * 이름이 `Folder`지만 폴더 전용이 아니다.
 */
export function milestoneDocumentArchiveFolderName(value: string): string {
  const segment = safeSegment(value);
  /*
   * 예약 여부는 **첫 `.` 앞부분**으로 판정한다. Windows에서 장치 이름은 확장자가 붙어도
   * 그대로 예약이라 `CON.txt`·`NUL.pdf`도 만들 수 없다 — 전체 문자열만 비교하면 그 이름들이
   * 그대로 통과해 폴더가 안 풀린다.
   */
  const stem = segment.split('.')[0] ?? segment;
  return WINDOWS_RESERVED_NAMES.has(normalizeDeviceDigits(stem).toUpperCase())
    ? `${segment}_`
    : segment;
}

/**
 * 예약 이름 판정 **직전에만** 쓰는 정규화 — `COM¹`·`LPT²` 같은 위첨자 숫자를 보통 숫자로 편다.
 *
 * Windows의 장치 이름 판정은 `COM1` 뿐 아니라 위첨자 `¹`·`²`·`³`도 같은 장치 번호로 읽는다.
 * 그래서 `COM¹` 폴더는 만들어지지 않는데 우리 목록에는 안 걸린다. ⚠ 이것도 Win32 규칙을 옮긴
 * 것이고 실제 Windows에서 확인한 것은 아니다 — 다만 틀렸을 때 잃는 것이 `_` 하나뿐이라 건다.
 *
 * 판정에만 쓰고 **실제 이름은 바꾸지 않는다.** 교직원이 보는 이름은 학생이 적은 그대로여야 한다.
 */
function normalizeDeviceDigits(value: string): string {
  return value.replace(/[¹²³]/g, (character) =>
    String({ '¹': 1, '²': 2, '³': 3 }[character] ?? character),
  );
}

function baseName(
  input: Omit<MilestoneDocumentDownloadFileNameInput, 'originalFileName'>,
): string {
  return `${safeSegment(input.teamName)}_${safeSegment(input.documentName)}`;
}

function replaceUnsafe(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      // 제어문자(C0 + DEL)는 헤더를 쪼갤 수 있으므로 항상 치환한다.
      if (code < 0x20 || code === 0x7f) return '_';
      if (isInvisibleFormatting(code)) return '_';
      return UNSAFE_CHARACTERS.has(character) ? '_' : character;
    })
    .join('');
}

/**
 * 눈에 안 보이면서 **이름이 다르게 보이게 만드는** 글자 — 폭 없는 공백과 양방향 재정의다.
 *
 * 왜 막는가: `계획서‮gpj.exe` 같은 이름은 탐색기에서 `계획서exe.jpg`로 **뒤집혀 보인다.**
 * 실제 확장자는 원본 파일명에서만 오고 업로드가 허용 목록으로 막혀 있어 진짜 실행 파일을 심을
 * 수는 없지만, 「보이는 이름」과 「실제 이름」이 갈리는 것 자체가 이 모듈이 없애려는 상태다.
 * 폭 없는 공백은 서로 다른 두 팀 이름을 육안으로 같아 보이게 만든다.
 */
function isInvisibleFormatting(code: number): boolean {
  return (
    (code >= 0x200b && code <= 0x200f) || // ZWSP·ZWNJ·ZWJ·LRM·RLM
    (code >= 0x202a && code <= 0x202e) || // 양방향 embedding·override
    (code >= 0x2066 && code <= 0x2069) || // 양방향 isolate
    code === 0xfeff // BOM(폭 없는 비분리 공백)
  );
}

function safeSegment(value: string): string {
  const normalized = truncate(replaceUnsafe(value).replace(/\s+/g, ' ').trim())
    // 끝의 `.`은 Windows가 이름에 담지 못한다 — `코드나무.`은 파일도 폴더도 만들 수 없어
    // 압축을 푸는 쪽에서 실패하거나 말없이 다른 이름이 된다. 여기서 미리 떼어 낸다.
    // **자른 뒤에** 떼어야 자르다가 끝에 걸린 `.`도 함께 없어진다.
    .replace(/\.+$/, '')
    .trim();
  // 점만 남은 이름(`.`·`..`)은 경로로 읽힐 수 있어 폴백으로 바꾼다(위에서 빈 값이 된다).
  if (normalized.length === 0 || /^\.+$/.test(normalized)) {
    return FALLBACK_SEGMENT;
  }
  return normalized;
}

/**
 * 이름 한 칸의 길이를 자른다.
 *
 * 자르지 않으면 **정상 입력만으로 풀리지 않는 ZIP이 나온다** — 팀 이름은 100, 서류 이름은
 * 200까지 허용되므로 `팀명_서류명`이 301이 될 수 있는데 NTFS의 이름 한 칸 상한은 255다.
 * 잘라서 생기는 이름 충돌은 뒤따르는 중복 회피(` (2)`)가 받아 준다.
 *
 * ⚠ **세는 단위가 UTF-16 코드 단위**여야 한다. 파일 시스템이 그 단위로 세기 때문이다 —
 * 글자 수로 세면 이모지 하나가 2를 먹으므로 「100자」가 200이 되어 상한 보장이 깨진다.
 * 그렇다고 UTF-16 단위로 뚝 자르면 서러게이트 쌍이 반쪽만 남아 깨진 글자가 되므로,
 * **글자 경계를 지키면서 단위로 센다.** 전체 이름은 동봉 `제출현황.csv`에 그대로 남는다.
 */
function truncate(value: string): string {
  if (value.length <= MAX_SEGMENT_UNITS) return value;
  let units = 0;
  let cut = '';
  for (const character of value) {
    if (units + character.length > MAX_SEGMENT_UNITS) break;
    units += character.length;
    cut += character;
  }
  return cut.trim();
}

/** 원본 파일명의 확장자(선행 `.` 포함). 확장자가 없으면 빈 문자열. */
function extensionOf(originalFileName: string): string {
  const dot = originalFileName.lastIndexOf('.');
  if (dot <= 0 || dot === originalFileName.length - 1) return '';
  const extension = replaceUnsafe(originalFileName.slice(dot + 1)).replace(
    /\s+/g,
    '',
  );
  return extension.length > 0 ? `.${extension}` : '';
}
