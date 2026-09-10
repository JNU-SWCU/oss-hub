import {
  ApplicationStatus,
  MemberKind,
  Prisma,
  OutboxEventStatus,
  ProgramCategory,
  RepositoryProvisionJobStatus,
  ProgramTrackType,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { RepositoriesRepository } from './repository/repositories.repository';
import { RepositoryOutboxConsumer } from './repository-outbox.consumer';
import {
  REPOSITORY_PROVISION_EVENT_TYPE,
  repositoryAccessSyncEventData,
} from './repository-provision-event';

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
  'synthetic-consume-succeeded',
  'synthetic-consume-duplicate',
  'synthetic-consume-processing',
  'synthetic-consume-sync-invalid',
] as const;

function programId(applicationId: string): string {
  return `${applicationId}-program`;
}

function teamIdFor(applicationId: string): string {
  return `${applicationId}-team`;
}

async function createApprovedApplication(applicationId: string): Promise<void> {
  const program = programId(applicationId);
  const teamId = teamIdFor(applicationId);
  await prisma.program.create({
    data: {
      id: program,
      name: `program-${applicationId}`,
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
      name: `${applicationId}-team`,
      joinCodeDigest: `${applicationId}-team-digest`,
      leaderId: APPLICANT_ID,
    },
  });
  await prisma.teamMember.create({
    data: {
      id: `${applicationId}-team-member`,
      teamId,
      programId: program,
      userId: APPLICANT_ID,
    },
  });
  await prisma.application.create({
    data: {
      id: applicationId,
      programId: program,
      applicantId: APPLICANT_ID,
      teamId,
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

async function createAccessSyncEvent(
  applicationId: string,
  requestedAt: Date = NOW,
  payloadOverride?: Prisma.InputJsonValue,
): Promise<string> {
  const data = repositoryAccessSyncEventData(
    applicationId,
    teamIdFor(applicationId),
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

describe('RepositoryOutboxConsumer integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: {
        id: APPLICANT_ID,
        githubId: 8_100_000_000_001n,
        nickname: 'synthetic-applicant',
        selectedMemberKind: MemberKind.STUDENT,
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
    await prisma.teamMember.deleteMany({
      where: { id: { in: APPLICATION_IDS.map((id) => `${id}-team-member`) } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: APPLICATION_IDS.map(teamIdFor) } },
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

  it('완료된 job은 권한 동기화 요청으로 다시 무장된다', async () => {
    // Given: 이미 성공해 종료된 job과 새 권한 동기화 요청이 있다.
    const applicationId = APPLICATION_IDS[5];
    await createApprovedApplication(applicationId);
    await prisma.repositoryProvisionJob.create({
      data: {
        applicationId,
        status: RepositoryProvisionJobStatus.SUCCEEDED,
        attemptCount: 3,
        nextAttemptAt: new Date(NOW.getTime() + 60 * 60_000),
        lastErrorCode: 'PREVIOUS_FAILURE',
        lastErrorMessage: 'previous failure detail',
        finishedAt: new Date(NOW.getTime() - 60_000),
      },
    });
    const eventId = await createAccessSyncEvent(applicationId);

    // When: consumer가 권한 동기화 event를 처리한다.
    const result = await consumer.consumeNext('worker-sync', NOW);

    // Then: 같은 job이 지금 실행 대상으로 되살아나고 이전 실패 흔적이 지워진다.
    const job = await prisma.repositoryProvisionJob.findUniqueOrThrow({
      where: { applicationId },
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
    // Given: 같은 신청에 대한 권한 동기화 event가 두 건 쌓여 있다.
    const applicationId = APPLICATION_IDS[6];
    await createApprovedApplication(applicationId);
    const firstEventId = await createAccessSyncEvent(applicationId);
    const secondEventId = await createAccessSyncEvent(
      applicationId,
      new Date(NOW.getTime() + 1_000),
    );

    // When: consumer가 두 event를 모두 처리한다.
    const first = await consumer.consumeNext('worker-dup', NOW);
    const second = await consumer.consumeNext(
      'worker-dup',
      new Date(NOW.getTime() + 2_000),
    );

    // Then: 두 event 모두 처리되지만 job은 하나이고 즉시 실행 시각을 유지한다.
    const jobs = await prisma.repositoryProvisionJob.findMany({
      where: { applicationId },
    });
    expect(jobs).toHaveLength(1);
    const job = await prisma.repositoryProvisionJob.findUniqueOrThrow({
      where: { applicationId },
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
    // Given: 다른 worker가 잡고 실행 중인 job이 있다.
    const applicationId = APPLICATION_IDS[7];
    await createApprovedApplication(applicationId);
    const lockedAt = new Date(NOW.getTime() - 30_000);
    await prisma.repositoryProvisionJob.create({
      data: {
        applicationId,
        status: RepositoryProvisionJobStatus.PROCESSING,
        attemptCount: 2,
        nextAttemptAt: new Date(NOW.getTime() + 60_000),
        lockedAt,
        lockedBy: 'provision-worker',
      },
    });
    const eventId = await createAccessSyncEvent(applicationId);

    // When: consumer가 권한 동기화 event를 처리한다.
    const result = await consumer.consumeNext('worker-lease', NOW);

    // Then: event는 소비되지만 진행 중 job의 상태와 lease는 그대로다.
    const job = await prisma.repositoryProvisionJob.findUniqueOrThrow({
      where: { applicationId },
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
    // Given: 계약에 없는 key가 섞인 권한 동기화 event가 있다.
    const applicationId = APPLICATION_IDS[8];
    await createApprovedApplication(applicationId);
    const eventId = await createAccessSyncEvent(applicationId, NOW, {
      applicationId,
      teamId: teamIdFor(applicationId),
      requestedAt: NOW.toISOString(),
      githubLogins: ['synthetic-applicant'],
    });

    // When: consumer가 event를 처리한다.
    const result = await consumer.consumeNext('worker-sync-invalid', NOW);

    // Then: job을 만들지 않고 정규화한 실패 코드만 남긴다.
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

  it('승인 이벤트 parser는 권한 동기화 payload를 받아들이지 않는다', async () => {
    // Given: type은 승인인데 payload가 권한 동기화 모양인 event가 있다.
    const applicationId = APPLICATION_IDS[4];
    await createApprovedApplication(applicationId);
    const eventId = await createProvisionEvent(applicationId);
    await prisma.outboxEvent.update({
      where: { id: eventId },
      data: {
        payload: {
          applicationId,
          teamId: teamIdFor(applicationId),
          requestedAt: NOW.toISOString(),
        },
      },
    });

    // When: consumer가 event를 처리한다.
    const result = await consumer.consumeNext('worker-grant', NOW);

    // Then: 승인 계약은 그대로 엄격해 job을 만들지 않는다.
    expect(result).toEqual({ kind: 'FAILED', eventId });
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
