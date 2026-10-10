import type { BoardPostCategory } from '@prisma/client';
import type { AuthorityLabel } from '../../users/domain/authority-label';

export interface BoardPostPermissions {
  canEdit: boolean;
  canDelete: boolean;
}

export interface BoardPostSummaryResult extends BoardPostPermissions {
  id: string;
  programId: string;
  authorId: string;
  authorName: string;
  category: BoardPostCategory;
  title: string;
  pinned: boolean;
  createdAt: Date;
  commentCount: number;
}

export interface BoardCommentResult {
  id: string;
  postId: string;
  authorId: string;
  authorRole: AuthorityLabel;
  authorName: string;
  body: string;
  createdAt: Date;
  canDelete: boolean;
}

export interface BoardPostDetailResult extends BoardPostSummaryResult {
  body: string;
  updatedAt: Date;
  comments: BoardCommentResult[];
}

export interface BoardPostsPageResult {
  items: BoardPostSummaryResult[];
  total: number;
  page: number;
  limit: number;
}
