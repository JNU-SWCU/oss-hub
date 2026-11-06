import { useSearchParams } from 'next/navigation';
import {
  parseListPage,
  parseListEnum,
  setListPage,
  useListUrlNavigation,
  useParsedListUrlState,
} from '@/lib/list-url-state';
import { REQUIREMENT_COLLECTION_PAGE_SIZE } from './requirement-collection-api';
import type { RequirementCollectionQueryInput } from './requirement-collection-dto';
export function parseRequirementCollectionSearchParams(
  params: URLSearchParams,
): RequirementCollectionQueryInput {
  const documentId = params.get('documentId')?.trim();
  return {
    page: parseListPage(params.get('page')),
    pageSize: REQUIREMENT_COLLECTION_PAGE_SIZE,
    filter: parseListEnum(
      params.get('filter'),
      [
        'ALL',
        'HAS_MISSING',
        'ZERO_SUBMISSION',
        'LATE',
        'COMPLETE',
        'NO_REQUIRED_ITEMS',
      ],
      'ALL',
    ),
    ...(documentId
      ? {
          document: {
            id: documentId,
            submissionState: parseListEnum(
              params.get('submissionState'),
              ['ALL', 'SUBMITTED', 'MISSING'],
              'ALL',
            ),
          },
        }
      : {}),
  };
}
export function buildRequirementCollectionSearchParams(
  state: RequirementCollectionQueryInput,
) {
  const params = new URLSearchParams();
  if (state.filter !== 'ALL') params.set('filter', state.filter);
  if (state.document) {
    params.set('documentId', state.document.id);
    if (state.document.submissionState !== 'ALL')
      params.set('submissionState', state.document.submissionState);
  }
  setListPage(params, state.page);
  return params;
}

const OWNED_PARAMS = [
  'page',
  'filter',
  'documentId',
  'submissionState',
] as const;

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
