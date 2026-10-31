export class MyProgramTeamResponseDto<
  TTeam extends { readonly isLeader: boolean },
> {
  declare readonly membership: 'NONE' | 'MEMBER' | 'LEADER';
  declare readonly team: TTeam | null;

  static from<TTeam extends { readonly isLeader: boolean }>(
    team: TTeam | null,
  ): MyProgramTeamResponseDto<TTeam> {
    if (team === null) {
      return { membership: 'NONE', team: null };
    }
    return { membership: team.isLeader ? 'LEADER' : 'MEMBER', team };
  }
}
