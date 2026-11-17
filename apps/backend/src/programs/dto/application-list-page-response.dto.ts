import type {
  TeamHistoryEvent,
  ApplicationStatus,
  RepositoryConnectionMode,
  RepositoryVisibility,
} from '@prisma/client';
import type {
  ApplicationListItem,
  ApplicationListPage,
  ApplicationReviewHistoryEntry,
  RepositoryProvisioningJobStatus,
  RepositoryProvisioningSafeErrorClass,
  StaffApplicationDetail,
} from '../team.repository';

class ApplicationRepositoryResponseDto {
  declare readonly url: string;
  declare readonly visibility: RepositoryVisibility;

  static from(
    repository: NonNullable<ApplicationListItem['repository']>,
  ): ApplicationRepositoryResponseDto {
    return { url: repository.url, visibility: repository.visibility };
  }
}

class ApplicationTeamResponseDto {
  declare readonly id: string;
  declare readonly name: string;
  declare readonly memberCount: number;

  static from(
    team: NonNullable<ApplicationListItem['team']>,
  ): ApplicationTeamResponseDto {
    return { id: team.id, name: team.name, memberCount: team.memberCount };
  }
}

export class ApplicationListItemResponseDto {
  declare readonly id: string;

  declare readonly programId: string;
  declare readonly status: ApplicationStatus;
  declare readonly submittedAt: string;
  declare readonly rejectionReason: string | null;

  declare readonly repositoryConnectionMode: RepositoryConnectionMode;

  declare readonly repositoryProvisioning: {
    readonly enabled: boolean;
    readonly jobStatus: RepositoryProvisioningJobStatus;
    readonly updatedAt: string;
    readonly safeErrorClass: RepositoryProvisioningSafeErrorClass | null;
  };

  declare readonly repository: ApplicationRepositoryResponseDto | null;
  declare readonly isRepositoryPublicationPlanned: boolean;
  declare readonly participation: 'INDIVIDUAL' | 'TEAM';
  declare readonly applicant: {
    readonly id: string;
    readonly name: string | null;
    readonly nickname: string;
  };
  declare readonly team: ApplicationTeamResponseDto | null;
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
      repositoryProvisioning: {
        enabled: item.repositoryProvisioning.enabled,
        jobStatus: item.repositoryProvisioning.jobStatus,
        updatedAt: item.repositoryProvisioning.updatedAt.toISOString(),
        safeErrorClass: item.repositoryProvisioning.safeErrorClass,
      },
      repository: item.repository
        ? ApplicationRepositoryResponseDto.from(item.repository)
        : null,
      isRepositoryPublicationPlanned: item.isRepositoryPublicationPlanned,
      participation: item.participation,
      applicant: item.applicant,
      team: item.team ? ApplicationTeamResponseDto.from(item.team) : null,
      answers: item.answers,
    };
  }
}

export class ApplicationListPageResponseDto {
  declare readonly items: ApplicationListItemResponseDto[];
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
  declare readonly eventKind: TeamHistoryEvent;
  declare readonly revision: number | null;
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

export class ApplicationDetailResponseDto {
  declare readonly id: string;

  declare readonly programId: string;
  declare readonly status: ApplicationStatus;
  declare readonly submittedAt: string;
  declare readonly rejectionReason: string | null;

  declare readonly repositoryConnectionMode: RepositoryConnectionMode;

  declare readonly repositoryProvisioning: {
    readonly enabled: boolean;
    readonly jobStatus: RepositoryProvisioningJobStatus;
    readonly updatedAt: string;
    readonly safeErrorClass: RepositoryProvisioningSafeErrorClass | null;
  };

  declare readonly repository: ApplicationRepositoryResponseDto | null;
  declare readonly isRepositoryPublicationPlanned: boolean;
  declare readonly participation: 'INDIVIDUAL' | 'TEAM';
  declare readonly applicant: {
    readonly id: string;
    readonly name: string | null;
    readonly nickname: string;
  };
  declare readonly team: ApplicationTeamResponseDto | null;
  declare readonly answers: {
    readonly applicantName: string;
    readonly title: string;
    readonly summary: string;
  };
  declare readonly reviewHistory: ReviewHistoryEntryResponseDto[];

  static from(detail: StaffApplicationDetail): ApplicationDetailResponseDto {
    const item = ApplicationListItemResponseDto.from(detail.application);
    return {
      id: item.id,
      programId: item.programId,
      status: item.status,
      submittedAt: item.submittedAt,
      rejectionReason: item.rejectionReason,
      repositoryConnectionMode: item.repositoryConnectionMode,
      repositoryProvisioning: item.repositoryProvisioning,
      repository: item.repository,
      isRepositoryPublicationPlanned: item.isRepositoryPublicationPlanned,
      participation: item.participation,
      applicant: item.applicant,
      team: item.team,
      answers: item.answers,
      reviewHistory: detail.reviewHistory.map((entry) =>
        ReviewHistoryEntryResponseDto.from(entry),
      ),
    };
  }
}
