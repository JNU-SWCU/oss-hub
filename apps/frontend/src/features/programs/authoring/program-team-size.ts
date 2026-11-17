export function teamSizeValue(value: string): number | null {
  return value.trim() === '' ? null : Number(value);
}
