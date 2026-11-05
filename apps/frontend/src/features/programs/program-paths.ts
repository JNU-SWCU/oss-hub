export function programHref(programId: string, suffix = ''): string {
  return `/programs/${encodeURIComponent(programId)}${suffix}`;
}

export function staffApplicationDetailHref(
  programId: string,
  teamId: string,
): string {
  return `/programs/${encodeURIComponent(programId)}/teams/${encodeURIComponent(teamId)}`;
}

export function decodeRouteProgramId(rawId: string): string {
  try {
    return decodeURIComponent(rawId);
  } catch {
    return rawId;
  }
}
