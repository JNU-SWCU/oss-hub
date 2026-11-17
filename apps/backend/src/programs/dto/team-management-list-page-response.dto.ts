import type { ApplicationStatus } from '@prisma/client';
import type {
  TeamManagementListItem,
  TeamManagementListPage,
} from '../team.repository';

class TeamManagementMemberResponseDto {
  declare readonly name: string | null;
  declare readonly nickname: string;

  static from(
    member: NonNullable<TeamManagementListItem['team']>['members'][number],
  ): TeamManagementMemberResponseDto {
    return { name: member.name, nickname: member.nickname };
  }
}

class TeamManagementTeamResponseDto {
  declare readonly id: string;
  declare readonly name: string;
  declare readonly memberCount: number;
  declare readonly members: TeamManagementMemberResponseDto[];

  static from(
    team: NonNullable<TeamManagementListItem['team']>,
  ): TeamManagementTeamResponseDto {
    return {
      id: team.id,
      name: team.name,
      memberCount: team.memberCount,
      members: team.members.map((member) =>
        TeamManagementMemberResponseDto.from(member),
      ),
    };
  }
}

export class TeamManagementListItemResponseDto {
  declare readonly id: string;
  declare readonly teamMinSize: number;
  declare readonly status: ApplicationStatus;
  declare readonly submittedAt: string;
  declare readonly applicant: {
    readonly name: string | null;
    readonly nickname: string;
  };
  declare readonly team: TeamManagementTeamResponseDto | null;

  static from(item: TeamManagementListItem): TeamManagementListItemResponseDto {
    return {
      id: item.id,
      teamMinSize: item.teamMinSize,
      status: item.status,
      submittedAt: item.submittedAt.toISOString(),
      applicant: {
        name: item.applicant.name,
        nickname: item.applicant.nickname,
      },
      team: item.team ? TeamManagementTeamResponseDto.from(item.team) : null,
    };
  }
}

export class TeamManagementListPageResponseDto {
  declare readonly items: TeamManagementListItemResponseDto[];
  declare readonly totalItems: number;
  declare readonly totalPages: number;

  static from(page: TeamManagementListPage): TeamManagementListPageResponseDto {
    return {
      items: page.items.map((item) =>
        TeamManagementListItemResponseDto.from(item),
      ),
      totalItems: page.totalItems,
      totalPages: page.totalPages,
    };
  }
}
