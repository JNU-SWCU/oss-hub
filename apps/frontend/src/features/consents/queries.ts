import { useQuery } from '@tanstack/react-query';
import { featureKey } from '@/lib/query-keys';
import { getCurrentConsent } from './api';

export function useCurrentConsentQuery(enabled: boolean) {
  return useQuery({
    queryKey: featureKey('consents'),
    queryFn: ({ signal }) => getCurrentConsent(signal),
    enabled,
  });
}
