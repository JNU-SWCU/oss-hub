import { apiClient } from '@/lib/api-client';
import type {
  ProgramDeadlineGuidance,
  ProgramDeadlinePreview,
  ProgramDeadlineSendResult,
} from './program-deadline-dto';

export function previewProgramDeadline(
  programId: string,
  guidance: ProgramDeadlineGuidance,
): Promise<ProgramDeadlinePreview> {
  return apiClient<ProgramDeadlinePreview>(
    `programs/${encodeURIComponent(programId)}/deadline-digest/preview`,
    { method: 'POST', body: JSON.stringify(guidance) },
  );
}

export function sendProgramDeadline(
  programId: string,
  preview: Pick<ProgramDeadlinePreview, 'previewedAt' | 'previewVersion'> &
    ProgramDeadlineGuidance,
): Promise<ProgramDeadlineSendResult> {
  return apiClient<ProgramDeadlineSendResult>(
    `programs/${encodeURIComponent(programId)}/deadline-digest/send`,
    {
      method: 'POST',
      body: JSON.stringify(preview),
    },
  );
}
