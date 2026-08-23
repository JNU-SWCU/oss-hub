import { AccountStatus, BoardPostCategory, MemberKind, ProgramCategory } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { StaffInsightsRepository } from '../applications/staff-insights.repository';
import { PrismaService } from '../prisma/prisma.service';
import { searchInvitationCandidates } from '../team-invitations/team-invitation-candidates.repository';
import { BoardRepository } from './board.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const canonicalUserId = 'test:profile-compatibility:canonical';
const legacyUserId = 'test:profile-compatibility:legacy';
const programId = 'test:profile-compatibility:program';
const postId = 'test:profile-compatibility:post';
const legacyPostId = 'test:profile-compatibility:legacy-post';
const canonicalCommentId = 'test:profile-compatibility:canonical-comment';
const legacyCommentId = 'test:profile-compatibility:legacy-comment';
const createdAt = new Date('2026-08-21T00:00:00.000Z');
const prisma = new PrismaService();

async function cleanup(): Promise<void> {
  await prisma.boardComment.deleteMany({
    where: { id: { in: [canonicalCommentId, legacyCommentId] } },
  });
  await prisma.boardPost.deleteMany({
    where: { id: { in: [postId, legacyPostId] } },
  });
  await prisma.program.deleteMany({ where: { id: programId } });
  await prisma.user.deleteMany({
    where: { id: { in: [canonicalUserId, legacyUserId] } },
  });
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await cleanup();
  await prisma.user.createMany({
    data: [
      {
        id: canonicalUserId,
        githubId: 9_690_000_001n,
        nickname: 'canonical-login',
        selectedMemberKind: MemberKind.STUDENT,
        accountStatus: AccountStatus.ACTIVE,
      },
      {
        id: legacyUserId,
        githubId: 9_690_000_002n,
        nickname: 'legacy-login',
        selectedMemberKind: MemberKind.STUDENT,
        accountStatus: AccountStatus.ACTIVE,
      },
    ],
  });
  await prisma.userProfile.create({
    data: {
      userId: canonicalUserId,
      name: 'canonical-person',
      studentId: '100001',
      department: 'canonical-department',
    },
  });
  await prisma.program.create({
    data: {
      id: programId,
      name: 'Synthetic compatibility program',
      organizer: 'Synthetic organizer',
      category: ProgramCategory.CAPSTONE,
      applicationTemplateKey: 'capstone-v1',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-08-31T00:00:00.000Z'),
      description: 'Synthetic compatibility fixture',
    },
  });
  await prisma.boardPost.create({
    data: {
      id: postId,
      programId,
      authorId: canonicalUserId,
      category: BoardPostCategory.QNA,
      title: 'Synthetic compatibility post',
      body: 'Synthetic compatibility body',
      createdAt,
    },
  });
  await prisma.boardPost.create({
    data: {
      id: legacyPostId,
      programId,
      authorId: legacyUserId,
      category: BoardPostCategory.QNA,
      title: 'Synthetic legacy compatibility post',
      body: 'Synthetic legacy compatibility body',
      createdAt: new Date('2026-08-20T00:00:00.000Z'),
    },
  });
  await prisma.boardComment.createMany({
    data: [
      {
        id: canonicalCommentId,
        postId,
        authorId: canonicalUserId,
        body: 'Synthetic canonical comment',
        createdAt: new Date('2026-08-21T01:00:00.000Z'),
      },
      {
        id: legacyCommentId,
        postId,
        authorId: legacyUserId,
        body: 'Synthetic legacy comment',
        createdAt: new Date('2026-08-21T02:00:00.000Z'),
      },
    ],
  });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

it('preserves canonical and legacy fallback projections across all three consumers', async () => {
  // Given
  const staffInsights = new StaffInsightsRepository(prisma);
  const board = new BoardRepository(prisma);

  // When
  const students = await staffInsights.listStudents();
  const canonicalCandidates = await searchInvitationCandidates(
    prisma,
    programId,
    'canonical-person',
    legacyUserId,
  );
  const staleLegacyCandidates = await searchInvitationCandidates(
    prisma,
    programId,
    'legacy-person',
    legacyUserId,
  );
  const legacyCandidates = await searchInvitationCandidates(
    prisma,
    programId,
    'legacy-only-person',
    canonicalUserId,
  );
  const posts = await board.findByProgramId(programId, 1, 20);
  const detail = await board.findDetailById(postId);

  // Then
  expect(students).toEqual(
    expect.arrayContaining([
      {
        id: canonicalUserId,
        githubId: 9_690_000_001n,
        department: 'canonical-department',
      },
      {
        id: legacyUserId,
        githubId: 9_690_000_002n,
        department: 'legacy-only-department',
      },
    ]),
  );
  expect(canonicalCandidates).toEqual([
    {
      id: canonicalUserId,
      nickname: 'canonical-login',
      name: 'canonical-person',
      avatarUrl: null,
    },
  ]);
  expect(staleLegacyCandidates).toEqual([]);
  expect(legacyCandidates).toEqual([
    {
      id: legacyUserId,
      nickname: 'legacy-login',
      name: 'legacy-only-person',
      avatarUrl: null,
    },
  ]);
  expect(posts.items).toEqual([
    {
      id: postId,
      programId,
      authorId: canonicalUserId,
      authorName: 'canonical-person',
      category: BoardPostCategory.QNA,
      title: 'Synthetic compatibility post',
      pinned: false,
      createdAt,
      commentCount: 2,
    },
    {
      id: legacyPostId,
      programId,
      authorId: legacyUserId,
      authorName: 'legacy-only-person',
      category: BoardPostCategory.QNA,
      title: 'Synthetic legacy compatibility post',
      pinned: false,
      createdAt: new Date('2026-08-20T00:00:00.000Z'),
      commentCount: 0,
    },
  ]);
  expect(detail).toMatchObject({
    id: postId,
    authorName: 'canonical-person',
    comments: [
      { id: canonicalCommentId, authorName: 'canonical-person' },
      { id: legacyCommentId, authorName: 'legacy-only-person' },
    ],
  });
});
