import { useSearchParams } from 'next/navigation';
import {
  parseListPage,
  setListPage,
  useListUrlNavigation,
  useParsedListUrlState,
} from '@/lib/list-url-state';
import { SUBMISSION_STATUS_LABELS } from '@/lib/status-vocabulary';
import {
  MATRIX_DEFAULT_ORDER,
  MATRIX_PAGE_SIZE,
  type MatrixQueryInput,
  type MatrixSort,
} from './matrix';

const MATRIX_SORT_PATTERN = /^(?:team|progress|milestone:\S+)$/u;

export function parseSubmissionMatrixSearchParams(
  params: URLSearchParams,
): MatrixQueryInput {
  const status = params.get('status');
  const sort = params.get('sort');
  const direction = params.get('direction');
  const order: Pick<MatrixQueryInput, 'sort' | 'direction'> =
    sort !== null &&
    sort === sort.trim() &&
    MATRIX_SORT_PATTERN.test(sort) &&
    (direction === 'asc' || direction === 'desc')
      ? { sort: sort as MatrixSort, direction }
      : MATRIX_DEFAULT_ORDER;

  return {
    q: params.get('q')?.trim() ?? '',
    page: parseListPage(params.get('page')),
    pageSize: MATRIX_PAGE_SIZE,
    ...(status !== null && Object.hasOwn(SUBMISSION_STATUS_LABELS, status)
      ? { status: status as NonNullable<MatrixQueryInput['status']> }
      : {}),
    ...order,
  };
}

export function buildSubmissionMatrixSearchParams(
  state: MatrixQueryInput,
): URLSearchParams {
  const params = new URLSearchParams();
  const q = state.q.trim();
  if (q !== '') params.set('q', q);
  setListPage(params, state.page);
  if (state.status !== undefined) params.set('status', state.status);
  if (
    state.sort !== MATRIX_DEFAULT_ORDER.sort ||
    state.direction !== MATRIX_DEFAULT_ORDER.direction
  ) {
    params.set('sort', state.sort);
    params.set('direction', state.direction);
  }
  return params;
}

const OWNED_PARAMS = ['q', 'page', 'status', 'sort', 'direction'] as const;

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
