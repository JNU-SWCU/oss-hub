import type { ApplicationStatus } from '@prisma/client';
import type {
  TeamManagementListItem,
  TeamManagementListPage,
} from '../team.repository';

class TeamManagementMemberResponseDto {
  declare readonly id: string;
  declare readonly name: string | null;
  declare readonly nickname: string;

  static from(
    member: NonNullable<TeamManagementListItem['team']>['members'][number],
  ): TeamManagementMemberResponseDto {
    return { id: member.id, name: member.name, nickname: member.nickname };
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
  declare readonly programId: string;
  declare readonly teamMinSize: number;
  declare readonly status: ApplicationStatus;
  declare readonly submittedAt: string;
  declare readonly rejectionReason: string | null;
  declare readonly applicant: {
    readonly id: string;
    readonly name: string | null;
    readonly nickname: string;
  };
  declare readonly team: TeamManagementTeamResponseDto | null;

  static from(item: TeamManagementListItem): TeamManagementListItemResponseDto {
    return {
      id: item.id,
      programId: item.programId,
      teamMinSize: item.teamMinSize,
      status: item.status,
      submittedAt: item.submittedAt.toISOString(),
      rejectionReason: item.rejectionReason,
      applicant: item.applicant,
      team: item.team ? TeamManagementTeamResponseDto.from(item.team) : null,
    };
  }
}

export class TeamManagementListPageResponseDto {
  declare readonly items: TeamManagementListItemResponseDto[];
  declare readonly page: number;
  declare readonly pageSize: number;
  declare readonly totalItems: number;
  declare readonly totalPages: number;

  static from(page: TeamManagementListPage): TeamManagementListPageResponseDto {
    return {
      items: page.items.map((item) =>
        TeamManagementListItemResponseDto.from(item),
      ),
      page: page.page,
      pageSize: page.pageSize,
      totalItems: page.totalItems,
      totalPages: page.totalPages,
    };
  }
}
