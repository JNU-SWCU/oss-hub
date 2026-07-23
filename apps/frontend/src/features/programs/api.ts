import { ApiError, apiClient } from '@/lib/api-client';
import type { ProgramCategory } from './program-templates';
import type {
  ProgramActivity,
  ProgramDetail,
  ProgramListPage,
  ProgramListParams,
  SubmissionType,
} from './types';

const jsonHeaders = { 'Content-Type': 'application/json' } as const;

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
