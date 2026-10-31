import { useMutation, useQueryClient } from '@tanstack/react-query';
import { featureKey } from '@/lib/query-keys';
import { requestStaffRole } from './api';

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
