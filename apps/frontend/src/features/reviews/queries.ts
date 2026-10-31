'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, type RefObject } from 'react';
import { programFeatureKey } from '@/lib/query-keys';
import { getReviewContext } from './api';

export function useReviewContextQuery(
  programId: string,
  submissionId: string,
  mutationPending: RefObject<boolean>,
) {
  const query = useQuery({
    queryKey: programFeatureKey(programId, 'review-context', submissionId),
    queryFn: () => getReviewContext(submissionId),
    enabled: () => !mutationPending.current,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const { refetch } = query;

  useEffect(() => {
    const refresh = () => {
      if (!mutationPending.current && document.visibilityState === 'visible') {
        void refetch();
      }
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [mutationPending, refetch]);

  return query;
}
