export function programHref(programId: string, suffix = ''): string {
  return `/programs/${encodeURIComponent(programId)}${suffix}`;
}

export function staffProgramHref(programId: string, suffix: string): string {
  return `/programs/${encodeURIComponent(programId)}${suffix}`;
}

export function staffApplicationDetailHref(
  programId: string,
  applicationId: string,
): string {
  return `/programs/${encodeURIComponent(programId)}/applications/${encodeURIComponent(applicationId)}`;
}

export function decodeRouteProgramId(rawId: string): string {
  try {
    return decodeURIComponent(rawId);
  } catch {
    return rawId;
  }
}
