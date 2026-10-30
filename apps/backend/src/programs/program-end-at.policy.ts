const PROGRAM_END_AT_UNDECIDED_TIME = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

export function isProgramEndAtUndecided(value: Date): boolean {
  return value.getTime() === PROGRAM_END_AT_UNDECIDED_TIME;
}
