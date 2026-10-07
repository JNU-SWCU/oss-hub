export const PROGRAM_END_AT_UNDECIDED = '9999-12-31T23:59:59.999Z';

export const PROGRAM_END_AT_UNDECIDED_LABEL = '미정';

const UNDECIDED_TIME = new Date(PROGRAM_END_AT_UNDECIDED).getTime();

export function isProgramEndAtUndecided(value: string | null): boolean {
  if (value === null) return true;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time === UNDECIDED_TIME;
}

export function formatProgramEndAt(
  value: string | null,
  format: (iso: string) => string,
): string {
  return isProgramEndAtUndecided(value)
    ? PROGRAM_END_AT_UNDECIDED_LABEL
    : format(value as string);
}
