import {
  ApplicationStatus,
  ProgramCategory,
  RepositoryProvisionJobStatus,
  Role,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { APPLICATION_DECISION_ACTIONS } from './domain/application-decision';
import { ApplicationsErrorCode } from './applications-error-code.enum';
import { ApplicationsRepository } from './applications.repository';
import { ApplicationsService } from './applications.service';

// allow: SIZE_OK — 판정 트랜잭션 시나리오가 하나의 격리 PostgreSQL lifecycle을 공유한다.
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const service = new ApplicationsService(new ApplicationsRepository(prisma));
const ACTOR_ID = 'synthetic-decision-actor';
const APPLICANT_ID = 'synthetic-decision-applicant';
const TEAM_ID = 'synthetic-decision-team';
const APPLICATION_IDS = [
  'synthetic-enabled-application',
  'synthetic-disabled-application',
  'synthetic-rejected-application',
  'synthetic-parallel-application',
  'synthetic-conflict-application',
  'synthetic-decided-application',
  'synthetic-transaction-failure-application',
] as const;

async function createApplication(
  applicationId: (typeof APPLICATION_IDS)[number],
  repositoryProvisioningEnabled: boolean,
): Promise<void> {
  const programId = `${applicationId}-program`;
  await prisma.program.create({
    data: {
      id: programId,
      name: `program-${applicationId}`,
      organizer: 'synthetic-organizer',
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'synthetic-template',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
      description: 'synthetic-description',
      repositoryProvisioningEnabled,
    },
  });
  await prisma.application.create({
    data: {
      id: applicationId,
      programId,
      applicantId: APPLICANT_ID,
      teamId: null,
      answers: { synthetic: true },
      applicationTemplateVersion: 1,
    },
  });
}

describe('ApplicationsService integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({
      data: [
        {
          id: ACTOR_ID,
          githubId: 8_000_000_000_001n,
          nickname: 'Synthetic-Staff',
          role: Role.STAFF,
        },
        {
          id: APPLICANT_ID,
          githubId: 8_000_000_000_002n,
          nickname: 'Synthetic-Applicant',
          role: Role.STUDENT,
        },
      ],
    });
  });

  afterEach(async () => {
    await prisma.outboxEvent.deleteMany({
      where: { aggregateId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.application.deleteMany({
      where: { id: { in: [...APPLICATION_IDS] } },
    });
    await prisma.teamMember.deleteMany({ where: { teamId: TEAM_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.program.deleteMany({
      where: { id: { in: APPLICATION_IDS.map((id) => `${id}-program`) } },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { id: { in: [ACTOR_ID, APPLICANT_ID] } },
    });
    await prisma.$disconnect();
  });

  it('nullable teamId 신청을 승인하면 같은 트랜잭션에 outbox를 남긴다', async () => {
    // Given
    const applicationId = APPLICATION_IDS[0];
    await createApplication(applicationId, true);

    // When
    const result = await service.decide(ACTOR_ID, applicationId, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });

    // Then
    const application = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
    });
    const event = await prisma.outboxEvent.findUniqueOrThrow({
      where: { idempotencyKey: `repository-provision:${applicationId}` },
    });
    expect(application).toMatchObject({
      status: ApplicationStatus.APPROVED,
      processedById: ACTOR_ID,
    });
    expect(application.processedAt).toBeInstanceOf(Date);
    expect(result).toMatchObject({
      status: ApplicationStatus.APPROVED,
      repositoryProvisioning: {
        enabled: true,
        eventId: event.id,
        jobStatus: RepositoryProvisionJobStatus.PENDING,
      },
    });
    expect(event.payload).toMatchObject({
      applicationId,
      programId: `${applicationId}-program`,
      teamId: null,
      requestedAt: application.processedAt?.toISOString(),
      collaboratorGithubLogins: ['synthetic-applicant'],
    });
  });

  it('저장소 기능이 꺼진 프로그램은 승인하고 outbox를 만들지 않는다', async () => {
    // Given
    const applicationId = APPLICATION_IDS[1];
    await createApplication(applicationId, false);

    // When
    const result = await service.decide(ACTOR_ID, applicationId, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });

    // Then
    expect(result).toMatchObject({
      status: ApplicationStatus.APPROVED,
      repositoryProvisioning: {
        enabled: false,
        eventId: null,
        jobStatus: null,
      },
    });
    await expect(
      prisma.outboxEvent.count({ where: { aggregateId: applicationId } }),
    ).resolves.toBe(0);
  });

  it('팀형 승인은 팀장과 팀원을 정규화한 snapshot으로 고정한다', async () => {
    // Given
    const applicationId = APPLICATION_IDS[0];
    const programId = `${applicationId}-program`;
    await createApplication(applicationId, true);
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        programId,
        name: 'synthetic-team',
        joinCodeDigest: 'synthetic-team-code-digest',
        leaderId: APPLICANT_ID,
        members: {
          create: [{ userId: APPLICANT_ID }, { userId: ACTOR_ID }],
        },
      },
    });
    await prisma.application.update({
      where: { id: applicationId },
      data: { teamId: TEAM_ID },
    });

    // When
    await service.decide(ACTOR_ID, applicationId, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });

    // Then
    const event = await prisma.outboxEvent.findUniqueOrThrow({
      where: { idempotencyKey: `repository-provision:${applicationId}` },
    });
    expect(event.payload).toMatchObject({
      teamId: TEAM_ID,
      collaboratorGithubLogins: ['synthetic-applicant', 'synthetic-staff'],
    });
  });

  it('반려는 사유를 저장하고 outbox를 만들지 않는다', async () => {
    // Given
    const applicationId = APPLICATION_IDS[2];
    await createApplication(applicationId, true);

    // When
    await service.decide(ACTOR_ID, applicationId, {
      action: APPLICATION_DECISION_ACTIONS.REJECT,
      reason: '합성 반려 사유',
    });
    const application = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
    });

    // Then
    expect(application).toMatchObject({
      status: ApplicationStatus.REJECTED,
      rejectionReason: '합성 반려 사유',
      processedById: ACTOR_ID,
    });
    expect(application.processedAt).toBeInstanceOf(Date);
    await expect(
      prisma.outboxEvent.count({ where: { aggregateId: applicationId } }),
    ).resolves.toBe(0);
  });

  it('동시 승인은 상태와 idempotencyKey 기준 이벤트 한 건으로 수렴한다', async () => {
    // Given
    const applicationId = APPLICATION_IDS[3];
    await createApplication(applicationId, true);

    // When
    const decisions = await Promise.allSettled([
      service.decide(ACTOR_ID, applicationId, {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      }),
      service.decide(ACTOR_ID, applicationId, {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      }),
    ]);

    // Then
    expect(
      decisions.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      decisions.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    await expect(
      prisma.outboxEvent.count({
        where: { idempotencyKey: `repository-provision:${applicationId}` },
      }),
    ).resolves.toBe(1);
  });

  it('기존 idempotencyKey 충돌은 승인까지 롤백하고 event id를 반환한다', async () => {
    // Given
    const applicationId = APPLICATION_IDS[4];
    await createApplication(applicationId, true);
    const existing = await prisma.outboxEvent.create({
      data: {
        type: 'REPOSITORY_PROVISION_REQUESTED',
        aggregateType: 'Application',
        aggregateId: applicationId,
        idempotencyKey: `repository-provision:${applicationId}`,
        payload: { synthetic: true },
      },
    });

    // When
    const decision = service.decide(ACTOR_ID, applicationId, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });

    // Then
    await expect(decision).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.REPOSITORY_EVENT_ALREADY_EXISTS,
      },
      extensions: { eventId: existing.id },
    });
    await expect(
      prisma.application.findUniqueOrThrow({ where: { id: applicationId } }),
    ).resolves.toMatchObject({ status: ApplicationStatus.SUBMITTED });
  });

  it('이미 판정된 신청은 409와 최신 상태를 반환한다', async () => {
    // Given
    const applicationId = APPLICATION_IDS[5];
    await createApplication(applicationId, false);
    await prisma.application.update({
      where: { id: applicationId },
      data: { status: ApplicationStatus.APPROVED },
    });

    // When
    const decision = service.decide(ACTOR_ID, applicationId, {
      action: APPLICATION_DECISION_ACTIONS.REJECT,
      reason: '합성 반려 사유',
    });

    // Then
    await expect(decision).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.APPLICATION_ALREADY_DECIDED,
        status: 409,
      },
      extensions: { latestStatus: ApplicationStatus.APPROVED },
    });
  });

  it('없는 신청은 404로 거부한다', async () => {
    // When
    const decision = service.decide(ACTOR_ID, 'synthetic-missing-application', {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });

    // Then
    await expect(decision).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.APPLICATION_NOT_FOUND,
        status: 404,
      },
    });
  });

  it('판정 트랜잭션 실패는 전용 500을 반환하고 상태와 outbox를 롤백한다', async () => {
    // Given
    const applicationId = APPLICATION_IDS[6];
    await createApplication(applicationId, true);

    // When
    const decision = service.decide('synthetic-missing-actor', applicationId, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });

    // Then
    await expect(decision).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.DECISION_TRANSACTION_FAILED,
        status: 500,
      },
    });
    await expect(
      prisma.application.findUniqueOrThrow({ where: { id: applicationId } }),
    ).resolves.toMatchObject({ status: ApplicationStatus.SUBMITTED });
    await expect(
      prisma.outboxEvent.count({ where: { aggregateId: applicationId } }),
    ).resolves.toBe(0);
  });
});
