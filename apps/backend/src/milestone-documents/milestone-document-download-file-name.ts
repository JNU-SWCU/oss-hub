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
 * ⚠ 예약 이름 회피가 **파일명이 아니라 폴더에만** 필요한 이유: 파일 이름은 언제나
 * `팀명_서류명` 꼴이라 `CON`·`NUL` 같은 한 낱말과 같아질 수 없지만, 폴더는 팀 이름(또는 서류
 * 이름) 그 자체다. 팀 이름은 학생이 정하므로 `CON`인 팀이 하나 있으면 **Windows에서 그 팀
 * 폴더만 통째로 풀리지 않는다.** 압축을 푸는 사람 쪽에서 조용히 일어나는 실패라 우리는 모른다.
 */
export function milestoneDocumentArchiveFolderName(value: string): string {
  const segment = safeSegment(value);
  return WINDOWS_RESERVED_NAMES.has(segment.toUpperCase())
    ? `${segment}_`
    : segment;
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
      return UNSAFE_CHARACTERS.has(character) ? '_' : character;
    })
    .join('');
}

function safeSegment(value: string): string {
  const normalized = replaceUnsafe(value)
    .replace(/\s+/g, ' ')
    .trim()
    // 끝의 `.`은 Windows가 이름에 담지 못한다 — `코드나무.`은 파일도 폴더도 만들 수 없어
    // 압축을 푸는 쪽에서 실패하거나 말없이 다른 이름이 된다. 여기서 미리 떼어 낸다.
    .replace(/\.+$/, '')
    .trim();
  // 점만 남은 이름(`.`·`..`)은 경로로 읽힐 수 있어 폴백으로 바꾼다(위에서 빈 값이 된다).
  if (normalized.length === 0 || /^\.+$/.test(normalized)) {
    return FALLBACK_SEGMENT;
  }
  return normalized;
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
