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

const STAGE_SCOPED_DOCUMENT_PARAMS = [
  'documentId',
  'submissionState',
  'page',
] as const;

export function documentsStageSearch(
  search: string,
  milestoneId: string | null,
): string {
  const next = new URLSearchParams(search);
  if (next.get('milestoneId') !== milestoneId) {
    for (const param of STAGE_SCOPED_DOCUMENT_PARAMS) next.delete(param);
  }
  if (milestoneId === null) next.delete('milestoneId');
  else next.set('milestoneId', milestoneId);
  return next.toString();
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

export function programTeamDetailHref(
  programId: string,
  teamId: string,
): string {
  return `/programs/${encodeURIComponent(programId)}/teams/${encodeURIComponent(teamId)}`;
}
