export const TEAM_MIN_SIZE_MESSAGE =
  '최소 인원은 1명 이상 100명 이하여야 합니다.';

export const TEAM_MAX_SIZE_MESSAGE =
  '최대 인원은 최소 인원 이상 100명 이하여야 합니다.';

export function teamSizeValue(value: string): number | null {
  return value.trim() === '' ? null : Number(value);
}
