/** Seed IDs contain `:` — always encode in hrefs so Next dynamic [id] keeps the full id. */
export function programHref(programId: string, suffix = ''): string {
  return `/programs/${encodeURIComponent(programId)}${suffix}`;
}

export function programSubmissionHref(
  programId: string,
  milestoneId: string,
): string {
  return studentProgramSubmissionHref(programId, milestoneId);
}

export function staffProgramHref(programId: string, suffix: string): string {
  return `/staff/programs/${encodeURIComponent(programId)}${suffix}`;
}

/** Locked #119 detail path — decide UI is out of #106 scope. */
export function staffApplicationDetailHref(
  programId: string,
  applicationId: string,
): string {
  return `/staff/programs/${encodeURIComponent(programId)}/applications/${encodeURIComponent(applicationId)}`;
}

export function decodeRouteProgramId(rawId: string): string {
  try {
    return decodeURIComponent(rawId);
  } catch {
    return rawId;
  }
}
import { studentProgramSubmissionHref } from '@/lib/program-route';
