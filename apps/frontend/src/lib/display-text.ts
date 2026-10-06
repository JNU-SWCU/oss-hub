export const REJECTION_REASON_MAX_LENGTH = 300;

export const REJECTION_REASON_MAX_LINES = 6;

const UNRENDERABLE_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

const UNICODE_LINE_SEPARATOR_PATTERN = /[\u2028\u2029]/g;

function collapseBlankLines(value: string): string {
  const collapsed: string[] = [];
  for (const line of value.split('\n')) {
    const normalized = line.trim() === '' ? '' : line;
    if (normalized === '' && collapsed.at(-1) === '') {
      continue;
    }
    collapsed.push(normalized);
  }
  return collapsed.join('\n');
}

const graphemeSegmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter('ko', { granularity: 'grapheme' })
    : null;

function splitGraphemes(value: string): readonly string[] {
  if (graphemeSegmenter === null) {
    return Array.from(value);
  }
  return [...graphemeSegmenter.segment(value)].map((entry) => entry.segment);
}

export function sanitizeDisplayText(reason: string | null): string | null {
  const cleaned = collapseBlankLines(
    (reason ?? '')
      .replace(UNRENDERABLE_PATTERN, '')
      .replace(/\t/g, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(UNICODE_LINE_SEPARATOR_PATTERN, '\n'),
  ).trim();
  return cleaned.length === 0 ? null : cleaned;
}

export function clampRejectionReason(reason: string | null): string | null {
  const cleaned = sanitizeDisplayText(reason);
  if (cleaned === null) {
    return null;
  }

  const lines = cleaned.split('\n');
  const lineClamped =
    lines.length > REJECTION_REASON_MAX_LINES
      ? `${lines.slice(0, REJECTION_REASON_MAX_LINES).join('\n')}…`
      : cleaned;

  const graphemes = splitGraphemes(lineClamped);
  return graphemes.length > REJECTION_REASON_MAX_LENGTH
    ? `${graphemes.slice(0, REJECTION_REASON_MAX_LENGTH).join('')}…`
    : lineClamped;
}
