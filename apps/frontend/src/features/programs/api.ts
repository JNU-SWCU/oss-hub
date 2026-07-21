import { apiClient } from '@/lib/api-client';
import type { ProgramActivity, ProgramDetail } from './types';

export function getProgramDetail(programId: string): Promise<ProgramDetail> {
  return apiClient<ProgramDetail>(`programs/${encodeURIComponent(programId)}`);
}

export function getProgramActivity(
  programId: string,
): Promise<readonly ProgramActivity[]> {
  return apiClient<readonly ProgramActivity[]>(
    `programs/${encodeURIComponent(programId)}/activity`,
  );
}
