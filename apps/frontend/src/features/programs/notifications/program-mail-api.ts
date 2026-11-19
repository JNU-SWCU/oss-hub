import { apiClient } from '@/lib/api-client';
import type {
  ProgramMailDraft,
  ProgramMailPreview,
  ProgramMailRecipients,
  ProgramMailSendResult,
} from './program-mail-dto';

function mailPath(programId: string, action: string): string {
  return `programs/${encodeURIComponent(programId)}/mail/${action}`;
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
  return apiClient<ProgramMailPreview>(mailPath(programId, 'preview'), {
    method: 'POST',
    body: JSON.stringify(draft),
  });
}

export function sendProgramMail(
  programId: string,
  preview: ProgramMailPreview,
): Promise<ProgramMailSendResult> {
  return apiClient<ProgramMailSendResult>(mailPath(programId, 'send'), {
    method: 'POST',
    body: JSON.stringify({
      subject: preview.subject,
      body: preview.body,
      applicantIds: preview.applicantIds,
      previewedAt: preview.previewedAt,
      previewVersion: preview.previewVersion,
    }),
  });
}
