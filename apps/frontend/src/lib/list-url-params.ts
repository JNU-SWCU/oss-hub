export function parseListPage(raw: string | null): number {
  if (raw === null || !/^[1-9][0-9]*$/.test(raw)) return 1;
  const page = Number(raw);
  return Number.isSafeInteger(page) ? page : 1;
}

export function parseListEnum<T extends string>(
  raw: string | null,
  values: readonly T[],
  fallback: T,
): T {
  return values.find((value) => value === raw) ?? fallback;
}
