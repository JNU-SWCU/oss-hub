import { Role } from '@prisma/client';
import { BoardCommentResponseDto } from './board-comment-response.dto';

// 합성 데이터만 사용한다 (docs/rules/security.md)
const syntheticCommentId = 'cuid-synthetic-comment';
const syntheticPostId = 'cuid-synthetic-post';
const syntheticAuthorId = 'cuid-synthetic-author';

describe('BoardCommentResponseDto', () => {
  it('authorRole을 원본 Role 값 그대로 실어 보낸다(ADMIN 포함)', () => {
    const createdAt = new Date('2026-07-01T00:00:00.000Z');

    const student = BoardCommentResponseDto.from({
      id: syntheticCommentId,
      postId: syntheticPostId,
      authorId: syntheticAuthorId,
      authorRole: Role.STUDENT,
      body: '학생 의견',
      createdAt,
    });
    expect(student.authorRole).toBe(Role.STUDENT);

    const staff = BoardCommentResponseDto.from({
      id: syntheticCommentId,
      postId: syntheticPostId,
      authorId: syntheticAuthorId,
      authorRole: Role.STAFF,
      body: '교직원 답변',
      createdAt,
    });
    expect(staff.authorRole).toBe(Role.STAFF);

    const admin = BoardCommentResponseDto.from({
      id: syntheticCommentId,
      postId: syntheticPostId,
      authorId: syntheticAuthorId,
      authorRole: Role.ADMIN,
      body: '관리자 답변',
      createdAt,
    });
    expect(admin.authorRole).toBe(Role.ADMIN);
    expect(admin.createdAt).toBe(createdAt.toISOString());
  });
});
