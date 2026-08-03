export function studentProgramSubmissionHref(
  programId: string,
  milestoneId: string,
): string {
  return `/programs/${encodeURIComponent(programId)}?submission=${encodeURIComponent(milestoneId)}`;
}
