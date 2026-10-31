import type { ApplicationStatus } from '@prisma/client';
import type {
  TeamManagementListItem,
  TeamManagementListPage,
  TeamManagementMember,
} from '../applications.repository';

export class TeamManagementListItemResponseDto {
  declare readonly id: string;
  declare readonly programId: string;
  declare readonly status: ApplicationStatus;
  declare readonly submittedAt: string;
  declare readonly rejectionReason: string | null;
  declare readonly applicant: {
    readonly id: string;
    readonly name: string | null;
    readonly nickname: string;
  };
  declare readonly team: {
    readonly id: string;
    readonly name: string;
    readonly memberCount: number;
    readonly members: readonly TeamManagementMember[];
  } | null;

  static from(item: TeamManagementListItem): TeamManagementListItemResponseDto {
    return {
      id: item.id,
      programId: item.programId,
      status: item.status,
      submittedAt: item.submittedAt.toISOString(),
      rejectionReason: item.rejectionReason,
      applicant: item.applicant,
      team: item.team,
    };
  }
}

export class TeamManagementListPageResponseDto {
  declare readonly items: readonly TeamManagementListItemResponseDto[];
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
