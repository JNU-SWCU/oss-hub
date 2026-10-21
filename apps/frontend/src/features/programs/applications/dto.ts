import type {
  ProgramParticipation,
  ApplicationStatus,
} from '../program-contract';

export interface ApplicationTemplateApiItem {
  readonly key: string;
  readonly version: number;
  readonly name: string;
  readonly participation: 'INDIVIDUAL' | 'TEAM' | ProgramParticipation;
  readonly fields: readonly {
    readonly key: ApplicationFormFieldKey;
    readonly type: ApplicationFormFieldType;
    readonly label: string;
    readonly required: boolean;
  }[];
}

export interface ApplicationTemplateListApiResponse {
  readonly items: readonly ApplicationTemplateApiItem[];
}

export interface CreateApplicationInput {
  readonly teamName?: string;
  readonly answers: { readonly title?: string };
  readonly applicationTemplateVersion: number;
  readonly isRepositoryPublicationPlanned: boolean;
}

export interface CreatedApplication {
  readonly id: string;
  readonly programId: string;
  readonly status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  readonly teamId: string | null;
  readonly submittedAt: string;
  readonly isRepositoryPublicationPlanned: boolean;
}

export type ApplicationDecisionInput =
  | { readonly action: 'APPROVE' }
  | { readonly action: 'REJECT'; readonly reason: string }
  | { readonly action: 'REVERT' };

export type ApplicationDecisionResponse =
  | {
      readonly applicationId: string;
      readonly status: 'APPROVED';
      readonly repositoryProvisioning: RepositoryProvisioning;
    }
  | {
      readonly applicationId: string;
      readonly status: 'REJECTED';
      readonly rejectionReason: string;
    }
  | {
      readonly applicationId: string;
      readonly status: 'SUBMITTED';
    };

export type ApplicationDecisionAction = 'APPROVE' | 'REJECT' | 'REVERT';

type ApplicationFormFieldType = 'auto' | 'text' | 'textarea';

type ApplicationFormFieldKey = 'applicantName' | 'title' | 'summary';

export interface ApplicationFormField {
  readonly key: ApplicationFormFieldKey;
  readonly type: ApplicationFormFieldType;
  readonly label: string;
  readonly required: boolean;
}

export interface ApplicationFormTemplate {
  readonly key: string;
  readonly version: number;
  readonly name: string;
  readonly participation: ProgramParticipation;
  readonly fields: readonly ApplicationFormField[];
}

export type ApplicationListStatus =
  'all' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export interface ApplicationListParams {
  readonly page: number;
  readonly pageSize: number;
  readonly search: string;
  readonly status: ApplicationListStatus;
}

interface TeamManagementMember {
  readonly id: string;
  readonly name: string | null;
  readonly nickname: string;
}

export interface TeamManagementListItem {
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
}

export interface TeamManagementListPage {
  readonly items: readonly TeamManagementListItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export type ReviewHistoryEventKind =
  'SUBMITTED' | 'RESUBMITTED' | 'APPROVED' | 'REJECTED' | 'REVERTED';

export interface ReviewHistoryEntry {
  readonly id: string;
  readonly eventKind: ReviewHistoryEventKind;
  readonly revision: number;
  readonly actor: {
    readonly name: string | null;
    readonly nickname: string;
  };
  readonly occurredAt: string;
  readonly rejectionReason: string | null;
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

type RepositoryProvisioningSafeErrorClass =
  'AUTH' | 'RATE_LIMIT' | 'UPSTREAM_REJECTED' | 'UNKNOWN';

export interface RepositoryProvisioning {
  readonly enabled: boolean;
  readonly jobStatus: RepositoryProvisioningJobStatus;
  readonly updatedAt: string;
  readonly safeErrorClass: RepositoryProvisioningSafeErrorClass | null;
}

export type RepositoryConnectionMode = 'NEW' | 'OWN';

export interface ApplicationListItem {
  readonly id: string;

  readonly programId: string;
  readonly repositoryConnectionMode: RepositoryConnectionMode;

  readonly repositoryUrl: string | null;
  readonly status: ApplicationStatus;
  readonly rejectionReason: string | null;
  readonly repositoryProvisioning: RepositoryProvisioning;
  readonly isRepositoryPublicationPlanned: boolean;
  readonly submittedAt: string;
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

  readonly repository: {
    readonly url: string;
    readonly visibility: 'PUBLIC' | 'PRIVATE';
  } | null;
  readonly answers: {
    readonly applicantName: string;
    readonly title: string;
    readonly summary: string;
  };
}

export interface ApplicationDetail extends ApplicationListItem {
  readonly reviewHistory: readonly ReviewHistoryEntry[];
}
