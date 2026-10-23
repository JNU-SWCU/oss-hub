import type { StaffDashboardSummary } from './dto';
import { parseStaffDashboardSummary } from './staff-dashboard-parser';
import { apiClient } from '@/lib/api-client';

export async function getStaffDashboardSummary(): Promise<StaffDashboardSummary> {
  return parseStaffDashboardSummary(
    await apiClient<unknown>('dashboard/staff/summary'),
  );
}
