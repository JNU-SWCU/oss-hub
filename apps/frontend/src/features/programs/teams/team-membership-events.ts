export const TEAM_MEMBERSHIP_CHANGED_EVENT = 'oss-hub:team-membership-changed';

export interface TeamMembershipChangedDetail {
  readonly programId: string;
}

export function notifyTeamMembershipChanged(programId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<TeamMembershipChangedDetail>(
      TEAM_MEMBERSHIP_CHANGED_EVENT,
      { detail: { programId } },
    ),
  );
}
