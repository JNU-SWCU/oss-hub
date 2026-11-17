const TEAMS_PER_PROGRAM = 50;
const MEMBERS_PER_TEAM = 100;
const MILESTONES_PER_PROGRAM = 50;
const REQUIREMENTS_PER_MILESTONE = 20;
const REQUIREMENTS_PER_PROGRAM = 100;

export const READ_CAP = {
  teamsPerProgram: TEAMS_PER_PROGRAM,
  membersPerTeam: MEMBERS_PER_TEAM,
  membersPerProgram: TEAMS_PER_PROGRAM * MEMBERS_PER_TEAM,
  milestonesPerProgram: MILESTONES_PER_PROGRAM,
  requirementsPerMilestone: REQUIREMENTS_PER_MILESTONE,
  requirementsPerProgram: REQUIREMENTS_PER_PROGRAM,
  submissionsPerProgram: TEAMS_PER_PROGRAM * REQUIREMENTS_PER_PROGRAM,
  invitationsPerTeam: MEMBERS_PER_TEAM,
  invitationsPerRepository: MEMBERS_PER_TEAM,
  receivedInvitations: 50,
  notificationsPerTeam: MEMBERS_PER_TEAM,
  commentsPerPost: 100,
  historiesPerSubmission: 25,
  teamsPerUser: 20,
  participationsPerUser: 200,
  filesPerSubmission: 25,
  reposPerTeam: 5,
  programs: 200,
  repositories: 500,
  reviewHistoryPerTeam: 100,
  admins: 100,
  activityYears: 100,
  contributionRows: 50_000,
  activityPointsPerTeam: MEMBERS_PER_TEAM * 366,
  departments: 200,
  insightGroups: 10_000,
} as const;

export type NestedReadCaps = {
  readonly [relation: string]:
    number | { readonly cap?: number; readonly nested: NestedReadCaps };
};

export const READ_BATCH_SIZE = 500;
