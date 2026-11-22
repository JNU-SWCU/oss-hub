import type { ProgramListStatus } from '../catalog/program-list-options';
import type {
  StaffDashboardSort,
  StaffDashboardSortDirection,
  StaffDashboardSummary,
} from './dto';
import { parseStaffDashboardSummary } from './staff-dashboard-parser';
import { apiClient } from '@/lib/api-client';

export type StaffDashboardSummaryParams = {
  readonly search: string;
  readonly status: ProgramListStatus;
  readonly page: number;
} & (
  | {
      readonly sort: StaffDashboardSort;
      readonly direction: StaffDashboardSortDirection;
    }
  | { readonly sort?: never; readonly direction?: never }
);

export async function getStaffDashboardSummary(
  params: StaffDashboardSummaryParams,
): Promise<StaffDashboardSummary> {
  const search = new URLSearchParams({ page: String(params.page) });
  if (params.search) search.set('search', params.search);
  if (params.status !== 'all') search.set('status', params.status);
  if (params.sort && params.direction) {
    search.set('sort', params.sort);
    search.set('direction', params.direction);
  }
  return parseStaffDashboardSummary(
    await apiClient<unknown>(`dashboard/staff/summary?${search.toString()}`),
  );
}
