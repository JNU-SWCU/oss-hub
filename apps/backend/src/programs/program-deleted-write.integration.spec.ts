import { TeamHistoryRepository } from './team-history.repository';
import { ProgramLifecycle } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PlatformRepository } from '../platform/platform.repository';
import { PrismaSerializationRetryRepository } from '../platform/prisma-serialization-retry.repository';
import { LockProgramTreeRepository } from '../platform/lock-program-tree.repository';
import { PrismaService } from '../platform/prisma.service';
import { canonicalUserCreateFromLabel } from '../users/canonical-user-fixture';
import { UserProfileService } from '../users/user-profile.service';
import { BoardRepository } from './board.repository';
import { BoardService } from './board.service';
import { ProgramTeamDeletionRepository } from './program-team-deletion.repository';
import { ProgramTeamRepositoryEvidenceRepository } from './program-team-repository-evidence.repository';
import { ProgramTeamsRepository } from './program-teams.repository';
import { TeamInvitationsRepository } from './team-invitations.repository';
import { TeamDeletionScopeRepository } from './team-deletion-scope.repository';
import { MilestoneDocumentArchiveRepository } from './milestone-document-archive.repository';
import { SubmissionReviewsRepository } from './submission-reviews.repository';
import { SubmissionsRepository } from './submissions.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const platform = new PlatformRepository();
const board = new BoardService(
  new BoardRepository(prisma, platform),
  new UserProfileService(),
);
const teams = new ProgramTeamsRepository(
  prisma,
  new ProgramTeamRepositoryEvidenceRepository(prisma),
  platform,
  new TeamHistoryRepository(),
);
const invitations = new TeamInvitationsRepository(
  new TeamHistoryRepository(),
  prisma,
  platform,
);
const teamDeletion = new ProgramTeamDeletionRepository(
  new TeamHistoryRepository(),
  prisma,
  new TeamDeletionScopeRepository(),
  new PrismaSerializationRetryRepository(),
);
const prefix = 'test:deleted-write:';
const programId = `${prefix}program`;
const teamId = `${prefix}team`;
const leaderId = `${prefix}leader`;
const memberId = `${prefix}member`;
const inviteeId = `${prefix}invitee`;
const staffId = `${prefix}staff`;
const postId = `${prefix}post`;
const commentId = `${prefix}comment`;
const invitationId = `${prefix}invitation`;
const staffGithubId = 9_878_100_004n;
const recordAudit = jest.fn(async () => {});

async function cleanup(): Promise<void> {
  await prisma.teamHistory.deleteMany({ where: { programId } });
  await prisma.githubRepository.deleteMany({ where: { programId } });
  await prisma.application.deleteMany({ where: { programId } });
  await prisma.milestone.deleteMany({ where: { programId } });
  await prisma.boardComment.deleteMany({ where: { post: { programId } } });
  await prisma.boardPost.deleteMany({ where: { programId } });
  await prisma.teamInvitation.deleteMany({ where: { programId } });
  await prisma.teamMember.deleteMany({ where: { programId } });
  await prisma.team.deleteMany({ where: { programId } });
  await prisma.program.deleteMany({ where: { id: programId } });
  await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
}

