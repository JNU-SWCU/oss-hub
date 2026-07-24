/** Seed IDs contain `:` — always encode in hrefs so Next dynamic [id] keeps the full id. */
export function programHref(programId: string, suffix = ''): string {
  return `/programs/${encodeURIComponent(programId)}${suffix}`;
}

export function staffProgramHref(programId: string, suffix: string): string {
  return `/staff/programs/${encodeURIComponent(programId)}${suffix}`;
}

export function decodeRouteProgramId(rawId: string): string {
  try {
    return decodeURIComponent(rawId);
  } catch {
    return rawId;
  }
}
