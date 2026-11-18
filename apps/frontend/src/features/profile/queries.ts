'use client';

import { useQuery } from '@tanstack/react-query';
import { featureKey } from '@/lib/query-keys';
import { loadPublicProfile } from './public-profile-api';

export function usePublicProfileQuery(userId: string) {
  return useQuery({
    queryKey: featureKey('public-profile', userId),
    queryFn: () => loadPublicProfile(userId),
  });
}
