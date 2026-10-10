import { ApiError, apiClient } from '@/lib/api-client';
import { PROGRAM_EDIT_ERROR_CODES } from './program-edit-error-codes';
import type { ProgramTrackType } from './program-templates';
import { parseStaffDashboardSummary } from './staff-dashboard-parser';
import type {
  ApplicationFormField,
  ApplicationFormFieldKey,
  ApplicationFormFieldType,
  ApplicationFormTemplate,
  ApplicationDetail,
  ApplicationListItem,
  ApplicationListParams,
  DeletedTeamResult,
  ProgramActivity,
  ProgramDetail,
  ProgramListPage,
  ProgramListParams,
  ProgramStatusCounts,
  RepositoryProvisioning,
  RenamedTeam,
  StaffProgramTeam,
  StaffTeamDetail,
  TeamDeletionScope,
  TeamManagementListPage,
  ProgramParticipation,
  StaffDashboardSummary,
  SubmissionType,
} from './types';

const jsonHeaders = { 'Content-Type': 'application/json' } as const;

interface ApplicationTemplateApiItem {
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

interface ApplicationTemplateListApiResponse {
  readonly items: readonly ApplicationTemplateApiItem[];
}

function mapParticipation(
  value: ApplicationTemplateApiItem['participation'],
): ProgramParticipation {
  void value;
  return 'team';
}

function mapApplicationTemplate(
  item: ApplicationTemplateApiItem,
): ApplicationFormTemplate {
  const fields: ApplicationFormField[] = item.fields.map((field) => ({
    key: field.key,
    type: field.type,
    label: field.label,
    required: field.required,
  }));
  return {
    key: item.key,
    version: item.version,
    name: item.name,
    participation: mapParticipation(item.participation),
    fields,
  };
}

export function listApplicationTemplates(): Promise<
  readonly ApplicationFormTemplate[]
> {
  return apiClient<ApplicationTemplateListApiResponse>(
    'programs/application-templates',
  ).then((response) => response.items.map(mapApplicationTemplate));
}

interface CreateProgramInput {
  readonly name: string;
  readonly organizer: string;
  readonly trackType: ProgramTrackType;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  readonly endAt: string;
  readonly teamMinSize: number | null;
  readonly teamMaxSize: number | null;
  readonly description: string;
}

export interface EditableMilestone {
  readonly id: string;
  readonly name: string;
  readonly startAt: string;
  readonly dueAt: string;
  readonly submissionType: SubmissionType | null;
  readonly instructions: string | null;
}

export interface EditableMilestoneDocument {
  readonly id: string;
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
  readonly templateFileName: string | null;
}

export interface EditableMilestoneEditSnapshot {
  readonly milestone: EditableMilestone;
  readonly operation: {
    readonly startAt: string;
    readonly endAt: string;
  };
  readonly documents: readonly EditableMilestoneDocument[];
  readonly fileUpload: {
    readonly maxBytes: number;
    readonly maxLabel: string;
    readonly accept: string;
    readonly formatLabel: string;
  };
  readonly fingerprint: string;
}

export type UpdateEditableMilestoneDocumentInput = {
  readonly id: string | null;
  readonly name: string;
  readonly required: boolean;
  readonly templateUploadId?: string;
};

export type UpdateEditableMilestoneInput = {
  readonly expectedFingerprint: string;
  readonly name: string;
  readonly startAt: string;
  readonly dueAt: string;
  readonly instructions: string | null;
  readonly documents: readonly UpdateEditableMilestoneDocumentInput[];
};

export type EditableMilestoneSnapshotFailure =
  | { readonly kind: 'conflict' }
  | {
      readonly kind: 'known';
      readonly message: string;
      readonly fieldErrors: readonly {
        readonly field: string;
        readonly message: string;
        readonly code: string;
      }[];
    }
  | { readonly kind: 'unknown' };

export function editableMilestoneSnapshotFailure(
  error: unknown,
): EditableMilestoneSnapshotFailure {
  if (!(error instanceof ApiError)) return { kind: 'unknown' };
  if (
    error.problem.status === 409 &&
    error.problem.code === PROGRAM_EDIT_ERROR_CODES.MILESTONE_EDIT_CHANGED
  )
    return { kind: 'conflict' };
  if (
    error.problem.status >= 400 &&
    error.problem.status < 500 &&
    error.problem.code !== 'API_000'
  )
    return {
      kind: 'known',
      message: error.problem.detail,
      fieldErrors:
        error.problem.fieldErrors?.map(({ field, message, code }) => ({
          field,
          message,
          code,
        })) ?? [],
    };
  return { kind: 'unknown' };
}

export interface ProgramDeletionScopeCounts {
  readonly applications: number;
  readonly teams: number;
  readonly boardPosts: number;
  readonly submissions: number;
  readonly submissionEvents: number;
  readonly scopeFingerprint: string;
}

export interface EditableProgram {
  readonly coverImageUrl?: string | null;
  readonly externalCover?:
    import('./program-cover-selection').ExternalProgramCover | null;
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly trackType: ProgramTrackType | null;
  readonly lifecycle: 'PUBLISHED' | 'ARCHIVED';
  readonly applicationTemplateKey: string;
  readonly applicationTemplateVersion: number;
  readonly applicationCount: number;

