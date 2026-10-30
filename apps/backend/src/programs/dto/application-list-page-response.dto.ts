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
} from '../application-records.types';

export class ApplicationListItemResponseDto {
  declare readonly id: string;

  declare readonly programId: string;
  declare readonly status: ApplicationStatus;
  declare readonly submittedAt: string;
  declare readonly rejectionReason: string | null;

  declare readonly repositoryConnectionMode: RepositoryConnectionMode;

  declare readonly repositoryUrl: string | null;
  declare readonly repositoryProvisioning: {
    readonly enabled: boolean;
    readonly jobStatus: RepositoryProvisioningJobStatus;
    readonly updatedAt: string;
    readonly safeErrorClass: RepositoryProvisioningSafeErrorClass | null;
  };

  declare readonly repository: ApplicationListRepository | null;
  declare readonly isRepositoryPublicationPlanned: boolean;
  declare readonly participation: 'INDIVIDUAL' | 'TEAM';
  declare readonly applicant: {
    readonly id: string;
    readonly name: string | null;
    readonly nickname: string;
  };
  declare readonly team: {
    readonly id: string;
    readonly name: string;
    readonly memberCount: number;
  } | null;
  declare readonly answers: {
    readonly applicantName: string;
    readonly title: string;
    readonly summary: string;
  };

  static from(item: ApplicationListItem): ApplicationListItemResponseDto {
    return {
      id: item.id,
      programId: item.programId,
      status: item.status,
      submittedAt: item.submittedAt.toISOString(),
      rejectionReason: item.rejectionReason,
      repositoryConnectionMode: item.repositoryConnectionMode,
      repositoryUrl: item.repositoryUrl,
      repositoryProvisioning: {
        ...item.repositoryProvisioning,
        updatedAt: item.repositoryProvisioning.updatedAt.toISOString(),
      },
      repository: item.repository,
      isRepositoryPublicationPlanned: item.isRepositoryPublicationPlanned,
      participation: item.participation,
      applicant: item.applicant,
      team: item.team,
      answers: item.answers,
    };
  }
}

export class ApplicationListPageResponseDto {
  declare readonly items: readonly ApplicationListItemResponseDto[];
  declare readonly page: number;
  declare readonly pageSize: number;
  declare readonly totalItems: number;
  declare readonly totalPages: number;

  static from(page: ApplicationListPage): ApplicationListPageResponseDto {
    return {
      items: page.items.map((item) =>
        ApplicationListItemResponseDto.from(item),
      ),
      page: page.page,
      pageSize: page.pageSize,
      totalItems: page.totalItems,
      totalPages: page.totalPages,
    };
  }
}

export class ReviewHistoryEntryResponseDto {
  declare readonly id: string;
  declare readonly eventKind: ApplicationReviewEventKind;
  declare readonly revision: number;
  declare readonly actor: {
    readonly name: string | null;
    readonly nickname: string;
  };
  declare readonly occurredAt: string;
  declare readonly rejectionReason: string | null;

  static from(
    entry: ApplicationReviewHistoryEntry,
  ): ReviewHistoryEntryResponseDto {
    return {
      id: entry.id,
      eventKind: entry.eventKind,
      revision: entry.revision,
      actor: entry.actor,
      occurredAt: entry.occurredAt.toISOString(),
      rejectionReason: entry.rejectionReason,
    };
  }
}

export class ApplicationDetailResponseDto extends ApplicationListItemResponseDto {
  declare readonly reviewHistory: readonly ReviewHistoryEntryResponseDto[];

  static fromDetail(
    detail: StaffApplicationDetail,
  ): ApplicationDetailResponseDto {
    return {
      ...ApplicationListItemResponseDto.from(detail.application),
      reviewHistory: detail.reviewHistory.map((entry) =>
        ReviewHistoryEntryResponseDto.from(entry),
      ),
    };
  }
}
