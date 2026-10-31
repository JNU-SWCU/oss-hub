import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { featureKey } from '@/lib/query-keys';
import {
  fetchMyRoleSelection,
  fetchMyStaffAccessRequest,
  requestStaffRole,
} from './api';

export function useOnboardingStatusQuery(subject: string | null) {
  return useQuery({
    queryKey: featureKey('role-requests', 'me', subject),
    queryFn: async () => {
      const [request, selection] = await Promise.all([
        fetchMyStaffAccessRequest(),
        fetchMyRoleSelection(),
      ]);
      return { request, selection };
    },
    enabled: subject !== null,
  });
}

export function useStaffRoleRequestMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: requestStaffRole,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: featureKey('role-requests') }),
        client.invalidateQueries({
          queryKey: featureKey('admin-access', 'list'),
        }),
        client.invalidateQueries({
          queryKey: featureKey('admin-access', 'facets'),
        }),
      ]);
    },
  });
}