async function seed(lifecycle: ProgramLifecycle): Promise<void> {
  for (const [index, id] of [
    leaderId,
    memberId,
    inviteeId,
    staffId,
  ].entries()) {
    await prisma.user.create({
      data: canonicalUserCreateFromLabel(id === staffId ? 'STAFF' : 'STUDENT', {
        id,
        githubId: 9_878_100_001n + BigInt(index),
        nickname: id,
        name: 'Synthetic writer',
      }),
    });
  }
  await prisma.program.create({
    data: {
      id: programId,
      name: 'Deleted program write boundary',
      lifecycle,
      organizer: 'Synthetic organizer',
      trackType: 'CURRICULAR',
      category: 'BASIC',
      description: 'Synthetic fixture',
      applicationTemplateKey: 'capstone-v1',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-01-01'),
      applicationEndAt: new Date('2027-01-01'),
      startAt: new Date('2026-01-01'),
      endAt: new Date('2027-01-01'),
      teamMinSize: 1,
      teamMaxSize: 4,
      teams: {
        create: { id: teamId, name: 'Retained team', leaderId },
      },
    },
  });
  await prisma.teamMember.createMany({
    data: [leaderId, memberId].map((userId) => ({ teamId, programId, userId })),
  });
  await prisma.teamInvitation.create({
    data: {
      id: invitationId,
      teamId,
      programId,
      inviteeId,
      invitedById: leaderId,
      status: 'PENDING',
    },
  });
  await prisma.boardPost.create({
    data: {
      id: postId,
      programId,
      authorId: staffId,
      category: 'NOTICE',
      title: 'Retained post',
      body: 'Retained body',
      comments: {
        create: { id: commentId, authorId: staffId, body: 'Retained comment' },
      },
    },
  });
}

function snapshot() {
  return prisma.$transaction([
    prisma.boardPost.findMany({ where: { programId }, orderBy: { id: 'asc' } }),
    prisma.boardComment.findMany({
      where: { post: { programId } },
      orderBy: { id: 'asc' },
    }),
    prisma.team.findMany({ where: { programId } }),
    prisma.teamMember.findMany({
      where: { programId },
      orderBy: { userId: 'asc' },
    }),
    prisma.teamInvitation.findMany({ where: { programId } }),
  ]);
}

const boardWrites = [
  {
    name: 'create post',
    run: () =>
      board.createPost(programId, staffGithubId, { title: 'New', body: 'New' }),
  },
  {
    name: 'update post',
    run: () =>
      board.updatePost(programId, postId, staffGithubId, {
        title: 'Changed',
        body: 'Changed',
      }),
  },
  {
    name: 'delete post',
    run: () => board.deletePost(programId, postId, staffGithubId),
  },
  {
    name: 'pin post',
    run: () => board.setPinned(programId, postId, staffGithubId, true),
  },
  {
    name: 'create comment',
    run: () =>
      board.createComment(programId, postId, staffGithubId, { body: 'New' }),
  },
  {
    name: 'delete comment',
    run: () => board.deleteComment(programId, postId, commentId, staffGithubId),
  },
];

const membershipWrites = [
  {
    name: 'cancel invitation',
    run: () =>
      invitations.cancelPendingInvitationAsLeader(invitationId, leaderId),
    accepted: { kind: 'ok' },
    rejected: { kind: 'not-found' },
  },
  {
    name: 'decline invitation',
    run: () =>
      invitations.declinePendingInvitationAsInvitee(invitationId, inviteeId),
    accepted: { kind: 'ok' },
    rejected: { kind: 'not-found' },
  },
  {
    name: 'accept invitation',
    run: () => invitations.withAcceptTransaction(invitationId, inviteeId),
    accepted: { kind: 'ok', teamId, programId },
    rejected: { kind: 'not-found' },
  },
  {
    name: 'leave team',
    run: () => teams.leave(programId, memberId, recordAudit),
    accepted: 'removed',
    rejected: 'not-found',
  },
  {
    name: 'remove teammate',
    run: () => teams.removeMember(programId, leaderId, memberId, recordAudit),
    accepted: 'removed',
    rejected: 'actor-not-in-team',
  },
  {
    name: 'staff remove member',
    run: () =>
      teams.removeMemberForStaff(
        programId,
        teamId,
        staffId,
        memberId,
        recordAudit,
      ),
    accepted: 'removed',
    rejected: 'not-found',
  },
  {
    name: 'staff transfer leader',
    run: () =>
      teams.transferLeaderForStaff(
        programId,
        teamId,
        staffId,
        memberId,
        recordAudit,
      ),
    accepted: 'transferred',
    rejected: 'not-found',
  },
];

