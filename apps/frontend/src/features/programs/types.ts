import type { ProgramTrackType } from './program-templates';
import type { PublishBlockedReason } from '@/lib/repository-publication';

export type ViewerRole = 'STUDENT' | 'STAFF' | 'ADMIN' | 'PENDING' | null;
export type ApplicationStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export type ApplicationDecisionAction = 'APPROVE' | 'REJECT' | 'REVERT';
export type SubmissionStatus =
  'NOT_SUBMITTED' | 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
export type SubmissionType = 'FILE' | 'TEXT';

export const PROGRAM_PARTICIPATION_TYPES = ['individual', 'team'] as const;
export type ProgramParticipation = (typeof PROGRAM_PARTICIPATION_TYPES)[number];

export const APPLICATION_FIELD_TYPES = ['auto', 'text', 'textarea'] as const;
export type ApplicationFormFieldType = (typeof APPLICATION_FIELD_TYPES)[number];

export const APPLICATION_FIELD_KEYS = [
  'applicantName',
  'title',
  'summary',
] as const;
export type ApplicationFormFieldKey = (typeof APPLICATION_FIELD_KEYS)[number];

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

export interface ProgramListItemNote {
  readonly text: string;
  readonly icon?: 'team';
}

export interface ProgramListItem {
  readonly coverImageUrl?: string | null;
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly trackType: ProgramTrackType | null;

  readonly lifecycle?: 'PUBLISHED' | 'ARCHIVED';
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;

  readonly endAt: string | null;
  readonly description: string;

  readonly note?: ProgramListItemNote;

  readonly viewerApplicationStatus?: ApplicationStatus;

  readonly applicationCount?: number;

  readonly pendingApplicationCount?: number;
}

export const PROGRAM_LIST_STATUSES = [
  'all',
  'recruiting',
  'in_progress',
  'upcoming',
  'ended',
] as const;
export type ProgramListStatus = (typeof PROGRAM_LIST_STATUSES)[number];

export const PROGRAM_LIST_STATUS_LABELS = {
  all: '전체',
  recruiting: '모집중',
  in_progress: '진행중',
  upcoming: '예정',
  ended: '종료',
} as const satisfies Readonly<Record<ProgramListStatus, string>>;

export function programListHref(status: ProgramListStatus): string {
  if (status === 'all') return '/programs';
  return `/programs?status=${status}`;
}

export const PROGRAM_LIST_SORTS = [
  'name',
  'applicationPeriod',
  'status',
] as const;
export type ProgramListSort = (typeof PROGRAM_LIST_SORTS)[number];

export const PROGRAM_LIST_SORT_LABELS = {
  name: '프로그램 이름',
  applicationPeriod: '지원 기간',
  status: '상태',
} as const satisfies Readonly<Record<ProgramListSort, string>>;

export const PROGRAM_LIST_DIRECTIONS = ['asc', 'desc'] as const;
export type ProgramListDirection = (typeof PROGRAM_LIST_DIRECTIONS)[number];

export interface ProgramListParams {
  readonly page: number;
  readonly pageSize: number;
  readonly search: string;
  readonly status: ProgramListStatus;

  readonly sort?: ProgramListSort;
  readonly direction?: ProgramListDirection;
}

export interface ProgramListPage {
  readonly items: readonly ProgramListItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export type ProgramStatusCounts = Readonly<Record<ProgramListStatus, number>>;

export const APPLICATION_LIST_STATUSES = [
  'all',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
] as const;
export type ApplicationListStatus = (typeof APPLICATION_LIST_STATUSES)[number];

export interface ApplicationListParams {
  readonly page: number;
  readonly pageSize: number;
  readonly search: string;
  readonly status: ApplicationListStatus;
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

export const REVIEW_HISTORY_EVENT_KINDS = [
  'SUBMITTED',
  'RESUBMITTED',
  'APPROVED',
  'REJECTED',
  'REVERTED',
] as const;
export type ReviewHistoryEventKind =
  (typeof REVIEW_HISTORY_EVENT_KINDS)[number];

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

export const REPOSITORY_PROVISIONING_JOB_STATUSES = [
  'NOT_REQUESTED',
  'DISABLED',
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'RETRYABLE_FAILED',
  'FAILED',
  'ANOMALOUS',
] as const;
export type RepositoryProvisioningJobStatus =
  (typeof REPOSITORY_PROVISIONING_JOB_STATUSES)[number];
export type RepositoryProvisioningSafeErrorClass =
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

export interface StaffProgramTeamMember {
  readonly userId: string;
  readonly name: string | null;
  readonly nickname: string;
  readonly isLeader: boolean;
}

export interface StaffProgramTeam {
  readonly teamId: string;
  readonly name: string;
  readonly memberCount: number;
  readonly members: readonly StaffProgramTeamMember[];
}

export interface StaffTeamDetailApplication {
  readonly id: string;
  readonly status: ApplicationStatus;
  readonly repositoryConnectionMode: RepositoryConnectionMode;
  readonly repository: {
    readonly id: string;
    readonly url: string;
    readonly visibility: 'PUBLIC' | 'PRIVATE';
    readonly publishEligible: boolean;
    readonly blockedReasons: readonly PublishBlockedReason[];
  } | null;
  readonly repositoryProvisioning: RepositoryProvisioning;
}

export interface TeamDeletionScope {
  readonly applications: number;
  readonly members: number;
  readonly invitations: number;
  readonly submissions: number;
  readonly submissionEvents: number;
  readonly detachedRepositories: number;
  readonly scopeFingerprint: string;
}

export type TeamDeletedCounts = Omit<TeamDeletionScope, 'scopeFingerprint'>;

export interface DeletedTeamResult {
  readonly teamId: string;
  readonly deleted: true;
  readonly deletedCounts: TeamDeletedCounts;
}

export interface StaffTeamDetail {
  readonly teamId: string;
  readonly name: string;
  readonly memberCount: number;
  readonly members: readonly StaffProgramTeamMember[];
  readonly application: StaffTeamDetailApplication | null;

