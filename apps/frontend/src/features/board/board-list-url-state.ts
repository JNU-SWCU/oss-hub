import { useSearchParams } from 'next/navigation';
import {
  parseListPage,
  setListPage,
  useListUrlNavigation,
  useParsedListUrlState,
} from '@/lib/list-url-state';
interface BoardListUrlState {
  readonly page: number;
}
export function parseBoardListSearchParams(
  params: URLSearchParams,
): BoardListUrlState {
  return { page: parseListPage(params.get('page')) };
}
export function buildBoardListSearchParams(state: BoardListUrlState) {
  const params = new URLSearchParams();
  setListPage(params, state.page);
  return params;
}

const OWNED_PARAMS = ['page'] as const;

export function useBoardListUrlState() {
  const serialized = useSearchParams().toString();
  const state = useParsedListUrlState(serialized, parseBoardListSearchParams);
  const navigate = useListUrlNavigation(
    state,
    buildBoardListSearchParams,
    OWNED_PARAMS,
    serialized,
  );
  return { state, navigate };
}
