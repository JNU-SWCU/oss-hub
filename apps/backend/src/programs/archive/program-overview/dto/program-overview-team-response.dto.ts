import type { PublicTeamRow } from '../program-overview.repository';

/**
 * `GET /programs/:programId/overview/teams` 응답 항목 하나. public DTO allowlist —
 * 저장소 URL·학번·연락처·이메일·실명은 절대 포함하지 않는다(repository의
 * `listPublicTeams` select와 짝을 이루는 계약).
 */
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
