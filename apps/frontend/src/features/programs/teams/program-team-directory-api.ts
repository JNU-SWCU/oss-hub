import { apiClient } from '@/lib/api-client';
import type { ProgramTeamDirectoryEntry } from './program-team-directory-dto';

export function getProgramTeamDirectory(
  programId: string,
): Promise<readonly ProgramTeamDirectoryEntry[]> {
  return apiClient<readonly ProgramTeamDirectoryEntry[]>(
    `programs/${encodeURIComponent(programId)}/overview/teams`,
  );
}
