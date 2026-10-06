import type { ApplicationStatus } from '@prisma/client';
import type {
  TeamManagementListItem,
  TeamManagementListPage,
  TeamManagementMember,
} from '../applications.repository';

export class TeamManagementListItemResponseDto {
  readonly id: string;
  readonly programId: string;
  readonly status: ApplicationStatus;
  readonly submittedAt: string;
  readonly rejectionReason: string | null;
  readonly applicant: {
    readonly id: string;
    readonly name: string | null;
    readonly nickname: string;
  };
  readonly team: {
    readonly id: string;
    readonly name: string;
    readonly memberCount: number;
    readonly members: readonly TeamManagementMember[];
  } | null;

  private constructor(item: TeamManagementListItem) {
    this.id = item.id;
    this.programId = item.programId;
    this.status = item.status;
    this.submittedAt = item.submittedAt.toISOString();
    this.rejectionReason = item.rejectionReason;
    this.applicant = item.applicant;
    this.team = item.team;
  }

  static from(item: TeamManagementListItem): TeamManagementListItemResponseDto {
    return new TeamManagementListItemResponseDto(item);
  }
}

export class TeamManagementListPageResponseDto {
  readonly items: readonly TeamManagementListItemResponseDto[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;

  private constructor(page: TeamManagementListPage) {
    this.items = page.items.map((item) =>
      TeamManagementListItemResponseDto.from(item),
    );
    this.page = page.page;
    this.pageSize = page.pageSize;
    this.totalItems = page.totalItems;
    this.totalPages = page.totalPages;
  }

  static from(page: TeamManagementListPage): TeamManagementListPageResponseDto {
    return new TeamManagementListPageResponseDto(page);
  }
}
