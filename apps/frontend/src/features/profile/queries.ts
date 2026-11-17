'use client';

import { useQuery } from '@tanstack/react-query';
import { featureKey } from '@/lib/query-keys';
import { getMyProfile } from './api';
import { loadPublicProfile } from './public-profile-api';

export function useMyProfileQuery() {
  return useQuery({
    queryKey: featureKey('profile'),
    queryFn: ({ signal }) => getMyProfile(signal),
  });
}

export function usePublicProfileQuery(userId: string) {
  return useQuery({
    queryKey: featureKey('public-profile', userId),
    queryFn: () => loadPublicProfile(userId),
  });
}
