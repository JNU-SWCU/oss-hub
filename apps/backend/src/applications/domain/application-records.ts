import type {
  ApplicationReviewEventKind,
  ApplicationStatus,
  ProgramLifecycle,
  ProgramTrackType,
  RepositoryConnectionMode,
  RepositoryVisibility,
} from '@prisma/client';

export interface CreatedApplication {
  readonly id: string;
  readonly programId: string;
  readonly status: ApplicationStatus;
  readonly teamId: string;
  readonly submittedAt: Date;
  readonly isRepositoryPublicationPlanned: boolean;
  readonly repositoryConnectionMode: RepositoryConnectionMode;
  readonly repositoryUrl: string | null;
}

export interface ApplicationListAnswers {
  readonly applicantName: string;
  readonly title: string;
  readonly summary: string;
}

export type RepositoryProvisioningJobStatus =
  | 'NOT_REQUESTED'
  | 'DISABLED'
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'RETRYABLE_FAILED'
  | 'FAILED'
  | 'ANOMALOUS';

export type RepositoryProvisioningSafeErrorClass =
  'AUTH' | 'RATE_LIMIT' | 'UPSTREAM_REJECTED' | 'UNKNOWN';

export interface ApplicationRepositoryProvisioning {
  readonly enabled: boolean;
  readonly jobStatus: RepositoryProvisioningJobStatus;
  readonly updatedAt: Date;
  readonly safeErrorClass: RepositoryProvisioningSafeErrorClass | null;
}

export interface ApplicationListRepository {
  readonly url: string;
  readonly visibility: RepositoryVisibility;
}

export interface ApplicationListItem {
  readonly id: string;

  readonly programId: string;
  readonly status: ApplicationStatus;
  readonly submittedAt: Date;
  readonly rejectionReason: string | null;
  readonly repositoryProvisioning: ApplicationRepositoryProvisioning;

  readonly repositoryConnectionMode: RepositoryConnectionMode;

  readonly repositoryUrl: string | null;
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
  readonly answers: ApplicationListAnswers;
}

export interface ApplicationListPage {
  readonly items: readonly ApplicationListItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export interface TeamManagementMember {
  readonly id: string;
  readonly name: string | null;
  readonly nickname: string;
}

export interface TeamManagementListItem {
  readonly id: string;
  readonly programId: string;
  readonly status: ApplicationStatus;
  readonly submittedAt: Date;
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
}

export interface TeamManagementListPage {
  readonly items: readonly TeamManagementListItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export interface ApplicationReviewHistoryEntry {
  readonly id: string;
  readonly eventKind: ApplicationReviewEventKind;
  readonly revision: number;
  readonly actor: {
    readonly name: string | null;
    readonly nickname: string;
  };
  readonly occurredAt: Date;
  readonly rejectionReason: string | null;
}

export interface StaffApplicationDetail {
  readonly application: ApplicationListItem;
  readonly reviewHistory: readonly ApplicationReviewHistoryEntry[];
}

export interface StaffDashboardApplicationCounts {
  readonly total: number;
  readonly submitted: number;
  readonly approved: number;
  readonly rejected: number;
}

export interface StaffDashboardProgramSummary {
  readonly coverId?: string | null;
  readonly coverExternalImageUrl?: string | null;
  readonly id: string;
  readonly name: string;
  readonly trackType: ProgramTrackType | null;
  readonly applicationPeriod: {
    readonly startsAt: Date;
    readonly endsAt: Date;
  };

  readonly endAt: Date;

  readonly lifecycle: ProgramLifecycle;
  readonly applications: StaffDashboardApplicationCounts;
  readonly teamManagementPath: string;
}

export interface StaffDashboardSummary {
  readonly programs: readonly StaffDashboardProgramSummary[];
}
