import { apiClient } from '@/lib/api-client';
import {
  requireSubmissionUploadLimit,
  type SubmissionUploadLimit,
} from '@/lib/submission-upload-policy';
import type { ProgramAuthoringManifest } from './program-authoring-manifest';

const jsonHeaders = { 'Content-Type': 'application/json' } as const;

export async function getAuthoringUploadPolicy(): Promise<{
  readonly fileUpload: SubmissionUploadLimit;
}> {
  const response = await apiClient<{ readonly fileUpload: unknown }>(
    'program-authoring/upload-policy',
  );
  return { fileUpload: requireSubmissionUploadLimit(response.fileUpload) };
}

export type ProgramAuthoringUpload = {
  readonly id: string;
  readonly fileName?: string;
  readonly contentType?: string;
  readonly size?: number;
  readonly expiresAt?: string;
};

export function uploadAuthoringFile(
  file: File,
): Promise<ProgramAuthoringUpload> {
  const body = new FormData();
  body.append('file', file);
  return apiClient<ProgramAuthoringUpload>('program-authoring/uploads', {
    method: 'POST',
    body,
  });
}

export async function deleteAuthoringUpload(uploadId: string): Promise<void> {
  await apiClient<null>(
    `program-authoring/uploads/${encodeURIComponent(uploadId)}`,
    { method: 'DELETE' },
  );
}

export function createAuthoringProgram(
  manifest: ProgramAuthoringManifest,
  idempotencyKey: string,
): Promise<{ readonly id: string }> {
  return apiClient<{ readonly id: string }>('program-authoring/programs', {
    method: 'POST',
    headers: { ...jsonHeaders, 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(manifest),
  });
}
