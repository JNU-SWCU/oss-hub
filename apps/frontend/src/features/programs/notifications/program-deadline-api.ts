import { mailRequest, type AcceptedMailJob } from './mail-job-client';
import type {
  ProgramDeadlineGuidance,
  ProgramDeadlinePreview,
} from './program-deadline-dto';

export function previewProgramDeadline(
  programId: string,
  guidance: ProgramDeadlineGuidance,
): Promise<ProgramDeadlinePreview> {
  return mailRequest<ProgramDeadlinePreview>(
    programId,
    'previews',
    'DEADLINE',
    guidance,
  );
}

export function sendProgramDeadline(
  programId: string,
  preview: Pick<ProgramDeadlinePreview, 'previewedAt' | 'previewVersion'> &
    ProgramDeadlineGuidance,
): Promise<AcceptedMailJob> {
  return mailRequest<AcceptedMailJob>(programId, 'jobs', 'DEADLINE', preview);
}
