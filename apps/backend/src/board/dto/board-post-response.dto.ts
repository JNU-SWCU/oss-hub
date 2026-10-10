import { BoardPostCategory } from '@prisma/client';
import type { AuthorityLabel } from '../../users/domain/authority-label';
import type {
  BoardPostSummaryResult,
  BoardPostDetailResult,
  BoardCommentResult,
  BoardPostsPageResult,
} from '../domain/board-results';

export class BoardPostResponseDto {
  id: string;
  programId: string;
  authorName: string;
  category: BoardPostCategory;
  title: string;
  pinned: boolean;
  createdAt: string;
  commentCount: number;
  canEdit: boolean;
  canDelete: boolean;

  private constructor(record: BoardPostSummaryResult) {
    this.id = record.id;
    this.programId = record.programId;
    this.authorName = record.authorName;
    this.category = record.category;
    this.title = record.title;
    this.pinned = record.pinned;
    this.createdAt = record.createdAt.toISOString();
    this.commentCount = record.commentCount;
    this.canEdit = record.canEdit;
    this.canDelete = record.canDelete;
  }

  static from(record: BoardPostSummaryResult): BoardPostResponseDto {
    return new BoardPostResponseDto(record);
  }
}

export class BoardCommentResponseDto {
  id: string;
  postId: string;

  authorRole: AuthorityLabel;
  authorName: string;
  body: string;
  createdAt: string;
  canDelete: boolean;

  private constructor(record: BoardCommentResult) {
    this.id = record.id;
    this.postId = record.postId;
    this.authorRole = record.authorRole;
    this.authorName = record.authorName;
    this.body = record.body;
    this.createdAt = record.createdAt.toISOString();
    this.canDelete = record.canDelete;
  }

  static from(record: BoardCommentResult): BoardCommentResponseDto {
    return new BoardCommentResponseDto(record);
  }
}

export class BoardPostDetailResponseDto {
  id: string;
  programId: string;
  authorName: string;
  category: BoardPostCategory;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  comments: BoardCommentResponseDto[];
  canEdit: boolean;
  canDelete: boolean;

  private constructor(record: BoardPostDetailResult) {
    this.id = record.id;
    this.programId = record.programId;
    this.authorName = record.authorName;
    this.category = record.category;
    this.title = record.title;
    this.body = record.body;
    this.pinned = record.pinned;
    this.createdAt = record.createdAt.toISOString();
    this.updatedAt = record.updatedAt.toISOString();
    this.commentCount = record.commentCount;
    this.canEdit = record.canEdit;
    this.canDelete = record.canDelete;
    this.comments = record.comments.map((comment) =>
      BoardCommentResponseDto.from(comment),
    );
  }

  static from(record: BoardPostDetailResult): BoardPostDetailResponseDto {
    return new BoardPostDetailResponseDto(record);
  }
}

export class BoardPostsPageResponseDto {
  items: BoardPostResponseDto[];
  total: number;
  page: number;
  limit: number;

  private constructor(page: BoardPostsPageResult) {
    this.items = page.items.map((item) => BoardPostResponseDto.from(item));
    this.total = page.total;
    this.page = page.page;
    this.limit = page.limit;
  }

  static from(page: BoardPostsPageResult): BoardPostsPageResponseDto {
    return new BoardPostsPageResponseDto(page);
  }
}
