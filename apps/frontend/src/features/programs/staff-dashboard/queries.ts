import { useQuery } from '@tanstack/react-query';
import { featureKey } from '@/lib/query-keys';
import { getStaffDashboardSummary } from './api';

export function useStaffDashboardQuery() {
  return useQuery({
    queryKey: featureKey('staff-dashboard'),
    queryFn: () => getStaffDashboardSummary(),
  });
}
