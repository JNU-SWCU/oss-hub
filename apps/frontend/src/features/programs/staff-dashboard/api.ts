import type { ProgramListStatus } from '../catalog/program-list-options';
import type { StaffDashboardSummary } from './dto';
import { parseStaffDashboardSummary } from './staff-dashboard-parser';
import { apiClient } from '@/lib/api-client';

export interface StaffDashboardSummaryParams {
  readonly search: string;
  readonly status: ProgramListStatus;
  readonly page: number;
}

export async function getStaffDashboardSummary(
  params: StaffDashboardSummaryParams,
): Promise<StaffDashboardSummary> {
  const search = new URLSearchParams({ page: String(params.page) });
  if (params.search) search.set('search', params.search);
  if (params.status !== 'all') search.set('status', params.status);
  return parseStaffDashboardSummary(
    await apiClient<unknown>(`dashboard/staff/summary?${search.toString()}`),
  );
}