beforeAll(async () => {
  await prisma.$connect();
  await cleanup();
}, 60_000);
afterEach(cleanup);
afterAll(() => prisma.$disconnect());

describe.each([
  ProgramLifecycle.PUBLISHED,
  ProgramLifecycle.ARCHIVED,
  ProgramLifecycle.DELETED,
])('%s program write boundary', (lifecycle) => {
  beforeEach(async () => {
    recordAudit.mockClear();
    await seed(lifecycle);
  });

  it.each(boardWrites)('$name', async ({ run }) => {
    const before = await snapshot();
    if (lifecycle === ProgramLifecycle.DELETED) {
      await expect(run()).rejects.toMatchObject({
        errorCode: { code: 'BRD_001' },
      });
      expect(await snapshot()).toEqual(before);
    } else {
      await run();
      expect(await snapshot()).not.toEqual(before);
    }
  });

  it.each(membershipWrites)('$name', async ({ run, accepted, rejected }) => {
    const before = await snapshot();
    const result = await run();
    if (lifecycle === ProgramLifecycle.DELETED) {
      expect(result).toEqual(rejected);
      expect(await snapshot()).toEqual(before);
      expect(recordAudit).not.toHaveBeenCalled();
    } else {
      expect(result).toEqual(accepted);
      expect(await snapshot()).not.toEqual(before);
    }
  });

  it('delete team', async () => {
    const before = await snapshot();
    const scope = await teamDeletion.readScopeCounts(teamId);
    const result = await teamDeletion.deleteTeam(
      programId,
      teamId,
      staffId,
      scope,
      recordAudit,
      recordAudit,
    );
    if (lifecycle === ProgramLifecycle.DELETED) {
      expect(result).toEqual({ outcome: 'not-found' });
      expect(await snapshot()).toEqual(before);
      expect(recordAudit).not.toHaveBeenCalled();
    } else {
      expect(result).toMatchObject({ outcome: 'deleted' });
      expect(await snapshot()).not.toEqual(before);
    }
  });

  it('resolves the program before a bulk document change request', async () => {
    const programs = new MilestoneDocumentArchiveRepository(prisma);
    const found = await programs.findProgram(programId);
    if (lifecycle === ProgramLifecycle.DELETED) expect(found).toBeNull();
    else
      expect(found).toMatchObject({ name: 'Deleted program write boundary' });
  });

  it('locks a milestone for a document review only in an available program', async () => {
    const milestone = await prisma.milestone.create({
      data: {
        programId,
        name: 'Retained milestone',
        startAt: new Date('2026-01-01'),
        dueAt: new Date('2027-01-01'),
      },
    });
    const locked = await prisma.$transaction((tx) =>
      new LockProgramTreeRepository().lockProgramTree(tx, {
        stage: 'milestone',
        milestoneId: milestone.id,
      }),
    );
    if (lifecycle === ProgramLifecycle.DELETED) expect(locked).toBeNull();
    else expect(locked).toMatchObject({ id: milestone.id, programId });
  });

  it('resolves repository publication eligibility only in an available program', async () => {
    const application = await prisma.application.create({
      data: {
        programId,
        teamId,
        applicantId: leaderId,
        answers: {},
        applicationTemplateVersion: 1,
        status: 'APPROVED',
      },
    });
    const repository = await prisma.githubRepository.create({
      data: {
        githubRepositoryId: 9_878_100_101n,
        programId,
        teamId,
        applicationId: application.id,
        nameWithOwner: 'synthetic/deleted-write',
        source: 'ORG_PROVISIONED',
      },
    });
    const reviews = new SubmissionReviewsRepository(
      prisma,
      platform,
      new SubmissionsRepository(prisma, platform),
    );
    const eligibility = await reviews.findPublishEligibility(repository.id);
    if (lifecycle === ProgramLifecycle.DELETED) expect(eligibility).toBeNull();
    else expect(eligibility).toMatchObject({ id: repository.id });
  });
});
