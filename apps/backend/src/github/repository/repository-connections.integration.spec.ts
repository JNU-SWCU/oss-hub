import {
  ApplicationStatus,
  MemberKind,
  Prisma,
  ProgramCategory,
  ProgramTrackType,
  RepositoryConnectionMode,
  RepositoryIssuanceOutcome,
  RepositoryProvisionJobStatus,
  RepositorySource,
  RepositoryVisibility,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { RepositoryConnectionsRepository } from './repository-connections.repository';
import { GithubRepositoryClaimConflictError } from '../repository-provision-state.helpers';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new RepositoryConnectionsRepository(prisma);
const PREFIX = 'synthetic-repository-connections';
const PROGRAM_ID = `${PREFIX}-program`;
const LEADER_ID = `${PREFIX}-leader`;
const STAFF_ID = `${PREFIX}-staff`;
const ADMIN_ID = `${PREFIX}-admin`;
const OTHER_ID = `${PREFIX}-other`;
const OCCUPIED_OWNER_ID = `${PREFIX}-occupied-owner`;
const TEAM_ID = `${PREFIX}-team`;
const OTHER_TEAM_ID = `${PREFIX}-other-team`;
const APPLICATION_ID = `${PREFIX}-application`;
const OTHER_APPLICATION_ID = `${PREFIX}-other-application`;
const NOW = new Date('2026-07-22T00:00:00.000Z');
const actor = {
  userId: LEADER_ID,
  githubId: 8_710_000_000_001n,
  isStaff: false,
};
const staff = { userId: STAFF_ID, githubId: 8_710_000_000_002n, isStaff: true };
const otherActor = {
  userId: OCCUPIED_OWNER_ID,
  githubId: 8_710_000_000_004n,
  isStaff: false,
};
const admin = {
  userId: ADMIN_ID,
  githubId: 8_710_000_000_005n,
  isStaff: true,
};
const metadata = {
  githubRepositoryId: 8_710_000_001n,
  name: 'synthetic-own',
  nameWithOwner: 'synthetic-owner/synthetic-own',
  url: 'https://github.com/synthetic-owner/synthetic-own',
  visibility: RepositoryVisibility.PUBLIC,
  archived: false,
  defaultBranch: 'main',
  description: null,
};

function application(id: string, applicantId = LEADER_ID, teamId = TEAM_ID) {
  return {
    id,
    programId: PROGRAM_ID,
    applicantId,
    teamId,
    answers: { synthetic: true },
    applicationTemplateVersion: 1,
    status: ApplicationStatus.APPROVED,
  };
}

async function reset() {
  await prisma.repositoryIssuanceHistory.deleteMany({
    where: { applicationId: { in: [APPLICATION_ID, OTHER_APPLICATION_ID] } },
  });
  await prisma.outboxEvent.deleteMany({
    where: { aggregateId: { in: [APPLICATION_ID, OTHER_APPLICATION_ID] } },
  });
  await prisma.repositoryProvisionJob.deleteMany({
    where: { applicationId: { in: [APPLICATION_ID, OTHER_APPLICATION_ID] } },
  });
  await prisma.githubRepository.deleteMany({
    where: { programId: PROGRAM_ID },
  });
  await prisma.application.deleteMany({
    where: { id: { in: [APPLICATION_ID, OTHER_APPLICATION_ID] } },
  });
}

describe('RepositoryConnectionsRepository integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({
      data: [
        {
          id: LEADER_ID,
          githubId: 8_710_000_000_001n,
          nickname: `${PREFIX}-leader`,
          selectedMemberKind: MemberKind.STUDENT,
        },
        {
          id: STAFF_ID,
          githubId: 8_710_000_000_002n,
          nickname: `${PREFIX}-staff`,
          selectedMemberKind: MemberKind.STAFF,
          hasStaffAccess: true,
        },
        {
          id: OTHER_ID,
          githubId: 8_710_000_000_003n,
          nickname: `${PREFIX}-other`,
          selectedMemberKind: MemberKind.STUDENT,
        },
        {
          id: OCCUPIED_OWNER_ID,
          githubId: 8_710_000_000_004n,
          nickname: `${PREFIX}-occupied-owner`,
          selectedMemberKind: MemberKind.STUDENT,
        },
        {
          id: ADMIN_ID,
          githubId: 8_710_000_000_005n,
          nickname: `${PREFIX}-admin`,
          selectedMemberKind: MemberKind.STAFF,
          hasAdminAccess: true,
        },
      ],
    });
    await prisma.program.create({
      data: {
        id: PROGRAM_ID,
        name: PREFIX,
        organizer: PREFIX,
        trackType: ProgramTrackType.EXTRACURRICULAR,
        category: ProgramCategory.BASIC,
        applicationTemplateKey: PREFIX,
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
        description: PREFIX,
        repositoryProvisioningEnabled: true,
      },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        programId: PROGRAM_ID,
        name: PREFIX,
        joinCodeDigest: PREFIX,
        leaderId: LEADER_ID,
      },
    });
    await prisma.team.create({
      data: {
        id: OTHER_TEAM_ID,
        programId: PROGRAM_ID,
        name: `${PREFIX}-other`,
        joinCodeDigest: `${PREFIX}-other`,
        leaderId: OCCUPIED_OWNER_ID,
      },
    });
    await prisma.teamMember.createMany({
      data: [
        { teamId: TEAM_ID, programId: PROGRAM_ID, userId: LEADER_ID },
        { teamId: TEAM_ID, programId: PROGRAM_ID, userId: OTHER_ID },
        {
          teamId: OTHER_TEAM_ID,
          programId: PROGRAM_ID,
          userId: OCCUPIED_OWNER_ID,
        },
      ],
    });
  });

  beforeEach(reset);
  afterAll(async () => {
    await reset();
    await prisma.teamMember.deleteMany({
      where: { teamId: { in: [TEAM_ID, OTHER_TEAM_ID] } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: [TEAM_ID, OTHER_TEAM_ID] } },
    });
    await prisma.program.delete({ where: { id: PROGRAM_ID } });
    await prisma.$disconnect();
  });

  it('rechecks current leader authority while allowing staff', async () => {
    await prisma.application.create({ data: application(APPLICATION_ID) });
    await expect(
      repository.changeConnection(
        APPLICATION_ID,
        { userId: OTHER_ID, githubId: 8_710_000_000_003n, isStaff: false },
        { mode: RepositoryConnectionMode.NEW },
        NOW,
      ),
    ).resolves.toEqual({ status: 'FORBIDDEN' });
    await expect(
      repository.changeConnection(
        APPLICATION_ID,
        actor,
        { mode: RepositoryConnectionMode.NEW },
        NOW,
      ),
    ).resolves.toMatchObject({ status: 'PENDING' });
    await expect(
      repository.changeConnection(
        APPLICATION_ID,
        staff,
        { mode: RepositoryConnectionMode.NEW },
        NOW,
      ),
    ).resolves.toMatchObject({ status: 'PENDING' });
    await expect(
      repository.changeConnection(
        APPLICATION_ID,
        admin,
        { mode: RepositoryConnectionMode.NEW },
        NOW,
      ),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('keeps an OWN same-target connection as a no-op', async () => {
    await prisma.application.create({ data: application(APPLICATION_ID) });
    await repository.changeConnection(
      APPLICATION_ID,
      actor,
      {
        mode: RepositoryConnectionMode.OWN,
        url: metadata.url,
        metadata,
        source: RepositorySource.EXTERNAL_PUBLIC,
      },
      NOW,
    );
    const before = await prisma.application.findUniqueOrThrow({
      where: { id: APPLICATION_ID },
      select: {
        repositoryConnectionMode: true,
        repositoryUrl: true,
        repository: { select: { id: true } },
      },
    });
    const beforeJob = await prisma.repositoryProvisionJob.findUniqueOrThrow({
      where: { applicationId: APPLICATION_ID },
    });
    const beforeSideEffects = await Promise.all([
      prisma.auditLog.count({ where: { targetId: APPLICATION_ID } }),
      prisma.outboxEvent.count({ where: { aggregateId: APPLICATION_ID } }),
      prisma.repositoryIssuanceHistory.count({
        where: { applicationId: APPLICATION_ID },
      }),
    ]);
    const result = await repository.changeConnection(
      APPLICATION_ID,
      actor,
      {
        mode: RepositoryConnectionMode.OWN,
        url: `${metadata.url}/`,
        metadata,
        source: RepositorySource.EXTERNAL_PUBLIC,
      },
      NOW,
    );
    expect(result).toMatchObject({
      status: 'CONNECTED',
      repositoryId: before.repository?.id,
      changed: false,
    });
    await expect(
      prisma.application.findUniqueOrThrow({
        where: { id: APPLICATION_ID },
        select: {
          repositoryConnectionMode: true,
          repositoryUrl: true,
          repository: { select: { id: true } },
        },
      }),
    ).resolves.toEqual(before);
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { applicationId: APPLICATION_ID },
      }),
    ).resolves.toEqual(beforeJob);
    await expect(
      Promise.all([
        prisma.auditLog.count({ where: { targetId: APPLICATION_ID } }),
        prisma.outboxEvent.count({ where: { aggregateId: APPLICATION_ID } }),
        prisma.repositoryIssuanceHistory.count({
          where: { applicationId: APPLICATION_ID },
        }),
      ]),
    ).resolves.toEqual(beforeSideEffects);
  });

  it('atomically detaches, claims, and updates the OWN tuple', async () => {
    await prisma.application.create({ data: application(APPLICATION_ID) });
    const old = await prisma.githubRepository.create({
      data: {
        applicationId: APPLICATION_ID,
        programId: PROGRAM_ID,
        teamId: TEAM_ID,
        githubRepositoryId: 8_710_000_099n,
        nameWithOwner: 'synthetic-owner/old',
        source: RepositorySource.ORG_PROVISIONED,
        visibility: RepositoryVisibility.PRIVATE,
      },
    });
    await prisma.repositoryProvisionJob.create({
      data: {
        applicationId: APPLICATION_ID,
        repositoryId: old.id,
        status: RepositoryProvisionJobStatus.SUCCEEDED,
        nextAttemptAt: NOW,
      },
    });
    const result = await repository.changeConnection(
      APPLICATION_ID,
      actor,
      {
        mode: RepositoryConnectionMode.OWN,
        url: metadata.url,
        metadata,
        source: RepositorySource.EXTERNAL_PUBLIC,
      },
      NOW,
    );
    expect(result).toMatchObject({
      status: 'CONNECTED',
      connectionMode: RepositoryConnectionMode.OWN,
      repositoryUrl: metadata.url,
      changed: true,
    });
    await expect(
      prisma.application.findUniqueOrThrow({
        where: { id: APPLICATION_ID },
        include: { repository: true },
      }),
    ).resolves.toMatchObject({
      repositoryConnectionMode: RepositoryConnectionMode.OWN,
      repositoryUrl: metadata.url,
      repository: {
        githubRepositoryId: metadata.githubRepositoryId,
        source: RepositorySource.EXTERNAL_PUBLIC,
      },
    });
    await expect(
      prisma.githubRepository.findUniqueOrThrow({ where: { id: old.id } }),
    ).resolves.toMatchObject({ applicationId: null });
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        action: 'REPOSITORY_CONNECTION_CHANGED',
        targetId: APPLICATION_ID,
      },
    });
    const audit = auditLogs.find((row) =>
      JSON.stringify(row.metadata).includes(old.id),
    );
    expect(audit).toBeDefined();
    expect(audit?.actorId).toBe(LEADER_ID);
    const auditMetadata = audit?.metadata as {
      readonly applicationId: string;
      readonly before: { readonly repositoryId: string | null };
      readonly after: {
        readonly connectionMode: RepositoryConnectionMode;
        readonly repositoryUrl: string | null;
      };
    };
    expect(auditMetadata).toMatchObject({
      applicationId: APPLICATION_ID,
      before: { repositoryId: old.id },
      after: {
        connectionMode: RepositoryConnectionMode.OWN,
        repositoryUrl: metadata.url,
      },
    });
  });

  it('conditionally claims one OWN target for only one concurrent application', async () => {
    await prisma.application.createMany({
      data: [
        application(APPLICATION_ID),
        application(OTHER_APPLICATION_ID, OCCUPIED_OWNER_ID, OTHER_TEAM_ID),
      ],
    });
    const results = await Promise.allSettled([
      repository.changeConnection(
        APPLICATION_ID,
        actor,
        {
          mode: RepositoryConnectionMode.OWN,
          url: metadata.url,
          metadata,
          source: RepositorySource.EXTERNAL_PUBLIC,
        },
        NOW,
      ),
      repository.changeConnection(
        OTHER_APPLICATION_ID,
        otherActor,
        {
          mode: RepositoryConnectionMode.OWN,
          url: metadata.url,
          metadata,
          source: RepositorySource.EXTERNAL_PUBLIC,
        },
        NOW,
      ),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status !== 'rejected') {
      throw new Error('one concurrent claim must be rejected');
    }
    expect(rejected.reason).toBeInstanceOf(GithubRepositoryClaimConflictError);
    const target = await prisma.githubRepository.findUniqueOrThrow({
      where: { githubRepositoryId: metadata.githubRepositoryId },
    });
    expect([APPLICATION_ID, OTHER_APPLICATION_ID]).toContain(
      target.applicationId,
    );
    const loserApplicationId =
      target.applicationId === APPLICATION_ID
        ? OTHER_APPLICATION_ID
        : APPLICATION_ID;
    await expect(
      prisma.application.findUniqueOrThrow({
        where: { id: loserApplicationId },
        include: { repository: true, provisionJob: true },
      }),
    ).resolves.toMatchObject({
      repositoryConnectionMode: RepositoryConnectionMode.NEW,
      repositoryUrl: null,
      repository: null,
      provisionJob: null,
    });
  });

  it('NEW preserves the current tuple while creating an event and transferring currentEventId', async () => {
    await prisma.application.create({ data: application(APPLICATION_ID) });
    await repository.changeConnection(
      APPLICATION_ID,
      actor,
      {
        mode: RepositoryConnectionMode.OWN,
        url: metadata.url,
        metadata,
        source: RepositorySource.EXTERNAL_PUBLIC,
      },
      NOW,
    );
    const before = await prisma.application.findUniqueOrThrow({
      where: { id: APPLICATION_ID },
      select: {
        repositoryConnectionMode: true,
        repositoryUrl: true,
        repository: { select: { id: true } },
      },
    });
    const result = await repository.changeConnection(
      APPLICATION_ID,
      actor,
      { mode: RepositoryConnectionMode.NEW },
      NOW,
    );
    expect(result).toMatchObject({
      status: 'PENDING',
      connectionMode: RepositoryConnectionMode.OWN,
      repositoryUrl: metadata.url,
    });
    const job = await prisma.repositoryProvisionJob.findUniqueOrThrow({
      where: { applicationId: APPLICATION_ID },
    });
    expect(job).toMatchObject({ status: RepositoryProvisionJobStatus.PENDING });
    const event = await prisma.outboxEvent.findUniqueOrThrow({
      where: { id: job.currentEventId ?? '' },
    });
    expect(event.payload).toEqual(
      expect.objectContaining({
        repositoryConnectionMode: RepositoryConnectionMode.NEW,
        repositoryUrl: null,
        requestedByGithubId: actor.githubId.toString(),
      }),
    );
    await expect(
      prisma.application.findUniqueOrThrow({
        where: { id: APPLICATION_ID },
        select: {
          repositoryConnectionMode: true,
          repositoryUrl: true,
          repository: { select: { id: true } },
        },
      }),
    ).resolves.toEqual(before);
  });

  it('synchronous OWN supersedes a pending NEW generation', async () => {
    await prisma.application.create({ data: application(APPLICATION_ID) });
    await repository.changeConnection(
      APPLICATION_ID,
      actor,
      { mode: RepositoryConnectionMode.NEW },
      NOW,
    );
    const pending = await prisma.repositoryProvisionJob.findUniqueOrThrow({
      where: { applicationId: APPLICATION_ID },
    });
    expect(pending.currentEventId).not.toBeNull();

    await repository.changeConnection(
      APPLICATION_ID,
      actor,
      {
        mode: RepositoryConnectionMode.OWN,
        url: metadata.url,
        metadata,
        source: RepositorySource.EXTERNAL_PUBLIC,
      },
      new Date(NOW.getTime() + 1),
    );

    const settled = await prisma.repositoryProvisionJob.findUniqueOrThrow({
      where: { applicationId: APPLICATION_ID },
    });
    expect(settled).toMatchObject({
      currentEventId: null,
      status: RepositoryProvisionJobStatus.SUCCEEDED,
      attemptCount: 0,
      lockedAt: null,
      lockedBy: null,
    });
    expect(settled.repositoryId).not.toBeNull();
    await expect(
      prisma.repositoryIssuanceHistory.findUniqueOrThrow({
        where: { requestId: pending.currentEventId ?? '' },
      }),
    ).resolves.toMatchObject({
      outcome: RepositoryIssuanceOutcome.SUPERSEDED,
      applicationId: APPLICATION_ID,
    });
    await expect(
      prisma.application.findUniqueOrThrow({
        where: { id: APPLICATION_ID },
        include: { repository: true },
      }),
    ).resolves.toMatchObject({
      repositoryConnectionMode: RepositoryConnectionMode.OWN,
      repositoryUrl: metadata.url,
      repository: {
        id: settled.repositoryId,
        githubRepositoryId: metadata.githubRepositoryId,
      },
    });
  });

  it('waits for a worker-held job lock before transferring the next generation', async () => {
    await prisma.application.create({ data: application(APPLICATION_ID) });
    await repository.changeConnection(
      APPLICATION_ID,
      actor,
      { mode: RepositoryConnectionMode.NEW },
      NOW,
    );
    let releaseLock: (() => void) | undefined;
    let reportLocked: (() => void) | undefined;
    const locked = new Promise<void>((resolve) => {
      reportLocked = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const workerTransaction = prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`
          SELECT "id"
          FROM "RepositoryProvisionJob"
          WHERE "applicationId" = ${APPLICATION_ID}
          FOR UPDATE
        `,
      );
      reportLocked?.();
      await release;
    });
    await locked;

    let patchSettled = false;
    const patch = repository
      .changeConnection(
        APPLICATION_ID,
        actor,
        { mode: RepositoryConnectionMode.NEW },
        new Date(NOW.getTime() + 1),
      )
      .finally(() => {
        patchSettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(patchSettled).toBe(false);
    releaseLock?.();

    await workerTransaction;
    await expect(patch).resolves.toMatchObject({ status: 'PENDING' });
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { applicationId: APPLICATION_ID },
      }),
    ).resolves.toMatchObject({
      status: RepositoryProvisionJobStatus.PENDING,
      attemptCount: 0,
      lockedAt: null,
      lockedBy: null,
    });
  });

  it('supersedes a pending NEW request with the next exact NEW request', async () => {
    await prisma.application.create({ data: application(APPLICATION_ID) });
    const before = await prisma.application.findUniqueOrThrow({
      where: { id: APPLICATION_ID },
      select: {
        repositoryConnectionMode: true,
        repositoryUrl: true,
        repository: { select: { id: true } },
      },
    });
    await repository.changeConnection(
      APPLICATION_ID,
      actor,
      { mode: RepositoryConnectionMode.NEW },
      NOW,
    );
    const r1 = await prisma.repositoryProvisionJob.findUniqueOrThrow({
      where: { applicationId: APPLICATION_ID },
    });
    const r2At = new Date(NOW.getTime() + 1);
    await repository.changeConnection(
      APPLICATION_ID,
      actor,
      { mode: RepositoryConnectionMode.NEW },
      r2At,
    );
    const job = await prisma.repositoryProvisionJob.findUniqueOrThrow({
      where: { applicationId: APPLICATION_ID },
    });
    expect(job.currentEventId).not.toBe(r1.currentEventId);
    const r2 = await prisma.outboxEvent.findUniqueOrThrow({
      where: { id: job.currentEventId ?? '' },
    });
    expect(r2.availableAt).toEqual(r2At);
    await expect(
      prisma.repositoryIssuanceHistory.findMany({
        where: { applicationId: APPLICATION_ID },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        requestId: r1.currentEventId,
        outcome: RepositoryIssuanceOutcome.SUPERSEDED,
        closedAt: r2At,
      }),
    ]);
    await expect(
      prisma.application.findUniqueOrThrow({
        where: { id: APPLICATION_ID },
        select: {
          repositoryConnectionMode: true,
          repositoryUrl: true,
          repository: { select: { id: true } },
        },
      }),
    ).resolves.toEqual(before);
  });
});
