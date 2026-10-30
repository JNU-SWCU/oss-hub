import type { PublicTeamRow } from '../programs.types';

export class ProgramOverviewTeamMemberResponseDto {
  declare readonly userId: string;
  declare readonly displayName: string;
  declare readonly isLeader: boolean;

  static from(
    row: PublicTeamRow['members'][number],
  ): ProgramOverviewTeamMemberResponseDto {
    return {
      userId: row.userId,
      displayName: row.displayName,
      isLeader: row.isLeader,
    };
  }
}

export class ProgramOverviewTeamResponseDto {
  declare readonly teamId: string;
  declare readonly name: string;
  declare readonly memberCount: number;
  declare readonly members: readonly ProgramOverviewTeamMemberResponseDto[];

  static from(row: PublicTeamRow): ProgramOverviewTeamResponseDto {
    return {
      teamId: row.teamId,
      name: row.name,
      memberCount: row.members.length,
      members: row.members.map((member) =>
        ProgramOverviewTeamMemberResponseDto.from(member),
      ),
    };
  }
}
