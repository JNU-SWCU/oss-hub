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

export interface MilestoneDocumentDownloadFileNameInput {
  readonly teamName: string;
  readonly documentName: string;
  readonly originalFileName: string;
}

export function milestoneDocumentDownloadFileName(
  input: MilestoneDocumentDownloadFileNameInput,
): string {
  const base = `${safeSegment(input.teamName)}_${safeSegment(input.documentName)}`;
  return `${base}${extensionOf(input.originalFileName)}`;
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
  const normalized = replaceUnsafe(value).replace(/\s+/g, ' ').trim();
  // 점만 남은 이름(`.`·`..`)은 경로로 읽힐 수 있어 폴백으로 바꾼다.
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
