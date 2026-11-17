import { apiClient } from '@/lib/api-client';
import type {
  ProgramNoticeList,
  ProgramNoticePreview,
} from './program-notice-dto';

export function listProgramNotices(
  signal: AbortSignal,
): Promise<ProgramNoticeList> {
  return apiClient<ProgramNoticeList>('program-authoring/notices', { signal });
}

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
