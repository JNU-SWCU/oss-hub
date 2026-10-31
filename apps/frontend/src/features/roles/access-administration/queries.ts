import { useQuery, type QueryClient } from '@tanstack/react-query';
import { featureKey } from '@/lib/query-keys';
import {
  fetchAdminAccessList,
  fetchAdminAccessRequests,
  type AdminAccessHistoryParams,
} from './admin-access-api';
import { loadAdminAccessDetail } from './admin-access-detail-api';
import {
  buildAdminAccessListParams,
  type AccessWorkspace,
  type AdminAccessListFilterState,
} from './admin-access-list-query';

export function useAdminAccessListQuery(
  workspace: AccessWorkspace,
  state: AdminAccessListFilterState,
) {
  return useQuery({
    queryKey: featureKey('admin-access', 'list', workspace, state),
    queryFn: ({ signal }) =>
      workspace === 'queue'
        ? fetchAdminAccessRequests(buildAdminAccessListParams(state), signal)
        : fetchAdminAccessList(buildAdminAccessListParams(state), signal),
  });
}

export function adminAccessDetailKey(userId: string) {
  return featureKey('admin-access', 'detail', userId);
}

export function adminAccessHistoryKey(
  userId: string,
  detailUpdatedAt: number,
  params: AdminAccessHistoryParams | null,
) {
  return featureKey('admin-access', 'history', userId, detailUpdatedAt, params);
}

export function useAdminAccessDetailQuery(userId: string) {
  return useQuery({
    queryKey: adminAccessDetailKey(userId),
    queryFn: ({ signal }) => loadAdminAccessDetail(userId, signal),
  });
}

export async function invalidateAdminAccess(
  client: QueryClient,
  userId: string,
  refetchDetail = true,
) {
  await Promise.all([
    client.invalidateQueries({ queryKey: featureKey('admin-access', 'list') }),
    client.invalidateQueries({
      queryKey: featureKey('admin-access', 'facets'),
    }),
    client.invalidateQueries({
      queryKey: adminAccessDetailKey(userId),
      refetchType: refetchDetail ? 'active' : 'none',
    }),
    client.invalidateQueries({
      queryKey: featureKey('admin-access', 'history', userId),
      refetchType: 'none',
    }),
  ]);
}
