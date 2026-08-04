import { apiClient } from '@/lib/api-client';
import type {
  BoardComment,
  BoardCommentWriteInput,
  BoardPostDetail,
  BoardPostsPage,
  BoardPostWriteInput,
} from './types';

function postsBase(programId: string): string {
  return `programs/${encodeURIComponent(programId)}/board/posts`;
}

function postPath(programId: string, postId: string): string {
  return `${postsBase(programId)}/${encodeURIComponent(postId)}`;
}

export function listBoardPosts(
  programId: string,
  params?: { readonly page?: number; readonly limit?: number },
): Promise<BoardPostsPage> {
  const search = new URLSearchParams();
  if (params?.page !== undefined) search.set('page', String(params.page));
  if (params?.limit !== undefined) search.set('limit', String(params.limit));
  const query = search.toString();
  return apiClient<BoardPostsPage>(
    `${postsBase(programId)}${query ? `?${query}` : ''}`,
  );
}

export function getBoardPost(
  programId: string,
  postId: string,
): Promise<BoardPostDetail> {
  return apiClient<BoardPostDetail>(postPath(programId, postId));
}

export function createBoardPost(
  programId: string,
  input: BoardPostWriteInput,
): Promise<BoardPostDetail> {
  return apiClient<BoardPostDetail>(postsBase(programId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function updateBoardPost(
  programId: string,
  postId: string,
  input: BoardPostWriteInput,
): Promise<BoardPostDetail> {
  return apiClient<BoardPostDetail>(postPath(programId, postId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deleteBoardPost(
  programId: string,
  postId: string,
): Promise<{ readonly deleted: true }> {
  return apiClient<{ readonly deleted: true }>(postPath(programId, postId), {
    method: 'DELETE',
  });
}

export function setBoardPostPinned(
  programId: string,
  postId: string,
  pinned: boolean,
): Promise<{ readonly pinned: boolean }> {
  return apiClient<{ readonly pinned: boolean }>(
    `${postPath(programId, postId)}/pin`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned }),
    },
  );
}

export function createBoardComment(
  programId: string,
  postId: string,
  input: BoardCommentWriteInput,
): Promise<BoardComment> {
  return apiClient<BoardComment>(`${postPath(programId, postId)}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deleteBoardComment(
  programId: string,
  postId: string,
  commentId: string,
): Promise<{ readonly deleted: true }> {
  return apiClient<{ readonly deleted: true }>(
    `${postPath(programId, postId)}/comments/${encodeURIComponent(commentId)}`,
    { method: 'DELETE' },
  );
}