  readonly deletionScope: TeamDeletionScope;

  readonly repositoryContributions: {
    readonly outsiderContributions: StaffOutsiderContributions | null;
  } | null;
}

export interface StaffOutsiderContributions {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
}

export interface RenamedTeam {
  readonly teamId: string;
  readonly name: string;
}

export interface ApplicationListPage {
  readonly items: readonly ApplicationListItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export interface StaffDashboardApplicationCounts {
  readonly total: number;
  readonly submitted: number;
  readonly pendingApproval: number;
  readonly approved: number;
  readonly rejected: number;
}

export interface StaffDashboardActivitySummary {
  readonly repositories: number;
  readonly commits: number;
  readonly pullRequests: number;
  readonly releases: number;
  readonly lastActivityAt: string | null;
  readonly dataAsOf: string | null;
}

export interface StaffDashboardSubmissionSummary {
  readonly approvedApplications: number;
  readonly milestones: number;
  readonly total: number;
  readonly notSubmitted: number;
  readonly submitted: number;
  readonly approved: number;
  readonly changesRequested: number;
  readonly rejected: number;
}

export interface StaffDashboardProgramSummary {
  readonly coverImageUrl?: string | null;
  readonly id: string;
  readonly name: string;
  readonly trackType: ProgramTrackType | null;
  readonly applicationPeriod: {
    readonly startsAt: string;
    readonly endsAt: string;
  };

  readonly endAt: string;

  readonly lifecycle: 'PUBLISHED' | 'ARCHIVED';
  readonly applications: StaffDashboardApplicationCounts;
  readonly teamManagementPath: string;
  readonly activity: StaffDashboardActivitySummary;
  readonly submissions: StaffDashboardSubmissionSummary;
}

export interface StaffDashboardSummary {
  readonly programs: readonly StaffDashboardProgramSummary[];
}

export interface SubmissionSummary {
  readonly notSubmitted: number;
  readonly submitted: number;
  readonly approved: number;
  readonly changesRequested: number;
  readonly rejected: number;
  readonly total: number;
}

export interface ProgramMilestone {
  readonly id: string;
  readonly name: string;
  readonly dueAt: string;
  readonly dDay: number;
  readonly deadlineLabel: string;
  readonly description: string | null;
  readonly submissionType: SubmissionType | null;
  readonly submissionItemCount: number;
  readonly viewerSubmissionStatus: SubmissionStatus | null;
  readonly applicationSubmissionSummary: SubmissionSummary | null;
}

export interface ProgramDetail {
  readonly coverImageUrl?: string | null;
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly trackType: ProgramTrackType | null;
  readonly applicationTemplateKey: string;

  readonly lifecycle: 'PUBLISHED' | 'ARCHIVED';
  readonly description: string;
  readonly repositoryProvisioningEnabled: boolean;
  readonly applicationPeriod: {
    readonly startsAt: string;
    readonly endsAt: string;
  };

  readonly operatingPeriod?: {
    readonly startsAt: string;
    readonly endsAt: string;
  };
  readonly viewer: {
    readonly role: ViewerRole;
    readonly applicationStatus: ApplicationStatus | null;
  };
  readonly milestones: readonly ProgramMilestone[];
}

export interface ProgramActivity {
  readonly applicationId: string;
  readonly label: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
  readonly dataAsOf: string | null;
  readonly lastActivityAt: string | null;
  readonly collectionStatus: 'NOT_CONNECTED' | 'EMPTY' | 'FAILED' | 'READY';
  readonly members: readonly {
    readonly githubLogin: string;
    readonly commitCount: number;
    readonly pullRequestCount: number;
    readonly releaseCount: number;
  }[];
  readonly hasIncompleteContributions: boolean;
}

export interface ApplicationDetail extends ApplicationListItem {
  readonly reviewHistory: readonly ReviewHistoryEntry[];
}
