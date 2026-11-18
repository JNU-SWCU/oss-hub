interface TeamSize {
  readonly memberCount: number;
  readonly minSize?: number;
  readonly maxSize?: number;
}

interface TeamMemberCountText {
  readonly label: string;
  readonly shortage: string | null;
}

export function teamMemberCountText(team: TeamSize): TeamMemberCountText {
  const missing =
    team.minSize === undefined
      ? 0
      : Math.max(team.minSize - team.memberCount, 0);
  return {
    label:
      team.maxSize === undefined || team.maxSize <= 1
        ? `팀원 ${team.memberCount}명`
        : `팀원 ${team.memberCount}/${team.maxSize}명`,
    shortage:
      team.minSize === undefined || missing === 0
        ? null
        : `최소 ${team.minSize}명 · ${missing}명 부족`,
  };
}
