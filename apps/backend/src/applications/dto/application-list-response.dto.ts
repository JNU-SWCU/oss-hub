import type {
  ApplicationReviewEventKind,
  ApplicationStatus,
  RepositoryConnectionMode,
} from '@prisma/client';
import type {
  ApplicationListItem,
  ApplicationListPage,
  ApplicationListRepository,
  ApplicationReviewHistoryEntry,
  RepositoryProvisioningJobStatus,
  RepositoryProvisioningSafeErrorClass,
  StaffApplicationDetail,
} from '../domain/application-records';

export class ApplicationListItemResponseDto {
  readonly id: string;

  readonly programId: string;
  readonly status: ApplicationStatus;
  readonly submittedAt: string;
  readonly rejectionReason: string | null;

  readonly repositoryConnectionMode: RepositoryConnectionMode;

  readonly repositoryUrl: string | null;
  readonly repositoryProvisioning: {
    readonly enabled: boolean;
    readonly jobStatus: RepositoryProvisioningJobStatus;
    readonly updatedAt: string;
    readonly safeErrorClass: RepositoryProvisioningSafeErrorClass | null;
  };

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

  protected constructor(item: ApplicationListItem) {
    this.id = item.id;
    this.programId = item.programId;
    this.status = item.status;
    this.submittedAt = item.submittedAt.toISOString();
    this.rejectionReason = item.rejectionReason;
    this.repositoryConnectionMode = item.repositoryConnectionMode;
    this.repositoryUrl = item.repositoryUrl;
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

export class ReviewHistoryEntryResponseDto {
  readonly id: string;
  readonly eventKind: ApplicationReviewEventKind;
  readonly revision: number;
  readonly actor: {
    readonly name: string | null;
    readonly nickname: string;
  };
  readonly occurredAt: string;
  readonly rejectionReason: string | null;

  private constructor(entry: ApplicationReviewHistoryEntry) {
    this.id = entry.id;
    this.eventKind = entry.eventKind;
    this.revision = entry.revision;
    this.actor = entry.actor;
    this.occurredAt = entry.occurredAt.toISOString();
    this.rejectionReason = entry.rejectionReason;
  }

  static from(
    entry: ApplicationReviewHistoryEntry,
  ): ReviewHistoryEntryResponseDto {
    return new ReviewHistoryEntryResponseDto(entry);
  }
}

export class ApplicationDetailResponseDto extends ApplicationListItemResponseDto {
  readonly reviewHistory: readonly ReviewHistoryEntryResponseDto[];

  private constructor(detail: StaffApplicationDetail) {
    super(detail.application);
    this.reviewHistory = detail.reviewHistory.map((entry) =>
      ReviewHistoryEntryResponseDto.from(entry),
    );
  }

  static fromDetail(
    detail: StaffApplicationDetail,
  ): ApplicationDetailResponseDto {
    return new ApplicationDetailResponseDto(detail);
  }
}
