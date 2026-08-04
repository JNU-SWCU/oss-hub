export function studentProgramSubmissionHref(
  programId: string,
  milestoneId: string,
): string {
  return `/programs/${encodeURIComponent(programId)}?submission=${encodeURIComponent(milestoneId)}`;
}

export function programStatusHref(
  programId: string,
  milestoneId?: string,
): string {
  const base = `/programs/${encodeURIComponent(programId)}/status`;
  if (milestoneId === undefined) {
    return base;
  }
  return `${base}?milestoneId=${encodeURIComponent(milestoneId)}`;
}

export function programMyDocsHref(
  programId: string,
  milestoneId?: string,
): string {
  const base = `/programs/${encodeURIComponent(programId)}/mydocs`;
  if (milestoneId === undefined) {
    return base;
  }
  return `${base}?milestoneId=${encodeURIComponent(milestoneId)}`;
}
