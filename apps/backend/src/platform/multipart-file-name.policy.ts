const LATIN1_MAX_CODE_POINT = 0xff;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export function normalizeMultipartFileName(fileName: string): string {
  if (
    [...fileName].some(
      (character) => character.codePointAt(0)! > LATIN1_MAX_CODE_POINT,
    )
  ) {
    return fileName.normalize('NFC');
  }

  try {
    return UTF8_DECODER.decode(Buffer.from(fileName, 'latin1')).normalize(
      'NFC',
    );
  } catch {
    return fileName.normalize('NFC');
  }
}
