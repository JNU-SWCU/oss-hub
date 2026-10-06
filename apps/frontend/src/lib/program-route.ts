export function programDocumentsHref(
  programId: string,
  milestoneId?: string,
): string {
  const base = `/programs/${encodeURIComponent(programId)}/documents`;
  if (milestoneId === undefined) {
    return base;
  }
  return `${base}?milestoneId=${encodeURIComponent(milestoneId)}`;
}

export function programOverviewHref(programId: string): string {
  return `/programs/${encodeURIComponent(programId)}`;
}

export function programApplyHref(programId: string): string {
  return `/programs/${encodeURIComponent(programId)}/apply`;
}

export function programMyTeamHref(programId: string): string {
  return `/programs/${encodeURIComponent(programId)}/team`;
}

export function programNewHref(): string {
  return '/programs/new';
}

export function programEditHref(programId: string): string {
  return `/programs/${encodeURIComponent(programId)}/edit`;
}

export function programSubmissionReviewHref(
  programId: string,
  submissionId: string,
): string {
  return `/programs/${encodeURIComponent(programId)}/submissions/${encodeURIComponent(submissionId)}/review`;
}

export function programMilestoneDocumentsHref(
  programId: string,
  milestoneId: string,
): string {
  return `/programs/${encodeURIComponent(programId)}/milestones/${encodeURIComponent(milestoneId)}/documents`;
}

export function programTeamDetailHref(
  programId: string,
  teamId: string,
): string {
  return `/programs/${encodeURIComponent(programId)}/teams/${encodeURIComponent(teamId)}`;
}
