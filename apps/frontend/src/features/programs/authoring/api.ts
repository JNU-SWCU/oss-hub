import type {
  EditableMilestoneSnapshotFailure,
  EditableProgram,
  UpdateProgramInput,
  EditableMilestoneEditSnapshot,
  UpdateEditableMilestoneInput,
  UpsertMilestoneInput,
  EditableMilestone,
  ProgramDeletionScopeCounts,
  ProgramPurgeResult,
} from './dto';
import { ApiError, apiClient } from '@/lib/api-client';
import { PROGRAM_EDIT_ERROR_CODES } from './program-edit-error-codes';
import { parseProgramLifecycle } from '../program-lifecycle';

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

export async function getEditableProgram(
  programId: string,
): Promise<EditableProgram> {
  return parseProgramLifecycle(
    await apiClient<EditableProgram>(
      `programs/${encodeURIComponent(programId)}/edit`,
    ),
  );
}

export async function updateProgram(
  programId: string,
  input: UpdateProgramInput,
): Promise<EditableProgram> {
  return parseProgramLifecycle(
    await apiClient<EditableProgram>(
      `programs/${encodeURIComponent(programId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
    ),
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

export function deleteProgram(
  programId: string,
): Promise<{ readonly id: string; readonly deleted: true }> {
  return apiClient<{ readonly id: string; readonly deleted: true }>(
    `programs/${encodeURIComponent(programId)}`,
    { method: 'DELETE' },
  );
}

export function purgeProgram(
  programId: string,
  expectedScope: ProgramDeletionScopeCounts,
): Promise<ProgramPurgeResult> {
  return apiClient<ProgramPurgeResult>(
    `programs/${encodeURIComponent(programId)}/purge`,
    {
      method: 'DELETE',
      body: JSON.stringify({ expectedScope }),
    },
  );
}
