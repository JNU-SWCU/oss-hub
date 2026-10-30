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

const MAX_SEGMENT_UNITS = 100;

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

export function milestoneDocumentTextEntryFileName(
  input: Omit<MilestoneDocumentDownloadFileNameInput, 'originalFileName'>,
): string {
  return `${baseName(input)}.txt`;
}

export function milestoneDocumentArchiveFolderName(value: string): string {
  const segment = safeSegment(value);

  const stem = segment.split('.')[0] ?? segment;
  return WINDOWS_RESERVED_NAMES.has(normalizeDeviceDigits(stem).toUpperCase())
    ? `${segment}_`
    : segment;
}

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

      if (code < 0x20 || code === 0x7f) return '_';
      if (isInvisibleFormatting(code)) return '_';
      return UNSAFE_CHARACTERS.has(character) ? '_' : character;
    })
    .join('');
}

function isInvisibleFormatting(code: number): boolean {
  return (
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

function safeSegment(value: string): string {
  const normalized = truncate(replaceUnsafe(value).replace(/\s+/g, ' ').trim())
    .replace(/\.+$/, '')
    .trim();

  if (normalized.length === 0 || /^\.+$/.test(normalized)) {
    return FALLBACK_SEGMENT;
  }
  return normalized;
}

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

function extensionOf(originalFileName: string): string {
  const dot = originalFileName.lastIndexOf('.');
  if (dot <= 0 || dot === originalFileName.length - 1) return '';
  const extension = replaceUnsafe(originalFileName.slice(dot + 1)).replace(
    /\s+/g,
    '',
  );
  return extension.length > 0 ? `.${extension}` : '';
}
