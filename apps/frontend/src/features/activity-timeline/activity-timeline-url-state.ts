import { useSearchParams } from 'next/navigation';
import {
  parseListEnum,
  useListUrlNavigation,
  useParsedListUrlState,
} from '@/lib/list-url-state';
import type { ActivityGranularity } from './types';
interface ActivityTimelineUrlState {
  readonly granularity: ActivityGranularity;
}
export function parseActivityTimelineSearchParams(
  params: URLSearchParams,
): ActivityTimelineUrlState {
  return {
    granularity: parseListEnum(
      params.get('granularity'),
      ['MONTH', 'YEAR'],
      'MONTH',
    ),
  };
}
export function buildActivityTimelineSearchParams(
  state: ActivityTimelineUrlState,
) {
  const params = new URLSearchParams();
  if (state.granularity !== 'MONTH')
    params.set('granularity', state.granularity);
  return params;
}

const OWNED_PARAMS = ['granularity'] as const;

export function useActivityTimelineUrlState() {
  const serialized = useSearchParams().toString();
  const state = useParsedListUrlState(
    serialized,
    parseActivityTimelineSearchParams,
  );
  const navigate = useListUrlNavigation(
    state,
    buildActivityTimelineSearchParams,
    OWNED_PARAMS,
    serialized,
  );
  return { state, navigate };
}
