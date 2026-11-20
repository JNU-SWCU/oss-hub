import { useSearchParams } from 'next/navigation';
import {
  parseListEnum,
  parseListPage,
  setListPage,
  useListUrlNavigation,
  useParsedListUrlState,
} from '@/lib/list-url-state';
import { REQUIREMENT_COLLECTION_PAGE_SIZE } from './requirement-collection-api';
import type { RequirementCollectionQueryInput } from './requirement-collection-dto';

const OWNED_PARAMS = [
  'q',
  'status',
  'sort',
  'direction',
  'page',
  'filter',
  'documentId',
  'submissionState',
] as const;
const STAGE_STATUSES = [
  'NOT_SUBMITTED',
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'REJECTED',
  'APPROVED',
] as const;
const STAGE_SORTS = [
  'team',
  'document',
  'status',
  'submittedAt',
  'reviewedAt',
] as const;

export function parseRequirementCollectionSearchParams(
  params: URLSearchParams,
): RequirementCollectionQueryInput {
  const status = params.get('status');
  return {
    q: params.get('q')?.trim() ?? '',
    page: parseListPage(params.get('page')),
    pageSize: REQUIREMENT_COLLECTION_PAGE_SIZE,
    filter: 'ALL',
    status: STAGE_STATUSES.find((option) => option === status),
    sort: parseListEnum(params.get('sort'), STAGE_SORTS, 'team'),
    direction: parseListEnum(
      params.get('direction'),
      ['asc', 'desc'] as const,
      'asc',
    ),
  };
}

export function buildRequirementCollectionSearchParams(
  state: RequirementCollectionQueryInput,
): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.status !== undefined) params.set('status', state.status);
  if (state.sort !== undefined && state.sort !== 'team')
    params.set('sort', state.sort);
  if (state.direction === 'desc') params.set('direction', state.direction);
  setListPage(params, state.page);
  return params;
}

export function useRequirementCollectionUrlState() {
  const serialized = useSearchParams().toString();
  const state = useParsedListUrlState(
    serialized,
    parseRequirementCollectionSearchParams,
  );
  const navigate = useListUrlNavigation(
    state,
    buildRequirementCollectionSearchParams,
    OWNED_PARAMS,
    serialized,
  );
  return { state, navigate };
}
