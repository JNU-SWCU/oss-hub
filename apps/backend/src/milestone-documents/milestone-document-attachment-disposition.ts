export function milestoneDocumentAttachmentDisposition(
  fileName: string,
): string {
  const fallback = [...fileName]
    .map((character) => {
      const code = character.charCodeAt(0);
      if (
        code < 0x20 ||
        code > 0x7e ||
        character === '"' ||
        character === '\\' ||
        character === '/' ||
        character === ';'
      ) {
        return '_';
      }
      return character;
    })
    .join('')
    .trim();
  const asciiFileName = fallback.length > 0 ? fallback : 'file';
  const encodedFileName = encodeURIComponent(fileName).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodedFileName}`;
}
