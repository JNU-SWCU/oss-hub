import { mailRequest, type AcceptedMailJob } from './mail-job-client';
import { apiClient } from '@/lib/api-client';
import type {
  MailReceipt,
  MailJob,
  ProgramMailDraft,
  ProgramMailPreview,
  ProgramMailRecipients,
} from './program-mail-dto';

function mailPath(programId: string, action: string): string {
  return `programs/${encodeURIComponent(programId)}/mail/${action}`;
}

export function getMailJobs(
  programId: string,
  before: string | undefined,
  signal: AbortSignal,
) {
  const query = before ? `?before=${encodeURIComponent(before)}` : '';
  return apiClient<{ items: MailReceipt[]; nextCursor?: string }>(
    mailPath(programId, `jobs${query}`),
    { signal },
  );
}

export function getMailJob(
  programId: string,
  jobId: string,
  signal: AbortSignal,
) {
  return apiClient<MailJob>(
    mailPath(programId, `jobs/${encodeURIComponent(jobId)}`),
    { signal },
  );
}

export function getProgramMailRecipients(
  programId: string,
): Promise<ProgramMailRecipients> {
  return apiClient<ProgramMailRecipients>(mailPath(programId, 'recipients'));
}

export function previewProgramMail(
  programId: string,
  draft: ProgramMailDraft,
): Promise<ProgramMailPreview> {
  return mailRequest<ProgramMailPreview>(
    programId,
    'previews',
    'PROGRAM',
    draft,
  );
}

export function sendProgramMail(
  programId: string,
  preview: ProgramMailPreview,
): Promise<AcceptedMailJob> {
  return mailRequest<AcceptedMailJob>(programId, 'jobs', 'PROGRAM', {
    subject: preview.subject,
    body: preview.body,
    applicantIds: preview.applicantIds,
    previewedAt: preview.previewedAt,
    previewVersion: preview.previewVersion,
  });
}