  readonly deletionScopeCounts?: ProgramDeletionScopeCounts;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;

  readonly startAt?: string;
  readonly endAt: string | null;
  readonly repositoryProvisioningEnabled: boolean;
  readonly notifyOnDeadline: boolean;
  readonly description: string;
  readonly teamMinSize: number | null;
  readonly teamMaxSize: number | null;
  readonly milestones: readonly EditableMilestone[];
}

export type UpdateProgramInput = Omit<CreateProgramInput, 'endAt'> & {
  readonly coverUploadId?: string | null;
  readonly externalCover?:
    import('./program-cover-selection').ExternalProgramCover | null;
  readonly startAt: string;
  readonly endAt: string | null;
  readonly repositoryProvisioningEnabled: boolean;
  readonly notifyOnDeadline: boolean;
};

export interface UpsertMilestoneInput {
  readonly name: string;
  readonly startAt: string;
  readonly dueAt: string;
  readonly instructions: string | null;
}

export function listPrograms(
  params: ProgramListParams,
): Promise<ProgramListPage> {
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
    search: params.search,
    status: params.status,
  });
  if (params.sort) search.set('sort', params.sort);
  if (params.direction) search.set('direction', params.direction);
  return apiClient<ProgramListPage>('programs?' + search.toString());
}

export function getProgramStatusCounts(): Promise<ProgramStatusCounts> {
  return apiClient<ProgramStatusCounts>('programs/status-counts');
}

export function getPublicProgramDetail(
  programId: string,
): Promise<ProgramDetail> {
  return apiClient<ProgramDetail>(`programs/${encodeURIComponent(programId)}`);
}

export async function getProgramDetail(
  programId: string,
): Promise<ProgramDetail> {
  const encodedId = encodeURIComponent(programId);
  try {
    return await apiClient<ProgramDetail>(`programs/${encodedId}/viewer`);
  } catch (error: unknown) {
    if (!(error instanceof ApiError) || error.problem.status !== 401)
      throw error;
    return getPublicProgramDetail(programId);
  }
}

export function getProgramActivity(
  programId: string,
): Promise<readonly ProgramActivity[]> {
  return apiClient<readonly ProgramActivity[]>(
    `programs/${encodeURIComponent(programId)}/activity`,
  );
}

export function getEditableProgram(
  programId: string,
): Promise<EditableProgram> {
  return apiClient<EditableProgram>(
    `programs/${encodeURIComponent(programId)}/edit`,
  );
}

export function updateProgram(
  programId: string,
  input: UpdateProgramInput,
): Promise<EditableProgram> {
  return apiClient<EditableProgram>(
    `programs/${encodeURIComponent(programId)}`,
    {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(input),
    },
  );
}

export function getEditableMilestone(
  milestoneId: string,
): Promise<EditableMilestoneEditSnapshot> {
  return apiClient<EditableMilestoneEditSnapshot>(
    `milestones/${encodeURIComponent(milestoneId)}/edit`,
  );
}

export function updateEditableMilestone(
  milestoneId: string,
  input: UpdateEditableMilestoneInput,
): Promise<EditableMilestoneEditSnapshot> {
  return apiClient<EditableMilestoneEditSnapshot>(
    `milestones/${encodeURIComponent(milestoneId)}`,
    {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(input),
    },
  );
}

