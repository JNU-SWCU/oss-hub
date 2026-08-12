import { TeamInvitationsRepository } from './team-invitations.repository';
import { TeamInvitationsService } from './team-invitations.service';

export const syntheticGithubId = 424242n;
export const syntheticUserId = 'cuid-synthetic-invitee';
export const syntheticLeaderId = 'cuid-synthetic-leader';
export const syntheticTeamId = 'cuid-synthetic-team';
export const syntheticProgramId = 'cuid-synthetic-program';

export type MockRepository = TeamInvitationsRepository & {
  findUserIdByGithubId: jest.Mock;
  findByInviteeId: jest.Mock;
  findByTeamId: jest.Mock;
  findTeamContext: jest.Mock;
  isTeamMember: jest.Mock;
  isUserInProgramTeam: jest.Mock;
  getInviteeEligibility: jest.Mock;
  countTeamMembers: jest.Mock;
  searchCandidates: jest.Mock;
  createInvitation: jest.Mock;
  closePendingInvitationAsDeclined: jest.Mock;
  findInvitationForActor: jest.Mock;
  withAcceptTransaction: jest.Mock;
};

export function buildService(overrides: Partial<MockRepository> = {}): {
  readonly service: TeamInvitationsService;
  readonly repository: MockRepository;
} {
  const repository = {
    findUserIdByGithubId: jest.fn().mockResolvedValue(syntheticUserId),
    findByInviteeId: jest.fn().mockResolvedValue([]),
    findByTeamId: jest.fn().mockResolvedValue([]),
    findTeamContext: jest.fn().mockResolvedValue({
      teamId: syntheticTeamId,
      programId: syntheticProgramId,
      leaderId: syntheticLeaderId,
      teamMaxSize: 4,
      locked: false,
    }),
    isTeamMember: jest.fn().mockResolvedValue(true),
    isUserInProgramTeam: jest.fn().mockResolvedValue(false),
    getInviteeEligibility: jest.fn().mockResolvedValue('eligible'),
    countTeamMembers: jest.fn().mockResolvedValue(1),
    searchCandidates: jest.fn().mockResolvedValue([]),
    createInvitation: jest.fn(),
    closePendingInvitationAsDeclined: jest.fn().mockResolvedValue(1),
    findInvitationForActor: jest.fn(),
    withAcceptTransaction: jest.fn(),
    ...overrides,
  } as unknown as MockRepository;
  return {
    service: new TeamInvitationsService(repository),
    repository,
  };
}
