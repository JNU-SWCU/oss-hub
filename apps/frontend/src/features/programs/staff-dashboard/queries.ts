import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { featureKey } from '@/lib/query-keys';
import {
  getStaffDashboardSummary,
  type StaffDashboardSummaryParams,
} from './api';

export function useStaffDashboardQuery(params: StaffDashboardSummaryParams) {
  return useQuery({
    queryKey: featureKey(
      'staff-dashboard',
      params.search,
      params.status,
      params.page,
      params.sort,
      params.direction,
    ),
    queryFn: () => getStaffDashboardSummary(params),
    placeholderData: keepPreviousData,
  });
}
