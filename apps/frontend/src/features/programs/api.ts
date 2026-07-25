import { ApiError, apiClient } from '@/lib/api-client';
import type { ProgramCategory } from './program-templates';
import type {
  ApplicationFormField,
  ApplicationFormFieldKey,
  ApplicationFormFieldType,
  ApplicationFormTemplate,
  ApplicationListPage,
  ApplicationListParams,
  ProgramActivity,
  ProgramDetail,
  ProgramListPage,
  ProgramListParams,
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
  if (value === 'INDIVIDUAL' || value === 'individual') return 'individual';
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

export interface CreateProgramInput {
  readonly name: string;
  readonly organizer: string;
  readonly category: ProgramCategory;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  readonly teamMinSize: number | null;
  readonly teamMaxSize: number | null;
  readonly description: string;
}

export interface CreatedProgram {
  readonly id: string;
  readonly category: ProgramCategory;
  readonly applicationTemplateKey: string;
  readonly applicationTemplateVersion: number;
  readonly detailUrl: string;
}

export interface EditableMilestone {
  readonly id: string;
  readonly name: string;
  readonly dueAt: string;
  readonly submissionType: SubmissionType;
  readonly instructions: string | null;
}

export interface EditableProgram {
  readonly categoryLocked: {
    readonly locked: boolean;
    readonly byApplications: boolean;
    readonly byTeams: boolean;
    readonly applicationCount: number;
    readonly teamCount: number;
  };
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly category: ProgramCategory;
  readonly applicationTemplateKey: string;
  readonly applicationTemplateVersion: number;
  readonly applicationCount: number;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  readonly repositoryProvisioningEnabled: boolean;
  readonly description: string;
  readonly teamMinSize: number | null;
  readonly teamMaxSize: number | null;
  readonly milestones: readonly EditableMilestone[];
}

export interface UpdateProgramInput extends CreateProgramInput {
  readonly repositoryProvisioningEnabled: boolean;
}

export interface UpsertMilestoneInput {
  readonly name: string;
  readonly dueAt: string;
  readonly submissionType: SubmissionType;
  readonly instructions: string | null;
}

export function createProgram(
  input: CreateProgramInput,
): Promise<CreatedProgram> {
  return apiClient<CreatedProgram>('programs', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  });
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
  return apiClient<ProgramListPage>('programs?' + search.toString());
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
    return apiClient<ProgramDetail>(`programs/${encodedId}`);
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

export function updateMilestone(
  milestoneId: string,
  input: UpsertMilestoneInput,
): Promise<EditableMilestone> {
  return apiClient<EditableMilestone>(
    `milestones/${encodeURIComponent(milestoneId)}`,
    {
      method: 'PATCH',
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
  readonly answers: {
    readonly title: string;
    readonly summary: string;
  };
  readonly teamId: string | null;
  readonly applicationTemplateVersion: number;
}

export interface CreatedApplication {
  readonly id: string;
  readonly programId: string;
  readonly status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  readonly teamId: string | null;
  readonly submittedAt: string;
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
      body: JSON.stringify(input),
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
  readonly locked: boolean;
  readonly isLeader: boolean;
  readonly members: readonly TeamMember[];
}

export interface CreatedTeam {
  readonly id: string;
  readonly name: string;
  readonly joinCode: string;
  readonly memberCount: number;
}

export function getMyTeam(programId: string): Promise<ProgramTeam> {
  return apiClient<ProgramTeam>(
    `programs/${encodeURIComponent(programId)}/teams/me`,
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

export function joinTeam(
  programId: string,
  input: { readonly joinCode: string },
): Promise<ProgramTeam> {
  return apiClient<ProgramTeam>(
    `programs/${encodeURIComponent(programId)}/teams/join`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(input),
    },
  );
}

export function listProgramApplications(
  programId: string,
  params: ApplicationListParams,
): Promise<ApplicationListPage> {
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
    search: params.search,
    status: params.status,
    mode: params.mode,
  });
  return apiClient<ApplicationListPage>(
    `programs/${encodeURIComponent(programId)}/applications?${search.toString()}`,
  );
}

/** #117 교직원 운영 대시보드 요약. */
export function getStaffDashboardSummary(): Promise<StaffDashboardSummary> {
  return apiClient<StaffDashboardSummary>('dashboard/staff/summary');
}
