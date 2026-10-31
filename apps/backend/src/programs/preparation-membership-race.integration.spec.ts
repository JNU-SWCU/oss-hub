import { Prisma, ProgramCategory } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { canonicalUserCreateFromLabel } from '../users/canonical-user-fixture';
import { TeamInvitationsRepository } from './team-invitations.repository';
import {
  backendPid,
  deferred,
  pidCapturingPrisma,
  releaseAfterBlocked,
} from './team-invitations.acceptance-race.test-support';
import { ApplicationPreparationsRepository } from './application-preparations.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const prisma = new PrismaService();
const prefix = 'preparation-membership-race:';
const programId = `${prefix}program`;
const actorId = `${prefix}actor`;
const leaderId = `${prefix}leader`;
const teamLeaderId = `${prefix}team-leader`;
const teamId = `${prefix}team`;
const invitationId = `${prefix}invitation`;
const now = new Date('2026-10-01T00:00:00Z');
let preparationInvitationId: string;
const releases: { readonly resolve: () => void }[] = [];
const operations: Promise<unknown>[] = [];

async function cleanup() {
  for (const release of releases) release.resolve();
  await Promise.allSettled(operations);
  releases.length = 0;
  operations.length = 0;
  await prisma.teamInvitation.deleteMany({ where: { programId } });
  await prisma.applicationPreparation.deleteMany({ where: { programId } });
  await prisma.teamMember.deleteMany({ where: { programId } });
  await prisma.team.deleteMany({ where: { programId } });
  await prisma.program.deleteMany({ where: { id: programId } });
  await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
}

function pauseBeforeCommit(
  capture: (pid: number) => void,
  paused: { readonly resolve: () => void },
  release: { readonly promise: Promise<void> },
): PrismaService {
  return new Proxy(prisma, {
    get(target, property, receiver) {
      if (property === '$transaction') {
        return <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) =>
          prisma.$transaction(async (tx) => {
            const [row] = await tx.$queryRaw<
              readonly { readonly pid: number }[]
            >`
              SELECT pg_backend_pid()::int AS pid
            `;
            capture(row?.pid ?? 0);
            const result = await operation(tx);
            paused.resolve();
            await release.promise;
            return result;
          });
      }
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value === 'function') {
        const bound: unknown = value.bind(target);
        return bound;
      }
      return value;
    },
  });
}

function preparation(client: PrismaService, path: 'create' | 'accept') {
  const repository = new ApplicationPreparationsRepository(client);
  return path === 'accept'
    ? repository.respond(preparationInvitationId, actorId, 'accept', now)
    : repository.create(programId, actorId, 'Synthetic preparation', now);
}

describe('official and preparation membership exclusion', () => {
  beforeAll(() => prisma.$connect());
  beforeEach(async () => {
    await cleanup();
    for (const [id, githubId] of [
      [actorId, 8_602_000_001n],
      [leaderId, 8_602_000_002n],
      [teamLeaderId, 8_602_000_003n],
    ] as const) {
      await prisma.user.create({
        data: canonicalUserCreateFromLabel('STUDENT', {
          id,
          githubId,
          nickname: id,
          name: 'Synthetic member',
        }),
      });
    }
    await prisma.program.create({
      data: {
        id: programId,
        name: 'Synthetic membership race',
        organizer: 'Synthetic organizer',
        category: ProgramCategory.BASIC,
        applicationTemplateKey: 'basic',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-01-01'),
        applicationEndAt: new Date('2026-12-31'),
        description: 'Synthetic fixture',
        teamMinSize: 1,
        teamMaxSize: 3,
      },
    });
    await prisma.team.create({
      data: {
        id: teamId,
        programId,
        name: 'Synthetic existing team',
        leaderId: teamLeaderId,
        joinCodeDigest: `${prefix}existing-digest`,
        members: { create: { userId: teamLeaderId } },
      },
    });
    await prisma.teamInvitation.create({
      data: {
        id: invitationId,
        programId,
        teamId,
        inviteeId: actorId,
        invitedById: teamLeaderId,
      },
    });
    const repository = new ApplicationPreparationsRepository(prisma);
    const draft = await repository.create(
      programId,
      leaderId,
      'Synthetic draft',
      now,
    );
    preparationInvitationId = (
      await repository.invite(draft.id, programId, leaderId, actorId, now)
    ).id;
  });
  afterEach(cleanup);
  afterAll(() => prisma.$disconnect());

  it.each([
    ['create', 'preparation'],
    ['accept', 'preparation'],
    ['create', 'official'],
    ['accept', 'official'],
  ] as const)(
    'preparation %s and official invitation acceptance preserve only the first %s membership',
    async (preparationPath, first) => {
      const blocker = backendPid();
      const waiter = backendPid();
      const paused = deferred();
      const release = deferred();
      releases.push(release);
      const firstClient = pauseBeforeCommit(blocker.capture, paused, release);
      const secondClient = pidCapturingPrisma(prisma, waiter.capture);
      const firstOperation =
        first === 'preparation'
          ? preparation(firstClient, preparationPath)
          : new TeamInvitationsRepository(firstClient).withAcceptTransaction(
              invitationId,
              actorId,
              now,
            );
      operations.push(firstOperation);
      await paused.promise;
      const secondOperation =
        first === 'preparation'
          ? new TeamInvitationsRepository(secondClient).withAcceptTransaction(
              invitationId,
              actorId,
              now,
            )
          : preparation(secondClient, preparationPath);
      operations.push(secondOperation.catch(() => undefined));
      await releaseAfterBlocked(
        prisma,
        waiter.pid,
        blocker.pid,
        release,
        operations,
      );
      await expect(firstOperation).resolves.toBeDefined();
      if (first === 'preparation')
        await expect(secondOperation).resolves.toEqual({
          kind: 'already-in-team',
        });
      else
        await expect(secondOperation).rejects.toMatchObject({
          reason: 'membership-conflict',
        });
      await expect(
        prisma.teamMember.count({ where: { programId, userId: actorId } }),
      ).resolves.toBe(first === 'official' ? 1 : 0);
      await expect(
        prisma.applicationPreparationParticipant.count({
          where: { programId, userId: actorId, status: 'ACCEPTED' },
        }),
      ).resolves.toBe(first === 'preparation' ? 1 : 0);
      if (first === 'preparation')
        await expect(
          prisma.teamInvitation.findUnique({ where: { id: invitationId } }),
        ).resolves.toMatchObject({ status: 'PENDING', respondedAt: null });
    },
  );
});