export function createMilestone(
  programId: string,
  input: UpsertMilestoneInput,
): Promise<EditableMilestone> {
  return apiClient<EditableMilestone>(
    `programs/${encodeURIComponent(programId)}/milestones`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(input),
    },
  );
}

export function deleteMilestone(
  milestoneId: string,
): Promise<{ readonly deleted: true }> {
  return apiClient<{ readonly deleted: true }>(
    `milestones/${encodeURIComponent(milestoneId)}`,
    { method: 'DELETE' },
  );
}

export interface CreateApplicationInput {
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

export function createApplication(
  programId: string,
  input: CreateApplicationInput,
): Promise<CreatedApplication> {
  return apiClient<CreatedApplication>(
    `programs/${encodeURIComponent(programId)}/applications`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        answers: input.answers,
        applicationTemplateVersion: input.applicationTemplateVersion,
        isRepositoryPublicationPlanned: input.isRepositoryPublicationPlanned,
      }),
    },
  );
}

export interface TeamMember {
  readonly userId: string;
  readonly nickname: string;
  readonly name: string | null;
  readonly isLeader: boolean;
}

export interface ProgramTeam {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
  readonly minMembers: number | null;
  readonly maxMembers: number;
  readonly hasApplication: boolean;
  readonly canInvite: boolean;
  readonly canRemoveMembers: boolean;
  readonly canLeave: boolean;
  readonly isLeader: boolean;
  readonly members: readonly TeamMember[];
}

export interface CreatedTeam {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
}

export class ProgramTeamResponseError extends Error {
  constructor() {
    super('팀 응답 형식이 올바르지 않습니다.');
    this.name = 'ProgramTeamResponseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isTeamMember(value: unknown): value is TeamMember {
  return (
    isRecord(value) &&
    isNonEmptyString(value.userId) &&
    isNonEmptyString(value.nickname) &&
    (value.name === null || typeof value.name === 'string') &&
    typeof value.isLeader === 'boolean'
  );
}

function parseProgramTeam(value: unknown): ProgramTeam {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    typeof value.name !== 'string' ||
    typeof value.memberCount !== 'number' ||
    !(value.minMembers === null || typeof value.minMembers === 'number') ||
    typeof value.maxMembers !== 'number' ||
    typeof value.hasApplication !== 'boolean' ||
    typeof value.canInvite !== 'boolean' ||
    typeof value.canRemoveMembers !== 'boolean' ||
    typeof value.canLeave !== 'boolean' ||
    typeof value.isLeader !== 'boolean' ||
    !Array.isArray(value.members) ||
    !value.members.every(isTeamMember)
  ) {
    throw new ProgramTeamResponseError();
  }
  return {
    id: value.id,
    name: value.name,
    memberCount: value.memberCount,
    minMembers: value.minMembers,
    maxMembers: value.maxMembers,
    hasApplication: value.hasApplication,
    canInvite: value.canInvite,
    canRemoveMembers: value.canRemoveMembers,
    canLeave: value.canLeave,
    isLeader: value.isLeader,
    members: value.members,
  };
}

export async function getMyTeam(
  programId: string,
): Promise<ProgramTeam | null> {
  const body = await apiClient<unknown>(
    `programs/${encodeURIComponent(programId)}/teams/me`,
  );
  return body === null ? null : parseProgramTeam(body);
}

export function leaveMyTeam(programId: string): Promise<void> {
  return apiClient<void>(`programs/${encodeURIComponent(programId)}/teams/me`, {
    method: 'DELETE',
  });
}

