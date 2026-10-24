import type {
  ProgramListParams,
  ProgramListPage,
  ProgramStatusCounts,
  ProgramDetail,
  ProgramActivity,
} from './dto';
import { apiClient, ApiError } from '@/lib/api-client';
import { parseProgramLifecycle } from '../program-lifecycle';

export async function listPrograms(
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
  const page = await apiClient<ProgramListPage>(
    'programs?' + search.toString(),
  );
  page.items.forEach(parseProgramLifecycle);
  return page;
}

export function getProgramStatusCounts(): Promise<ProgramStatusCounts> {
  return apiClient<ProgramStatusCounts>('programs/status-counts');
}

export async function getPublicProgramDetail(
  programId: string,
): Promise<ProgramDetail> {
  return parseProgramLifecycle(
    await apiClient<ProgramDetail>(`programs/${encodeURIComponent(programId)}`),
  );
}

export async function getProgramDetail(
  programId: string,
  operationsView = false,
): Promise<ProgramDetail> {
  const encodedId = encodeURIComponent(programId);
  try {
    return parseProgramLifecycle(
      await apiClient<ProgramDetail>(
        `programs/${encodedId}/viewer${operationsView ? '?view=operations' : ''}`,
      ),
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
