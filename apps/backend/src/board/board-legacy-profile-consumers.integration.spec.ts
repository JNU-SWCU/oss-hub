import {
  AccountStatus,
  BoardPostCategory,
  ProgramCategory,
  Role,
} from '@prisma/client';
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
const createdAt = new Date('2026-08-21T00:00:00.000Z');
const prisma = new PrismaService();

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await prisma.boardPost.deleteMany({ where: { id: postId } });
  await prisma.program.deleteMany({ where: { id: programId } });
  await prisma.user.deleteMany({
    where: { id: { in: [canonicalUserId, legacyUserId] } },
  });
  await prisma.user.createMany({
    data: [
      {
        id: canonicalUserId,
        githubId: 9_690_000_001n,
        nickname: 'canonical-login',
        name: 'legacy-person',
        studentId: '100001',
        department: 'legacy-department',
        role: Role.STUDENT,
        accountStatus: AccountStatus.ACTIVE,
      },
      {
        id: legacyUserId,
        githubId: 9_690_000_002n,
        nickname: 'legacy-login',
        name: 'legacy-only-person',
        studentId: '100002',
        department: 'legacy-only-department',
        role: Role.STUDENT,
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
});

afterAll(async () => {
  await prisma.boardPost.deleteMany({ where: { id: postId } });
  await prisma.program.deleteMany({ where: { id: programId } });
  await prisma.user.deleteMany({
    where: { id: { in: [canonicalUserId, legacyUserId] } },
  });
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
  const legacyCandidates = await searchInvitationCandidates(
    prisma,
    programId,
    'legacy-only-person',
    canonicalUserId,
  );
  const posts = await board.findByProgramId(programId, 1, 20);

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
      commentCount: 0,
    },
  ]);
});
