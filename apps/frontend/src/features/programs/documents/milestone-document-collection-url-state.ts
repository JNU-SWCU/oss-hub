import { useSearchParams } from 'next/navigation';
import {
  parseListPage,
  parseListEnum,
  setListPage,
  useListUrlNavigation,
  useParsedListUrlState,
} from '@/lib/list-url-state';
import { MILESTONE_DOCUMENT_COLLECTION_PAGE_SIZE } from './milestone-document-collection-api';
import type { MilestoneDocumentCollectionQueryInput } from './milestone-document-collection-dto';
export function parseMilestoneDocumentCollectionSearchParams(
  params: URLSearchParams,
): MilestoneDocumentCollectionQueryInput {
  const documentId = params.get('documentId')?.trim();
  return {
    page: parseListPage(params.get('page')),
    pageSize: MILESTONE_DOCUMENT_COLLECTION_PAGE_SIZE,
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
export function buildMilestoneDocumentCollectionSearchParams(
  state: MilestoneDocumentCollectionQueryInput,
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

export function useMilestoneDocumentCollectionUrlState() {
  const serialized = useSearchParams().toString();
  const state = useParsedListUrlState(
    serialized,
    parseMilestoneDocumentCollectionSearchParams,
  );
  const navigate = useListUrlNavigation(
    state,
    buildMilestoneDocumentCollectionSearchParams,
    OWNED_PARAMS,
    serialized,
  );
  return { state, navigate };
}
