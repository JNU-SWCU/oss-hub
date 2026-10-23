import { apiClient } from '@/lib/api-client';
import type { ProgramNoticePreview } from './program-notice-dto';

export function previewProgramNotice(
  url: string,
  signal: AbortSignal,
): Promise<ProgramNoticePreview> {
  return apiClient<ProgramNoticePreview>('program-authoring/notice-preview', {
    method: 'POST',
    body: JSON.stringify({ url }),
    signal,
  });
}
