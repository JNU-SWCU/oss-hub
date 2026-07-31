import { apiClient } from '@/lib/api-client';
import { parseStaffDashboardSummary } from './staff-dashboard-parser';
import type { StaffDashboardSummary } from './types';

/** #117 교직원 운영 대시보드 요약. */
export async function getStaffDashboardSummary(): Promise<StaffDashboardSummary> {
  return parseStaffDashboardSummary(
    await apiClient<unknown>('dashboard/staff/summary'),
  );
}
