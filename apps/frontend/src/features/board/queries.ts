import { useQuery } from '@tanstack/react-query';
import { programFeatureKey } from '@/lib/query-keys';
import { listBoardPosts } from './api';
import { BOARD_PAGE_SIZE } from './board-pagination';

export function useBoardListQuery(programId: string, page: number) {
  return useQuery({
    queryKey: programFeatureKey(programId, 'board', 'list', page),
    queryFn: () => listBoardPosts(programId, { page, limit: BOARD_PAGE_SIZE }),
  });
}
