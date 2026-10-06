import type { ProgramTeamDeletionRepository } from '../repository/program-team-deletion.repository';
import type { TeamDeletionScopeCounts } from '../team-deletion-scope';

export const EMPTY_TEAM_DELETION_SCOPE: TeamDeletionScopeCounts = {
  applications: 0,
  members: 0,
  invitations: 0,
  submissions: 0,
  submissionEvents: 0,
  detachedRepositories: 0,
  scopeFingerprint: '0'.repeat(32),
};

export function stubTeamDeletionRepository(
  overrides: Partial<ProgramTeamDeletionRepository> = {},
): ProgramTeamDeletionRepository {
  return {
    readScopeCounts: jest.fn().mockResolvedValue(EMPTY_TEAM_DELETION_SCOPE),
    deleteTeam: jest.fn(),
    ...overrides,
  } as unknown as ProgramTeamDeletionRepository;
}
