import type { ApplicationStatus } from '@prisma/client';
import type {
  TeamManagementListItem,
  TeamManagementListPage,
  TeamManagementMember,
} from '../applications.repository';

/**
 * 팀 관리 목록 한 줄. 교직원 화면의 네 열(팀/구성 · 대표 신청자 · 상태 · 최근 제출)만 담는다.
 *
 * 저장소 관련 필드를 **선언하지 않는다**. 이 목록을 쓰는 화면은 저장소 어휘를 쓰지 않고,
 * projection 자체가 그 값을 읽지 않으므로 「응답에서 빼는」 단계가 아예 없다.
 */
export class TeamManagementListItemResponseDto {
  /** 신청 id. 상세·판정 호출이 이 값으로 도달한다. */
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

  static from(
    item: TeamManagementListItem,
  ): TeamManagementListItemResponseDto {
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

  static from(
    page: TeamManagementListPage,
  ): TeamManagementListPageResponseDto {
    return new TeamManagementListPageResponseDto(page);
  }
}
