export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${formatRoundedSize(bytes / 1024)} KB`;
  return `${formatRoundedSize(bytes / (1024 * 1024))} MB`;
}

function formatRoundedSize(size: number): string {
  return Number(size.toFixed(1)).toString();
}
