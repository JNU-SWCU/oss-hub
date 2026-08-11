import { apiClient } from '@/lib/api-client';

const jsonHeaders = { 'Content-Type': 'application/json' } as const;

export type ProgramDeadlinePreview = {
  readonly applicationCount: number;
  readonly milestoneCount: number;
  readonly recipientCount: number;
  readonly inactiveCount: number;
  readonly optedOutCount: number;
  readonly noEmailCount: number;
  // 학생 기준인 recipientCount와 별개다. 합산하지 않는다.
  readonly staffRecipientCount: number;
  readonly previewedAt: string;
  readonly expiresAt: string;
  readonly previewVersion: string;
};

export type ProgramDeadlineSendResult = ProgramDeadlinePreview & {
  readonly sentAt: string;
  readonly sentCount: number;
  readonly duplicateCount: number;
  readonly failedCount: number;
};

export function previewProgramDeadline(
  programId: string,
): Promise<ProgramDeadlinePreview> {
  return apiClient<ProgramDeadlinePreview>(
    `programs/${encodeURIComponent(programId)}/deadline-digest/preview`,
    { method: 'POST' },
  );
}

export function sendProgramDeadline(
  programId: string,
  preview: Pick<ProgramDeadlinePreview, 'previewedAt' | 'previewVersion'>,
): Promise<ProgramDeadlineSendResult> {
  return apiClient<ProgramDeadlineSendResult>(
    `programs/${encodeURIComponent(programId)}/deadline-digest/send`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(preview),
    },
  );
}
