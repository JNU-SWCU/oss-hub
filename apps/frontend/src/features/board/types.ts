export type BoardPostCategory = 'NOTICE' | 'QNA';

export type BoardAuthorRole = 'STUDENT' | 'STAFF' | 'ADMIN';

export interface BoardPostSummary {
  readonly id: string;
  readonly programId: string;

  readonly authorId?: string;
  readonly authorName?: string;
  readonly category: BoardPostCategory;
  readonly title: string;
  readonly pinned: boolean;
  readonly createdAt: string;
  readonly commentCount: number;
  readonly canEdit?: boolean;
  readonly canDelete?: boolean;
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

  readonly authorId?: string;
  readonly authorRole: BoardAuthorRole;
  readonly authorName?: string;
  readonly body: string;
  readonly createdAt: string;
  readonly canDelete?: boolean;
}

export interface BoardPostDetail {
  readonly id: string;
  readonly programId: string;

  readonly authorId?: string;
  readonly authorName?: string;
  readonly category: BoardPostCategory;
  readonly title: string;
  readonly body: string;
  readonly pinned: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly commentCount: number;
  readonly comments: readonly BoardComment[];
  readonly canEdit?: boolean;
  readonly canDelete?: boolean;
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
  | { readonly kind: 'not-participant' }
  | { readonly kind: 'ready'; readonly page: BoardPostsPage };

export type BoardDetailState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'ready'; readonly post: BoardPostDetail };
