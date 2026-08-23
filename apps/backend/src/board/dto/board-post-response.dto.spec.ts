import { BoardPostCategory } from '@prisma/client';
import { BoardPostDetailResponseDto } from './board-post-detail-response.dto';
import { BoardPostResponseDto } from './board-post-response.dto';

const createdAt = new Date('2026-07-01T00:00:00.000Z');
const post = {
  id: 'cuid-synthetic-post',
  programId: 'cuid-synthetic-program',
  authorId: 'cuid-synthetic-author',
  authorName: '합성 작성자',
  category: BoardPostCategory.QNA,
  title: '합성 질문',
  pinned: false,
  createdAt,
  commentCount: 0,
  canEdit: true,
  canDelete: true,
};

describe('게시판 글 응답 권한 계약', () => {
  it('목록 응답은 서버 계산 권한만 싣고 사용자 id는 노출하지 않는다', () => {
    const response = BoardPostResponseDto.from(post);

    expect(response).toMatchObject({ canEdit: true, canDelete: true });
    expect(response).not.toHaveProperty('authorId');
  });

  it('상세 응답도 글·댓글 권한만 싣고 사용자 id는 노출하지 않는다', () => {
    const response = BoardPostDetailResponseDto.from({
      ...post,
      body: '합성 본문',
      updatedAt: createdAt,
      comments: [
        {
          id: 'cuid-synthetic-comment',
          postId: post.id,
          authorId: 'cuid-synthetic-comment-author',
          authorRole: 'STUDENT',
          authorName: '합성 댓글 작성자',
          body: '합성 댓글',
          createdAt,
          canDelete: false,
        },
      ],
    });

    expect(response).toMatchObject({ canEdit: true, canDelete: true });
    expect(response).not.toHaveProperty('authorId');
    expect(response.comments[0]).toMatchObject({ canDelete: false });
    expect(response.comments[0]).not.toHaveProperty('authorId');
  });
});
