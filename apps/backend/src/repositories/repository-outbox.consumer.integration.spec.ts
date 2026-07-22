import {
  ApplicationStatus,
  OutboxEventStatus,
  ProgramCategory,
  RepositoryProvisionJobStatus,
  Role,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { RepositoriesRepository } from './repositories.repository';
import { RepositoryOutboxConsumer } from './repository-outbox.consumer';
import { REPOSITORY_PROVISION_EVENT_TYPE } from './repository-provision-event';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const consumer = new RepositoryOutboxConsumer(
  new RepositoriesRepository(prisma),
);
const NOW = new Date('2026-07-22T00:00:00.000Z');
const APPLICANT_ID = 'synthetic-provision-applicant';
const APPLICATION_IDS = [
  'synthetic-consume-valid',
  'synthetic-consume-stale',
  'synthetic-consume-active',
  'synthetic-consume-invalid',
  'synthetic-consume-parallel',
] as const;

function programId(applicationId: string): string {
  return `${applicationId}-program`;
}

async function createApprovedApplication(applicationId: string): Promise<void> {
  await prisma.program.create({
    data: {
      id: programId(applicationId),
      name: `program-${applicationId}`,
      organizer: 'synthetic-organizer',
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'synthetic-template',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
      description: 'synthetic-description',
      repositoryProvisioningEnabled: true,
    },
  });
  await prisma.application.create({
    data: {
      id: applicationId,
      programId: programId(applicationId),
      applicantId: APPLICANT_ID,
      answers: { synthetic: true },
      applicationTemplateVersion: 1,
      status: ApplicationStatus.APPROVED,
    },
  });
}

async function createProvisionEvent(
  applicationId: string,
  status: OutboxEventStatus = OutboxEventStatus.PENDING,
  lockedAt: Date | null = null,
): Promise<string> {
  const event = await prisma.outboxEvent.create({
    data: {
      type: REPOSITORY_PROVISION_EVENT_TYPE,
      aggregateType: 'Application',
      aggregateId: applicationId,
      idempotencyKey: `repository-provision:${applicationId}`,
      payload: {
        applicationId,
        programId: programId(applicationId),
        teamId: null,
        requestedAt: NOW.toISOString(),
        collaboratorGithubLogins: ['synthetic-applicant'],
      },
      status,
      availableAt: NOW,
      lockedAt,
      lockedBy: lockedAt ? 'stale-worker' : null,
    },
  });
  return event.id;
}

describe('RepositoryOutboxConsumer integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: {
        id: APPLICANT_ID,
        githubId: 8_100_000_000_001n,
        login: 'synthetic-applicant',
        role: Role.STUDENT,
      },
    });
  });

  afterEach(async () => {
    await prisma.repositoryProvisionJob.deleteMany({
      where: { applicationId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.outboxEvent.deleteMany({
      where: { aggregateId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.application.deleteMany({
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

  it('event claim과 job upsert를 한 트랜잭션에서 처리한다', async () => {
    // Given: 승인된 신청의 PENDING outbox가 있다.
    const applicationId = APPLICATION_IDS[0];
    await createApprovedApplication(applicationId);
    const eventId = await createProvisionEvent(applicationId);

    // When: consumer가 event를 처리한다.
    const result = await consumer.consumeNext('worker-a', NOW);

    // Then: event는 처리되고 application당 job은 한 건 생성된다.
    const event = await prisma.outboxEvent.findUniqueOrThrow({
      where: { id: eventId },
    });
    const job = await prisma.repositoryProvisionJob.findUniqueOrThrow({
      where: { applicationId },
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

  it('lease가 만료된 PROCESSING event를 다시 claim한다', async () => {
    // Given: 이전 worker lease가 만료된 event가 있다.
    const applicationId = APPLICATION_IDS[1];
    await createApprovedApplication(applicationId);
    const eventId = await createProvisionEvent(
      applicationId,
      OutboxEventStatus.PROCESSING,
      new Date(NOW.getTime() - 10 * 60_000),
    );

    // When: 새 worker가 event를 처리한다.
    const result = await consumer.consumeNext('worker-b', NOW);

    // Then: stale event가 유실되지 않고 처리된다.
    expect(result).toMatchObject({ kind: 'CONSUMED', eventId });
  });

  it('유효한 lease의 PROCESSING event는 가로채지 않는다', async () => {
    // Given: 다른 worker lease가 아직 유효한 event가 있다.
    const applicationId = APPLICATION_IDS[2];
    await createApprovedApplication(applicationId);
    const eventId = await createProvisionEvent(
      applicationId,
      OutboxEventStatus.PROCESSING,
      new Date(NOW.getTime() - 60_000),
    );

    // When: 새 worker가 claim을 시도한다.
    const result = await consumer.consumeNext('worker-c', NOW);

    // Then: event와 job을 변경하지 않는다.
    expect(result).toEqual({ kind: 'EMPTY' });
    await expect(
      prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId } }),
    ).resolves.toMatchObject({
      status: OutboxEventStatus.PROCESSING,
      lockedBy: 'stale-worker',
    });
    await expect(
      prisma.repositoryProvisionJob.count({ where: { applicationId } }),
    ).resolves.toBe(0);
  });

  it('계약 밖 payload는 FAILED로 격리하고 job을 만들지 않는다', async () => {
    // Given: payload가 잘못된 PENDING event가 있다.
    const applicationId = APPLICATION_IDS[3];
    await createApprovedApplication(applicationId);
    const eventId = await createProvisionEvent(applicationId);
    await prisma.outboxEvent.update({
      where: { id: eventId },
      data: { payload: { applicationId } },
    });

    // When: consumer가 event를 처리한다.
    const result = await consumer.consumeNext('worker-d', NOW);

    // Then: 민감한 payload 없이 정규화한 실패 코드만 저장한다.
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
      prisma.repositoryProvisionJob.count({ where: { applicationId } }),
    ).resolves.toBe(0);
  });
});
