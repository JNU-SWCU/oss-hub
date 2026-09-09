const FILE_SIGNATURES: Readonly<Record<string, readonly Buffer[]>> = {
  '.pdf': [Buffer.from('%PDF-')],
  '.hwp': [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
  '.zip': [
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    Buffer.from([0x50, 0x4b, 0x07, 0x08]),
  ],
};

export function hasValidSubmissionFileSignature(
  buffer: Buffer,
  fileName: string,
): boolean {
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  return (
    FILE_SIGNATURES[extension]?.some(
      (signature) =>
        buffer.length >= signature.length &&
        buffer.subarray(0, signature.length).equals(signature),
    ) ?? false
  );
}
