export function studentProgramSubmissionHref(
  programId: string,
  milestoneId: string,
): string {
  return programMyDocsHref(programId, milestoneId);
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

export function programNewHref(): string {
  return '/programs/new';
}

export function programEditHref(programId: string): string {
  return `/programs/${encodeURIComponent(programId)}/edit`;
}

export function programApplicantsHref(programId: string): string {
  return `/programs/${encodeURIComponent(programId)}/applicants`;
}

export function programApplicationDetailHref(
  programId: string,
  applicationId: string,
): string {
  return `/programs/${encodeURIComponent(programId)}/applications/${encodeURIComponent(applicationId)}`;
}

export function programSubmissionReviewHref(
  programId: string,
  submissionId: string,
): string {
  return `/programs/${encodeURIComponent(programId)}/submissions/${encodeURIComponent(submissionId)}/review`;
}
