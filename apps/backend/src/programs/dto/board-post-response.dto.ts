import { BoardPostCategory } from '@prisma/client';
import type { AuthorityLabel } from '../../users/authority-label.policy';
import type {
  BoardPostSummaryResult,
  BoardPostDetailResult,
  BoardCommentResult,
  BoardPostsPageResult,
} from '../programs.types';

export class BoardPostResponseDto {
  declare readonly id: string;
  declare readonly programId: string;
  declare readonly authorName: string;
  declare readonly category: BoardPostCategory;
  declare readonly title: string;
  declare readonly pinned: boolean;
  declare readonly createdAt: string;
  declare readonly commentCount: number;
  declare readonly canEdit: boolean;
  declare readonly canDelete: boolean;

  static from(record: BoardPostSummaryResult): BoardPostResponseDto {
    return {
      id: record.id,
      programId: record.programId,
      authorName: record.authorName,
      category: record.category,
      title: record.title,
      pinned: record.pinned,
      createdAt: record.createdAt.toISOString(),
      commentCount: record.commentCount,
      canEdit: record.canEdit,
      canDelete: record.canDelete,
    };
  }
}

export class BoardCommentResponseDto {
  declare readonly id: string;
  declare readonly postId: string;

  declare readonly authorRole: AuthorityLabel;
  declare readonly authorName: string;
  declare readonly body: string;
  declare readonly createdAt: string;
  declare readonly canDelete: boolean;

  static from(record: BoardCommentResult): BoardCommentResponseDto {
    return {
      id: record.id,
      postId: record.postId,
      authorRole: record.authorRole,
      authorName: record.authorName,
      body: record.body,
      createdAt: record.createdAt.toISOString(),
      canDelete: record.canDelete,
    };
  }
}

export class BoardPostDetailResponseDto {
  declare readonly id: string;
  declare readonly programId: string;
  declare readonly authorName: string;
  declare readonly category: BoardPostCategory;
  declare readonly title: string;
  declare readonly body: string;
  declare readonly pinned: boolean;
  declare readonly createdAt: string;
  declare readonly updatedAt: string;
  declare readonly commentCount: number;
  declare readonly comments: BoardCommentResponseDto[];
  declare readonly canEdit: boolean;
  declare readonly canDelete: boolean;

  static from(record: BoardPostDetailResult): BoardPostDetailResponseDto {
    return {
      id: record.id,
      programId: record.programId,
      authorName: record.authorName,
      category: record.category,
      title: record.title,
      body: record.body,
      pinned: record.pinned,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      commentCount: record.commentCount,
      comments: record.comments.map((comment) =>
        BoardCommentResponseDto.from(comment),
      ),
      canEdit: record.canEdit,
      canDelete: record.canDelete,
    };
  }
}

export class BoardPostsPageResponseDto {
  declare readonly items: BoardPostResponseDto[];
  declare readonly total: number;
  declare readonly page: number;
  declare readonly limit: number;

  static from(page: BoardPostsPageResult): BoardPostsPageResponseDto {
    return {
      items: page.items.map((item) => BoardPostResponseDto.from(item)),
      total: page.total,
      page: page.page,
      limit: page.limit,
    };
  }
}
