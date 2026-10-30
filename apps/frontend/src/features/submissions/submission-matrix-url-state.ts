import { useSearchParams } from 'next/navigation';
import {
  parseListPage,
  parseListEnum,
  setListPage,
  useListUrlNavigation,
  useParsedListUrlState,
} from '@/lib/list-url-state';
import {
  MATRIX_PAGE_SIZE,
  type MatrixQueryInput,
  type MatrixQuickFilter,
} from './matrix';
interface SubmissionMatrixUrlState extends MatrixQueryInput {
  readonly quickFilter: MatrixQuickFilter;
}
export function parseSubmissionMatrixSearchParams(
  params: URLSearchParams,
): SubmissionMatrixUrlState {
  return {
    q: params.get('q')?.trim() ?? '',
    page: parseListPage(params.get('page')),
    pageSize: MATRIX_PAGE_SIZE,
    quickFilter: parseListEnum(
      params.get('quickFilter'),
      ['ALL', 'MISSING', 'LATE', 'COMPLETE', 'NO_REQUIRED_ITEMS'],
      'ALL',
    ),
  };
}
export function buildSubmissionMatrixSearchParams(
  state: SubmissionMatrixUrlState,
) {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set('q', state.q.trim());
  setListPage(params, state.page);
  if (state.quickFilter !== 'ALL') params.set('quickFilter', state.quickFilter);
  return params;
}

const OWNED_PARAMS = ['q', 'page', 'quickFilter'] as const;

export function useSubmissionMatrixUrlState() {
  const serialized = useSearchParams().toString();
  const state = useParsedListUrlState(
    serialized,
    parseSubmissionMatrixSearchParams,
  );
  const navigate = useListUrlNavigation(
    state,
    buildSubmissionMatrixSearchParams,
    OWNED_PARAMS,
    serialized,
  );
  return { state, navigate };
}
