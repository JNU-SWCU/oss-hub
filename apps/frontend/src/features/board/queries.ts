import {
  matchQuery,
  useQuery,
  type Query,
  type QueryClient,
} from '@tanstack/react-query';
import { programFeatureKey } from '@/lib/query-keys';
import { getBoardPost, listBoardPosts } from './api';
import { BOARD_PAGE_SIZE } from './board-pagination';

export function boardPostKey(programId: string, postId: string) {
  return programFeatureKey(programId, 'board', 'post', postId);
}

export function useBoardListQuery(programId: string, page: number) {
  return useQuery({
    queryKey: programFeatureKey(programId, 'board', 'list', page),
    queryFn: () => listBoardPosts(programId, { page, limit: BOARD_PAGE_SIZE }),
  });
}

export function useBoardPostQuery(programId: string, postId: string) {
  return useQuery({
    queryKey: boardPostKey(programId, postId),
    queryFn: () => getBoardPost(programId, postId),
  });
}

export async function invalidateBoard(
  queryClient: QueryClient,
  programId: string,
  deletedPostId?: string,
) {
  const deletedKey =
    deletedPostId === undefined ? null : boardPostKey(programId, deletedPostId);
  const predicate = (query: Query) =>
    deletedKey === null ||
    !matchQuery({ queryKey: deletedKey, exact: true }, query);
  await Promise.all(
    [
      programFeatureKey(programId, 'board'),
      programFeatureKey(programId, 'overview'),
    ].map(async (queryKey) => {
      await queryClient.cancelQueries({ queryKey, predicate });
      await queryClient.invalidateQueries({ queryKey, predicate });
    }),
  );
}