export function removeMyTeamMember(
  programId: string,
  userId: string,
): Promise<void> {
  return apiClient<void>(
    `programs/${encodeURIComponent(programId)}/teams/me/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );
}

export function createTeam(
  programId: string,
  input: { readonly name: string },
): Promise<CreatedTeam> {
  return apiClient<CreatedTeam>(
    `programs/${encodeURIComponent(programId)}/teams`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(input),
    },
  );
}

export function listTeamManagementApplications(
  programId: string,
  params: ApplicationListParams,
): Promise<TeamManagementListPage> {
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
    search: params.search,
    status: params.status,
    view: 'team-management',
  });
  return apiClient<TeamManagementListPage>(
    `programs/${encodeURIComponent(programId)}/applications?${search.toString()}`,
  );
}

export function getApplicationDetail(
  applicationId: string,
): Promise<ApplicationListItem> {
  return apiClient<ApplicationListItem>(
    `applications/${encodeURIComponent(applicationId)}`,
  );
}

export async function getApplicationDetailWithHistory(
  applicationId: string,
): Promise<ApplicationDetail> {
  const detail = await apiClient<ApplicationDetail>(
    `applications/${encodeURIComponent(applicationId)}`,
  );

  return Array.isArray(detail.reviewHistory)
    ? detail
    : { ...detail, reviewHistory: [] };
}

export function listStaffProgramTeams(
  programId: string,
): Promise<readonly StaffProgramTeam[]> {
  return apiClient<readonly StaffProgramTeam[]>(
    `programs/${encodeURIComponent(programId)}/teams`,
  );
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

export function decideApplication(
  applicationId: string,
  input: ApplicationDecisionInput,
): Promise<ApplicationDecisionResponse> {
  return apiClient<ApplicationDecisionResponse>(
    `applications/${encodeURIComponent(applicationId)}`,
    {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(input),
    },
  );
}

export async function getStaffDashboardSummary(): Promise<StaffDashboardSummary> {
  return parseStaffDashboardSummary(
    await apiClient<unknown>('dashboard/staff/summary'),
  );
}

export function deleteProgram(
  programId: string,
): Promise<{ readonly id: string; readonly deleted: true }> {
  return apiClient<{ readonly id: string; readonly deleted: true }>(
    `programs/${encodeURIComponent(programId)}`,
    { method: 'DELETE' },
  );
}

export interface ProgramPurgeDeletedCounts {
  readonly applications: number;
  readonly teams: number;
  readonly teamMembers: number;
  readonly teamInvitations: number;
  readonly boardPosts: number;
  readonly boardComments: number;
  readonly submissions: number;
  readonly submissionRevisions: number;
  readonly reviews: number;
  readonly submissionFiles: number;
  readonly milestones: number;
  readonly milestoneDocuments: number;
  readonly milestoneDocumentSubmissions: number;
  readonly milestoneDocumentSubmissionHistories: number;
  readonly milestoneDocumentReviewHistories: number;
  readonly milestoneDocumentTemplateFiles: number;
  readonly programAuthoringUploads: number;
  readonly programCreateRequests: number;
  readonly repositoryProvisionJobs: number;
  readonly githubRepositoriesDetached: number;
  readonly outboxEvents: number;
  readonly notifications: number;
  readonly programPurgeFileTombstones: number;
}

export interface ProgramPurgeResult {
  readonly id: string;
  readonly deleted: true;
  readonly deletedCounts: ProgramPurgeDeletedCounts;
}

export function purgeProgram(
  programId: string,
  expectedScope: ProgramDeletionScopeCounts,
): Promise<ProgramPurgeResult> {
  return apiClient<ProgramPurgeResult>(
    `programs/${encodeURIComponent(programId)}/purge`,
    {
      method: 'DELETE',
      headers: jsonHeaders,
      body: JSON.stringify({ expectedScope }),
    },
  );
}

export async function getStaffProgramTeamDetail(
  programId: string,
  teamId: string,
): Promise<StaffTeamDetail> {
  return apiClient<StaffTeamDetail>(
    `programs/${encodeURIComponent(programId)}/teams/${encodeURIComponent(teamId)}`,
  );
}

export function renameProgramTeam(
  programId: string,
  teamId: string,
  name: string,
): Promise<RenamedTeam> {
  return apiClient<RenamedTeam>(
    `programs/${encodeURIComponent(programId)}/teams/${encodeURIComponent(teamId)}`,
    {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ name }),
    },
  );
}

export function deleteStaffProgramTeam(
  programId: string,
  teamId: string,
  expectedScope: TeamDeletionScope,

  notificationMessage?: string,
): Promise<DeletedTeamResult> {
  const trimmed = notificationMessage?.trim();
  return apiClient<DeletedTeamResult>(
    `programs/${encodeURIComponent(programId)}/teams/${encodeURIComponent(teamId)}`,
    {
      method: 'DELETE',
      headers: jsonHeaders,

      body: JSON.stringify(
        trimmed
          ? { expectedScope, notificationMessage: trimmed }
          : { expectedScope },
      ),
    },
  );
}
