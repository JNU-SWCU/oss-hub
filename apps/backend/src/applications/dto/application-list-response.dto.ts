import type { ApplicationStatus } from '@prisma/client';
import type {
  ApplicationListItem,
  ApplicationListPage,
  ApplicationListRepository,
  RepositoryProvisioningJobStatus,
  RepositoryProvisioningSafeErrorClass,
} from '../applications.repository';

export class ApplicationListItemResponseDto {
  readonly id: string;
  readonly status: ApplicationStatus;
  readonly submittedAt: string;
  readonly rejectionReason: string | null;
  readonly repositoryProvisioning: {
    readonly enabled: boolean;
    readonly jobStatus: RepositoryProvisioningJobStatus;
    readonly updatedAt: string;
    readonly safeErrorClass: RepositoryProvisioningSafeErrorClass | null;
  };
  /**
   * 프로비저닝된 저장소 주소·공개 여부. 화면이 「공개 저장소 열기」/「비공개 저장소 확인」을
   * 가르는 데 쓴다(submission-reviews 검토 화면과 같은 계약). 아직 없으면 null.
   */
  readonly repository: ApplicationListRepository | null;
  readonly isRepositoryPublicationPlanned: boolean;
  readonly participation: 'INDIVIDUAL' | 'TEAM';
  readonly applicant: {
    readonly id: string;
    readonly name: string | null;
    readonly nickname: string;
  };
  readonly team: {
    readonly id: string;
    readonly name: string;
    readonly memberCount: number;
  } | null;
  readonly answers: {
    readonly applicantName: string;
    readonly title: string;
    readonly summary: string;
  };

  private constructor(item: ApplicationListItem) {
    this.id = item.id;
    this.status = item.status;
    this.submittedAt = item.submittedAt.toISOString();
    this.rejectionReason = item.rejectionReason;
    this.repositoryProvisioning = {
      ...item.repositoryProvisioning,
      updatedAt: item.repositoryProvisioning.updatedAt.toISOString(),
    };
    this.repository = item.repository;
    this.isRepositoryPublicationPlanned = item.isRepositoryPublicationPlanned;
    this.participation = item.participation;
    this.applicant = item.applicant;
    this.team = item.team;
    this.answers = item.answers;
  }

  static from(item: ApplicationListItem): ApplicationListItemResponseDto {
    return new ApplicationListItemResponseDto(item);
  }
}

export class ApplicationListPageResponseDto {
  readonly items: readonly ApplicationListItemResponseDto[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;

  private constructor(page: ApplicationListPage) {
    this.items = page.items.map((item) =>
      ApplicationListItemResponseDto.from(item),
    );
    this.page = page.page;
    this.pageSize = page.pageSize;
    this.totalItems = page.totalItems;
    this.totalPages = page.totalPages;
  }

  static from(page: ApplicationListPage): ApplicationListPageResponseDto {
    return new ApplicationListPageResponseDto(page);
  }
}
