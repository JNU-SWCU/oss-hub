import type {
  ProgramListParams,
  ProgramListPage,
  ProgramStatusCounts,
  ProgramDetail,
  ProgramActivity,
} from './dto';
import { apiClient, ApiError } from '@/lib/api-client';
import { programListPath } from './program-list-request';
import { parsePublicProgramList } from './public-program-list';

export function listPrograms(
  params: ProgramListParams,
): Promise<ProgramListPage> {
  return apiClient<ProgramListPage>(programListPath(params));
}

export async function listPublicPrograms(
  params: ProgramListParams,
  signal: AbortSignal,
): Promise<ProgramListPage> {
  const value = await apiClient<unknown>(programListPath(params), {
    credentials: 'omit',
    signal,
  });
  return parsePublicProgramList(value);
}

export function getProgramStatusCounts(): Promise<ProgramStatusCounts> {
  return apiClient<ProgramStatusCounts>('programs/status-counts');
}

export async function getProgramEndedYears(
  signal: AbortSignal,
): Promise<readonly number[]> {
  const { years } = await apiClient<{ readonly years: readonly number[] }>(
    'programs/ended-years',
    { signal },
  );
  return years;
}

export function getPublicProgramDetail(
  programId: string,
): Promise<ProgramDetail> {
  return apiClient<ProgramDetail>(`programs/${encodeURIComponent(programId)}`);
}

export async function getProgramDetail(
  programId: string,
  operationsView = false,
): Promise<ProgramDetail> {
  const encodedId = encodeURIComponent(programId);
  try {
    return await apiClient<ProgramDetail>(
      `programs/${encodedId}/viewer${operationsView ? '?view=operations' : ''}`,
    );
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
