import {
  ApplicationStatus,
  Prisma,
  OutboxEventStatus,
  ProgramCategory,
  RepositoryIssuanceOutcome,
  RepositoryProvisionJobStatus,
  ProgramTrackType,
} from '@prisma/client';
import { MemberKind } from '../users/user-contract.config';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { RepositoryProvisionGenerationRepository } from '../platform/repository-provision-generation.repository';
import { REPOSITORY_PROVISION_EVENT_TYPE } from './repository-provision-event.config';
import { RepositoriesRepository } from './repositories.repository';
import { RepositoryOutboxConsumerService } from './repository-outbox-consumer.service';
import { PlatformRepository } from '../platform/platform.repository';
import { RepositoryProvisionEventService } from './repository-provision-event.service';

const parseProvisionPayload = (payload: unknown) =>
  new RepositoryProvisionEventService().parseRepositoryProvisionEvent(payload);

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const consumer = new RepositoryOutboxConsumerService(
  new RepositoriesRepository(
    prisma,
    new RepositoryProvisionGenerationRepository(),
  ),
  { runNext: () => Promise.reject(new Error('worker is not used here')) },
  new RepositoryProvisionEventService(),
);
const NOW = new Date('2026-07-22T00:00:00.000Z');
const APPLICANT_ID = 'synthetic-provision-applicant';
const APPLICATION_IDS = [
  'synthetic-consume-valid',
  'synthetic-consume-stale',
  'synthetic-consume-active',
  'synthetic-consume-invalid',
  'synthetic-consume-parallel',
  'synthetic-consume-succeeded',
  'synthetic-consume-duplicate',
  'synthetic-consume-processing',
  'synthetic-consume-sync-invalid',
  'synthetic-consume-generation',
] as const;

function programId(teamId: string): string {
  return `${teamId}-program`;
}

async function createApprovedApplication(teamId: string): Promise<void> {
  const program = programId(teamId);
  await prisma.program.create({
    data: {
      startAt: new Date('2026-01-01T00:00:00.000Z'),
      endAt: new Date(
        new Date('2026-12-31T00:00:00.000Z').getTime() + 365 * 86400000,
      ),
      id: program,
      name: `program-${teamId}`,
      organizer: 'synthetic-organizer',
      trackType: ProgramTrackType.EXTRACURRICULAR,
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'synthetic-template',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
      description: 'synthetic-description',
      repositoryProvisioningEnabled: true,
    },
  });
  await prisma.team.create({
    data: {
      id: teamId,
      programId: program,
      name: `${teamId}-team`,
      leaderId: APPLICANT_ID,
      applicantId: APPLICANT_ID,
      answers: { title: `${teamId}-team` },
      applicationTemplateVersion: 1,
    },
  });
  await prisma.teamMember.create({
    data: {
      teamId,
      programId: program,
      userId: APPLICANT_ID,
    },
  });
  await prisma.team.update({
    where: { id: teamId },
    data: {
      programId: program,
      applicantId: APPLICANT_ID,
      answers: { synthetic: true },
      applicationTemplateVersion: 1,
      status: ApplicationStatus.APPROVED,
    },
  });
}

async function createProvisionEvent(
  teamId: string,
  status: OutboxEventStatus = OutboxEventStatus.PENDING,
  lockedAt: Date | null = null,
  idempotencySuffix?: string,
): Promise<string> {
  return prisma.$transaction(async (transaction) => {
    const event = await transaction.outboxEvent.create({
      data: {
        type: REPOSITORY_PROVISION_EVENT_TYPE,
        aggregateType: 'Team',
        aggregateId: teamId,
        idempotencyKey: idempotencySuffix
          ? `repository-provision:${teamId}:${idempotencySuffix}`
          : `repository-provision:${teamId}`,
        payload: {
          teamId,
          programId: programId(teamId),
          requestedAt: NOW.toISOString(),
          collaboratorGithubLogins: ['synthetic-applicant'],
        },
        status,
        availableAt: NOW,
        lockedAt,
        lockedBy: lockedAt ? 'stale-worker' : null,
      },
    });
    await new RepositoryProvisionGenerationRepository().transferProvisionGeneration(
      transaction,
      { teamId, newEventId: event.id, now: NOW },
      parseProvisionPayload,
    );
    return event.id;
  });
}

