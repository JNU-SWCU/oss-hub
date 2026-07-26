import type { ApplicationStatus } from '@prisma/client';
import type {
  ApplicationListItem,
  ApplicationListPage,
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
