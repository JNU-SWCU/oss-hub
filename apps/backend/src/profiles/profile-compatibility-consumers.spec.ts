import { BoardPostCategory } from '@prisma/client';
import { StaffInsightsRepository } from '../applications/staff-insights.repository';
import { BoardRepository } from '../board/board.repository';
import { PrismaService } from '../prisma/prisma.service';
import { searchInvitationCandidates } from '../team-invitations/team-invitation-candidates.repository';

describe('legacy profile consumers', () => {
  it('prefers the canonical profile without adding forbidden DTO fields', async () => {
    // Given
    const staffFindMany = jest.fn().mockResolvedValue([
      {
        id: 'synthetic-student',
        githubId: 101n,
        department: 'legacy-department',
        profile: { department: 'canonical-department' },
      },
    ]);
    const candidateFindMany = jest.fn().mockResolvedValue([
      {
        id: 'synthetic-candidate',
        nickname: 'synthetic-login',
        name: 'legacy-name',
        profile: { name: 'canonical-name' },
        avatarUrl: null,
      },
    ]);
    const boardFindMany = jest.fn().mockResolvedValue([
      {
        id: 'synthetic-post',
        programId: 'synthetic-program',
        authorId: 'synthetic-author',
        author: {
          name: 'legacy-author',
          profile: { name: 'canonical-author' },
          nickname: 'synthetic-author',
        },
        category: BoardPostCategory.QNA,
        title: 'synthetic-title',
        pinned: false,
        createdAt: new Date('2026-08-21T00:00:00.000Z'),
        _count: { comments: 0 },
      },
    ]);

    // When
    const staff = await new StaffInsightsRepository({
      user: { findMany: staffFindMany },
    } as unknown as PrismaService).listStudents();
    const candidates = await searchInvitationCandidates(
      { user: { findMany: candidateFindMany } } as unknown as Pick<
        PrismaService,
        'user'
      >,
      'synthetic-program',
      'synthetic-query',
      'synthetic-requester',
    );
    const posts = await new BoardRepository({
      boardPost: {
        findMany: boardFindMany,
        count: jest.fn().mockResolvedValue(1),
      },
      $transaction: (operations: readonly Promise<unknown>[]) =>
        Promise.all(operations),
    } as unknown as PrismaService).findByProgramId('synthetic-program', 1, 20);

    // Then
    expect(staff).toEqual([
      {
        id: 'synthetic-student',
        githubId: 101n,
        department: 'canonical-department',
      },
    ]);
    expect(candidates).toEqual([
      {
        id: 'synthetic-candidate',
        nickname: 'synthetic-login',
        name: 'canonical-name',
        avatarUrl: null,
      },
    ]);
    expect(posts.items).toEqual([
      expect.objectContaining({ authorName: 'canonical-author' }),
    ]);
  });
});
