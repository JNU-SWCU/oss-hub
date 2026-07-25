import type { ProgramCategory } from './program-templates';

export type ViewerRole = 'STUDENT' | 'STAFF' | 'ADMIN' | 'PENDING' | null;
export type ApplicationStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED';
export type SubmissionStatus =
  'NOT_SUBMITTED' | 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
export type SubmissionType = 'FILE' | 'TEXT' | 'REPOSITORY_RELEASE';

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

export interface ProgramListItem {
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly category: ProgramCategory;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  readonly description: string;
}

export const PROGRAM_LIST_STATUSES = ['all', 'recruiting', 'closed'] as const;
export type ProgramListStatus = (typeof PROGRAM_LIST_STATUSES)[number];

export interface ProgramListParams {
  readonly page: number;
  readonly pageSize: number;
  readonly search: string;
  readonly status: ProgramListStatus;
}

export interface ProgramListPage {
  readonly items: readonly ProgramListItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export const APPLICATION_LIST_STATUSES = [
  'all',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
] as const;
export type ApplicationListStatus = (typeof APPLICATION_LIST_STATUSES)[number];

export const APPLICATION_LIST_MODES = ['all', 'personal', 'team'] as const;
export type ApplicationListMode = (typeof APPLICATION_LIST_MODES)[number];

export interface ApplicationListParams {
  readonly page: number;
  readonly pageSize: number;
  readonly search: string;
  readonly status: ApplicationListStatus;
  readonly mode: ApplicationListMode;
}

export interface ApplicationListItem {
  readonly id: string;
  readonly status: ApplicationStatus;
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
  readonly answers: {
    readonly applicantName: string;
    readonly title: string;
    readonly summary: string;
  };
}

export interface ApplicationListPage {
  readonly items: readonly ApplicationListItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
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
  readonly submissionType: SubmissionType;
  readonly viewerSubmissionStatus: SubmissionStatus | null;
  readonly applicationSubmissionSummary: SubmissionSummary | null;
}

export interface ProgramDetail {
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly category: ProgramCategory;
  readonly description: string;
  readonly applicationPeriod: {
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
  readonly lastActivityAt: string | null;
}