async function createAccessSyncEvent(
  teamId: string,
  requestedAt: Date = NOW,
  payloadOverride?: Prisma.InputJsonValue,
): Promise<string> {
  const data = new PlatformRepository().repositoryAccessSyncEventData(
    teamId,
    requestedAt,
  );
  const event = await prisma.outboxEvent.create({
    data: {
      ...data,
      payload: payloadOverride ?? data.payload,
    },
  });
  return event.id;
}

describe('RepositoryOutboxConsumerService integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: {
        id: APPLICANT_ID,
        githubId: 8100000000001n,
        nickname: 'synthetic-applicant',
        type: MemberKind.STUDENT,
        approvalStatus: 'NOT_REQUIRED',
      },
    });
  });

  afterEach(async () => {
    await prisma.repositoryIssuanceHistory.deleteMany({
      where: { teamId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.repositoryProvisionJob.deleteMany({
      where: { teamId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.outboxEvent.deleteMany({
      where: { aggregateId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: [...APPLICATION_IDS] } },
    });
    await prisma.teamMember.deleteMany({
      where: { teamId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: [...APPLICATION_IDS] } },
    });
    await prisma.program.deleteMany({
      where: { id: { in: APPLICATION_IDS.map(programId) } },
    });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: APPLICANT_ID } });
    await prisma.$disconnect();
  });

  it.each(['provision', 'access-sync'] as const)(
    '삭제된 프로그램의 %s outbox는 기존 terminal 작업을 다시 활성화하지 않는다',
    async (kind) => {
      const teamId = APPLICATION_IDS[0];
      await createApprovedApplication(teamId);
      let eventId = await createProvisionEvent(teamId);
      if (kind === 'access-sync') {
        await prisma.outboxEvent.update({
          where: { id: eventId },
          data: { status: OutboxEventStatus.PROCESSED },
        });
        eventId = await createAccessSyncEvent(teamId);
      }
      await prisma.repositoryProvisionJob.update({
        where: { teamId },
        data: { status: RepositoryProvisionJobStatus.FAILED_FINAL },
      });
      await prisma.program.update({
        where: { id: programId(teamId) },
        data: { lifecycle: 'DELETED' },
      });
      const before = await prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { teamId },
      });

      await expect(
        consumer.consumeNext('worker-deleted', NOW),
      ).resolves.toEqual({
        kind: 'FAILED',
        eventId,
      });
      expect(
        await prisma.repositoryProvisionJob.findUniqueOrThrow({
          where: { teamId },
        }),
      ).toEqual(before);
      expect(
        await prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId } }),
      ).toMatchObject({ status: OutboxEventStatus.FAILED, lockedBy: null });
    },
  );

  it('수락 때 세대가 이전된 event를 job 변경 없이 확인한다', async () => {
    const teamId = APPLICATION_IDS[0];
    await createApprovedApplication(teamId);
    const eventId = await createProvisionEvent(teamId);

    const result = await consumer.consumeNext('worker-a', NOW);

    const event = await prisma.outboxEvent.findUniqueOrThrow({
      where: { id: eventId },
    });
    const job = await prisma.repositoryProvisionJob.findUniqueOrThrow({
      where: { teamId },
    });
    expect(result).toEqual({
      kind: 'CONSUMED',
      eventId,
      jobId: job.id,
    });
    expect(event).toMatchObject({
      status: OutboxEventStatus.PROCESSED,
      lockedAt: null,
      lockedBy: null,
    });
    expect(job.status).toBe(RepositoryProvisionJobStatus.PENDING);
  });

  it('낡은 event는 확인만 하고 후속 세대 job을 한 칸도 바꾸지 않는다', async () => {
    const teamId = APPLICATION_IDS[9];
    await createApprovedApplication(teamId);
    const firstEventId = await createProvisionEvent(
      teamId,
      OutboxEventStatus.PENDING,
      null,
      'r1',
    );
    await prisma.outboxEvent.update({
      where: { id: firstEventId },
      data: { createdAt: new Date(NOW.getTime() - 2_000) },
    });
    const secondEventId = await createProvisionEvent(
      teamId,
      OutboxEventStatus.PENDING,
      null,
      'r2',
    );
    await prisma.outboxEvent.update({
      where: { id: secondEventId },
      data: { createdAt: new Date(NOW.getTime() - 1_000) },
    });
    const before = await prisma.repositoryProvisionJob.findUniqueOrThrow({
      where: { teamId },
      select: {
        id: true,
        currentEventId: true,
        status: true,
        attemptCount: true,
        lockedAt: true,
        lockedBy: true,
      },
    });
    expect(before.currentEventId).toBe(secondEventId);

    const staleResult = await consumer.consumeNext('worker-generation', NOW);
    const afterStale = await prisma.repositoryProvisionJob.findUniqueOrThrow({
      where: { teamId },
      select: {
        id: true,
        currentEventId: true,
        status: true,
        attemptCount: true,
        lockedAt: true,
        lockedBy: true,
      },
    });
    expect(staleResult).toEqual({
      kind: 'CONSUMED',
      eventId: firstEventId,
      jobId: before.id,
    });
    expect(afterStale).toEqual(before);
    await expect(
      prisma.repositoryIssuanceHistory.count({
        where: {
          requestId: firstEventId,
          outcome: RepositoryIssuanceOutcome.SUPERSEDED,
        },
      }),
    ).resolves.toBe(1);

    const currentResult = await consumer.consumeNext(
      'worker-generation',
      new Date(NOW.getTime() + 1),
    );
    expect(currentResult).toEqual({
      kind: 'CONSUMED',
      eventId: secondEventId,
      jobId: before.id,
    });
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { teamId },
        select: {
          id: true,
          currentEventId: true,
          status: true,
          attemptCount: true,
          lockedAt: true,
          lockedBy: true,
        },
      }),
    ).resolves.toEqual(before);
  });

  it('lease가 만료된 PROCESSING event를 다시 claim한다', async () => {
    const teamId = APPLICATION_IDS[1];
    await createApprovedApplication(teamId);
    const eventId = await createProvisionEvent(
      teamId,
      OutboxEventStatus.PROCESSING,
      new Date(NOW.getTime() - 10 * 60_000),
    );

    const result = await consumer.consumeNext('worker-b', NOW);

    expect(result).toMatchObject({ kind: 'CONSUMED', eventId });
  });

  it('유효한 lease의 PROCESSING event는 가로채지 않는다', async () => {
    const teamId = APPLICATION_IDS[2];
    await createApprovedApplication(teamId);
    const eventId = await createProvisionEvent(
      teamId,
      OutboxEventStatus.PROCESSING,
      new Date(NOW.getTime() - 60_000),
    );

    const result = await consumer.consumeNext('worker-c', NOW);

    expect(result).toEqual({ kind: 'EMPTY' });
    await expect(
      prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId } }),
    ).resolves.toMatchObject({
      status: OutboxEventStatus.PROCESSING,
      lockedBy: 'stale-worker',
    });
    await expect(
      prisma.repositoryProvisionJob.count({ where: { teamId } }),
    ).resolves.toBe(1);
  });

  it('완료된 job은 권한 동기화 요청으로 다시 무장된다', async () => {
    const teamId = APPLICATION_IDS[5];
    await createApprovedApplication(teamId);
    await prisma.repositoryProvisionJob.create({
      data: {
        teamId,
        status: RepositoryProvisionJobStatus.SUCCEEDED,
        attemptCount: 3,
        nextAttemptAt: new Date(NOW.getTime() + 60 * 60000),
        lastErrorCode: 'PREVIOUS_FAILURE',
        lastErrorMessage: 'previous failure detail',
        finishedAt: new Date(NOW.getTime() - 60000),
      },
    });
    const eventId = await createAccessSyncEvent(teamId);

    const result = await consumer.consumeNext('worker-sync', NOW);

    const job = await prisma.repositoryProvisionJob.findUniqueOrThrow({
      where: { teamId },
    });
    expect(result).toEqual({ kind: 'CONSUMED', eventId, jobId: job.id });
    expect(job).toMatchObject({
      status: RepositoryProvisionJobStatus.PENDING,
      attemptCount: 0,
      nextAttemptAt: NOW,
      lastErrorCode: null,
      lastErrorMessage: null,
      finishedAt: null,
    });
  });

  it('권한 동기화 event가 중복돼도 job은 한 건으로 합쳐진다', async () => {
    const teamId = APPLICATION_IDS[6];
    await createApprovedApplication(teamId);
    const firstEventId = await createAccessSyncEvent(teamId);
    const secondEventId = await createAccessSyncEvent(
      teamId,
      new Date(NOW.getTime() + 1_000),
    );

    const first = await consumer.consumeNext('worker-dup', NOW);
    const second = await consumer.consumeNext(
      'worker-dup',
      new Date(NOW.getTime() + 2_000),
    );

    const jobs = await prisma.repositoryProvisionJob.findMany({
      where: { teamId },
    });
    expect(jobs).toHaveLength(1);
    const job = await prisma.repositoryProvisionJob.findUniqueOrThrow({
      where: { teamId },
    });
    expect(first).toEqual({
      kind: 'CONSUMED',
      eventId: firstEventId,
      jobId: job.id,
    });
    expect(second).toEqual({
      kind: 'CONSUMED',
      eventId: secondEventId,
      jobId: job.id,
    });
    expect(job).toMatchObject({
      status: RepositoryProvisionJobStatus.PENDING,
      nextAttemptAt: NOW,
    });
  });

  it('실행 중인 job의 lease를 권한 동기화 event가 빼앗지 않는다', async () => {
    const teamId = APPLICATION_IDS[7];
    await createApprovedApplication(teamId);
    const lockedAt = new Date(NOW.getTime() - 30_000);
    await prisma.repositoryProvisionJob.create({
      data: {
        teamId,
        status: RepositoryProvisionJobStatus.PROCESSING,
        attemptCount: 2,
        nextAttemptAt: new Date(NOW.getTime() + 60000),
        lockedAt,
        lockedBy: 'provision-worker',
      },
    });
    const eventId = await createAccessSyncEvent(teamId);

    const result = await consumer.consumeNext('worker-lease', NOW);

    const job = await prisma.repositoryProvisionJob.findUniqueOrThrow({
      where: { teamId },
    });
    expect(result).toEqual({ kind: 'CONSUMED', eventId, jobId: job.id });
    expect(job).toMatchObject({
      status: RepositoryProvisionJobStatus.PROCESSING,
      attemptCount: 2,
      lockedAt,
      lockedBy: 'provision-worker',
    });
  });

  it('계약 밖 권한 동기화 payload는 FAILED로 격리한다', async () => {
    const teamId = APPLICATION_IDS[8];
    await createApprovedApplication(teamId);
    const eventId = await createAccessSyncEvent(teamId, NOW, {
      teamId,
      requestedAt: NOW.toISOString(),
      githubLogins: ['synthetic-applicant'],
    });

    const result = await consumer.consumeNext('worker-sync-invalid', NOW);

    expect(result).toEqual({ kind: 'FAILED', eventId });
    await expect(
      prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId } }),
    ).resolves.toMatchObject({
      status: OutboxEventStatus.FAILED,
      lastError: 'INVALID_REPOSITORY_PROVISION_EVENT',
      lockedAt: null,
      lockedBy: null,
    });
    await expect(
      prisma.repositoryProvisionJob.count({ where: { teamId } }),
    ).resolves.toBe(0);
  });

  it('승인 이벤트 parser는 권한 동기화 payload를 받아들이지 않는다', async () => {
    const teamId = APPLICATION_IDS[4];
    await createApprovedApplication(teamId);
    const eventId = await createProvisionEvent(teamId);
    await prisma.outboxEvent.update({
      where: { id: eventId },
      data: {
        payload: {
          teamId,
          requestedAt: NOW.toISOString(),
        },
      },
    });

    const result = await consumer.consumeNext('worker-grant', NOW);

    expect(result).toEqual({ kind: 'FAILED', eventId });
    await expect(
      prisma.repositoryProvisionJob.count({ where: { teamId } }),
    ).resolves.toBe(1);
  });

  it('계약 밖 payload는 FAILED로 격리하고 수락 때 만든 job은 보존한다', async () => {
    const teamId = APPLICATION_IDS[3];
    await createApprovedApplication(teamId);
    const eventId = await createProvisionEvent(teamId);
    await prisma.outboxEvent.update({
      where: { id: eventId },
      data: { payload: { teamId } },
    });

    const result = await consumer.consumeNext('worker-d', NOW);

    expect(result).toEqual({ kind: 'FAILED', eventId });
    await expect(
      prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId } }),
    ).resolves.toMatchObject({
      status: OutboxEventStatus.FAILED,
      lastError: 'INVALID_REPOSITORY_PROVISION_EVENT',
      lockedAt: null,
      lockedBy: null,
    });
    await expect(
      prisma.repositoryProvisionJob.count({ where: { teamId } }),
    ).resolves.toBe(1);
  });
});
