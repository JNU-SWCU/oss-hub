/** 서버 `BoardPostCategory` — 사용자가 직접 고르지 않는다. 작성자 역할이 그대로 결정한다. */
export type BoardPostCategory = 'NOTICE' | 'QNA';

export interface BoardPostSummary {
  readonly id: string;
  readonly programId: string;
  readonly authorId: string;
  readonly category: BoardPostCategory;
  readonly title: string;
  readonly pinned: boolean;
  readonly createdAt: string;
  readonly commentCount: number;
}

export interface BoardPostsPage {
  readonly items: readonly BoardPostSummary[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

export interface BoardComment {
  readonly id: string;
  readonly postId: string;
  readonly authorId: string;
  readonly body: string;
  readonly createdAt: string;
}

export interface BoardPostDetail {
  readonly id: string;
  readonly programId: string;
  readonly authorId: string;
  readonly category: BoardPostCategory;
  readonly title: string;
  readonly body: string;
  readonly pinned: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly commentCount: number;
  readonly comments: readonly BoardComment[];
}

export interface BoardPostWriteInput {
  readonly title: string;
  readonly body: string;
}

export interface BoardCommentWriteInput {
  readonly body: string;
}

export type BoardListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly page: BoardPostsPage };

export type BoardDetailState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'ready'; readonly post: BoardPostDetail };
