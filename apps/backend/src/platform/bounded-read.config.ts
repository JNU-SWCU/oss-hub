const TEAMS_PER_PROGRAM = 50;
const MILESTONES_PER_PROGRAM = 20;
const REQUIREMENTS_PER_MILESTONE = 20;
const REQUIREMENTS_PER_PROGRAM =
  MILESTONES_PER_PROGRAM * REQUIREMENTS_PER_MILESTONE;

export const READ_CAP = {
  teamsPerProgram: TEAMS_PER_PROGRAM,
  membersPerTeam: 25,
  milestonesPerProgram: MILESTONES_PER_PROGRAM,
  requirementsPerMilestone: REQUIREMENTS_PER_MILESTONE,
  requirementsPerProgram: REQUIREMENTS_PER_PROGRAM,
  submissionsPerProgram: TEAMS_PER_PROGRAM * REQUIREMENTS_PER_PROGRAM,
  invitationsPerTeam: 25,
  invitationsPerRepository: 100,
  receivedInvitations: 50,
  notificationsPerTeam: 100,
  historyPerUser: 50,
  teamsPerUser: 20,
  filesPerSubmission: 25,
  reposPerTeam: 5,
  programs: 200,
  repositories: 500,
} as const;

export const READ_BATCH_SIZE = 500;
