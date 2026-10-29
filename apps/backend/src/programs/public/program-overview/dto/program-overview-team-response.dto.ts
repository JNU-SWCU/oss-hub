import type { PublicTeamRow } from '../domain/program-overview';

export class ProgramOverviewTeamMemberResponseDto {
  readonly userId: string;
  readonly displayName: string;
  readonly isLeader: boolean;

  private constructor(row: PublicTeamRow['members'][number]) {
    this.userId = row.userId;
    this.displayName = row.displayName;
    this.isLeader = row.isLeader;
  }

  static from(
    row: PublicTeamRow['members'][number],
  ): ProgramOverviewTeamMemberResponseDto {
    return new ProgramOverviewTeamMemberResponseDto(row);
  }
}

export class ProgramOverviewTeamResponseDto {
  readonly teamId: string;
  readonly name: string;
  readonly memberCount: number;
  readonly members: readonly ProgramOverviewTeamMemberResponseDto[];

  private constructor(row: PublicTeamRow) {
    this.teamId = row.teamId;
    this.name = row.name;
    this.memberCount = row.members.length;
    this.members = row.members.map((member) =>
      ProgramOverviewTeamMemberResponseDto.from(member),
    );
  }

  static from(row: PublicTeamRow): ProgramOverviewTeamResponseDto {
    return new ProgramOverviewTeamResponseDto(row);
  }
}
