import type { ProgramTeamDeletionRepository } from '../repository/program-team-deletion.repository';
import type { TeamDeletionScopeCounts } from '../team-deletion-scope';

/** 아무것도 딸려 있지 않은 팀의 삭제 범위 — 합성 값이며 실제 조회를 대신하지 않는다. */
export const EMPTY_TEAM_DELETION_SCOPE: TeamDeletionScopeCounts = {
  applications: 0,
  members: 0,
  invitations: 0,
  submissions: 0,
  submissionEvents: 0,
  detachedRepositories: 0,
  scopeFingerprint: '0'.repeat(32),
};

/**
 * 팀 삭제 repository 대역. `getForStaff`가 상세 응답에 삭제 범위를 실으므로,
 * 삭제와 무관한 팀 조회 테스트도 이 대역을 하나 받아야 한다.
 */
export function stubTeamDeletionRepository(
  overrides: Partial<ProgramTeamDeletionRepository> = {},
): ProgramTeamDeletionRepository {
  return {
    readScopeCounts: jest.fn().mockResolvedValue(EMPTY_TEAM_DELETION_SCOPE),
    deleteTeam: jest.fn(),
    ...overrides,
  } as unknown as ProgramTeamDeletionRepository;
}
