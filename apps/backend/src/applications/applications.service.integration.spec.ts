import {
  ApplicationStatus,
  ProgramCategory,
  RepositoryConnectionMode,
  RepositoryProvisionJobStatus,
  Role,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { APPLICATION_DECISION_ACTIONS } from './domain/application-decision';
import { ApplicationsErrorCode } from './applications-error-code.enum';
import { ApplicationsRepository } from './applications.repository';
import { ApplicationsService } from './applications.service';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { StudentApplicationManagementRepository } from './student-application-management.repository';
import { StudentApplicationManagementService } from './student-application-management.service';

// allow: SIZE_OK — 판정 트랜잭션 시나리오가 하나의 격리 PostgreSQL lifecycle을 공유한다.
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new ApplicationsRepository(prisma, {
  TEAM_JOIN_CODE_SECRET: 'synthetic-applications-integration-secret',
});
const service = new ApplicationsService(
  repository,
  new AuditLogService(new AuditLogRepository(prisma)),
);
const studentService = new StudentApplicationManagementService(
  new StudentApplicationManagementRepository(prisma),
  repository,
);
const ACTOR_ID = 'synthetic-decision-actor';
const ACTOR_GITHUB_ID = 8_000_000_000_001n;
const APPLICANT_ID = 'synthetic-decision-applicant';
const APPLICANT_GITHUB_ID = 8_000_000_000_002n;
const TEAM_ID = 'synthetic-decision-team';
const CREATE_PROGRAM_ID = 'synthetic-create-program';
const CREATE_TEAM_ID = 'synthetic-create-team';
const APPLICATION_IDS = [
  'synthetic-enabled-application',
  'synthetic-disabled-application',
  'synthetic-rejected-application',
  'synthetic-parallel-application',
  'synthetic-conflict-application',
  'synthetic-decided-application',
  'synthetic-cancelled-application',
  'synthetic-transaction-failure-application',
] as const;

async function createApplication(
  applicationId: (typeof APPLICATION_IDS)[number],
  repositoryProvisioningEnabled: boolean,
): Promise<void> {
  const programId = `${applicationId}-program`;
  const teamId = `${applicationId}-team`;
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
  await prisma.team.create({
    data: {
      id: teamId,
      programId,
      name: `team-${applicationId}`,
      joinCodeDigest: `digest-${applicationId}`,
      leaderId: APPLICANT_ID,
    },
  });
  await prisma.teamMember.create({
    data: {
      teamId,
      programId,
      userId: APPLICANT_ID,
    },
  });
  await prisma.application.create({
    data: {
      id: applicationId,
      programId,
      applicantId: APPLICANT_ID,
      teamId,
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
          githubId: APPLICANT_GITHUB_ID,
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
      where: {
        OR: [
          { id: { in: [...APPLICATION_IDS] } },
          { programId: CREATE_PROGRAM_ID },
        ],
      },
    });
    await prisma.teamMember.deleteMany({
      where: {
        OR: [
          { teamId: { in: [TEAM_ID, CREATE_TEAM_ID] } },
          {
            teamId: {
              in: APPLICATION_IDS.map((id) => `${id}-team`),
            },
          },
          { programId: CREATE_PROGRAM_ID },
        ],
      },
    });
    await prisma.team.deleteMany({
      where: {
        OR: [
          { id: { in: [TEAM_ID, CREATE_TEAM_ID] } },
          {
            id: {
              in: APPLICATION_IDS.map((id) => `${id}-team`),
            },
          },
          { programId: CREATE_PROGRAM_ID },
        ],
      },
    });
    await prisma.program.deleteMany({
      where: {
        id: {
          in: [
            ...APPLICATION_IDS.map((id) => `${id}-program`),
            CREATE_PROGRAM_ID,
          ],
        },
      },
    });
  });

  afterAll(async () => {
    // #547 이후 판정이 `AuditLog` 행을 남긴다. 그 원장은 append-only 트리거로 삭제가
    // 금지돼 있고 actor를 FK(restrict)로 잡으므로, 여기서 actor를 지우면 정리 자체가
    // 실패한다. 통합 DB는 run마다 버려지는 컨테이너라 합성 사용자 2명은 그대로 둔다.
    await prisma.$disconnect();
  });

  it('프로그램 최소 인원이 1보다 크면 1인 팀 자동 생성 신청을 거절한다', async () => {
    // Given
    await prisma.program.create({
      data: {
        id: CREATE_PROGRAM_ID,
        name: 'synthetic-create-program',
        organizer: 'synthetic-organizer',
        category: ProgramCategory.CAPSTONE,
        applicationTemplateKey: 'synthetic-template',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
        description: 'synthetic-description',
        teamMinSize: 2,
        teamMaxSize: 4,
      },
    });

    // When
    const application = service.create(
      8_000_000_000_002n,
      CREATE_PROGRAM_ID,
      {
        answers: { title: '팀 제목', summary: '팀 요약' },
        teamName: null,
        applicationTemplateVersion: 1,
        isRepositoryPublicationPlanned: true,
        repositoryConnectionMode: RepositoryConnectionMode.NEW,
        repositoryUrl: null,
      },
      new Date('2026-07-15T00:00:00.000Z'),
    );

    // Then
    await expect(application).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.TEAM_MIN_SIZE_NOT_MET,
        status: 422,
      },
      extensions: { memberCount: 1, teamMinSize: 2 },
    });
    await expect(
      prisma.application.count({ where: { programId: CREATE_PROGRAM_ID } }),
    ).resolves.toBe(0);
    await expect(
      prisma.team.count({ where: { programId: CREATE_PROGRAM_ID } }),
    ).resolves.toBe(0);
  });
  it('신청을 승인하면 같은 트랜잭션에 outbox를 남긴다', async () => {
    // Given
    const applicationId = APPLICATION_IDS[0];
    await createApplication(applicationId, true);

    // When
    const result = await service.decide(
      ACTOR_ID,
      applicationId,
      ACTOR_GITHUB_ID,
      {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      },
    );

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
      teamId: `${applicationId}-team`,
      requestedAt: application.processedAt?.toISOString(),
      collaboratorGithubLogins: ['synthetic-applicant'],
    });
    // #547 — 판정과 같은 트랜잭션에서 typed audit이 실제 원장에 남는다.
    const auditLog = await prisma.auditLog.findFirstOrThrow({
      where: { targetType: 'APPLICATION', targetId: applicationId },
    });
    expect(auditLog).toMatchObject({
      actorId: ACTOR_ID,
      action: 'APPLICATION_APPROVED',
    });
    expect(auditLog.metadata).toMatchObject({
      schemaVersion: 1,
      after: { status: ApplicationStatus.APPROVED },
    });
  });

  it('저장소 기능이 꺼진 프로그램은 승인하고 outbox를 만들지 않는다', async () => {
    // Given
    const applicationId = APPLICATION_IDS[1];
    await createApplication(applicationId, false);

    // When
    const result = await service.decide(
      ACTOR_ID,
      applicationId,
      ACTOR_GITHUB_ID,
      {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      },
    );

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

  it('팀 승인은 팀장과 팀원을 정규화한 snapshot으로 고정한다', async () => {
    // Given
    const applicationId = APPLICATION_IDS[0];
    const programId = `${applicationId}-program`;
    const teamId = `${applicationId}-team`;
    await createApplication(applicationId, true);
    await prisma.teamMember.create({
      data: {
        teamId,
        programId,
        userId: ACTOR_ID,
      },
    });

    // When
    await service.decide(ACTOR_ID, applicationId, ACTOR_GITHUB_ID, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });

    // Then
    const event = await prisma.outboxEvent.findUniqueOrThrow({
      where: { idempotencyKey: `repository-provision:${applicationId}` },
    });
    expect(event.payload).toMatchObject({
      teamId,
      collaboratorGithubLogins: ['synthetic-applicant', 'synthetic-staff'],
    });
  });

  it('반려는 사유를 저장하고 outbox를 만들지 않는다', async () => {
    // Given
    const applicationId = APPLICATION_IDS[2];
    await createApplication(applicationId, true);

    // When
    await service.decide(ACTOR_ID, applicationId, ACTOR_GITHUB_ID, {
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
      service.decide(ACTOR_ID, applicationId, ACTOR_GITHUB_ID, {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      }),
      service.decide(ACTOR_ID, applicationId, ACTOR_GITHUB_ID, {
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

  it('남은 미완료 요청은 지우고 새 이벤트를 발행한다 — 멱등키 충돌 없음', async () => {
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
    const decision = service.decide(ACTOR_ID, applicationId, ACTOR_GITHUB_ID, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });

    // Then — 승인은 항상 새 요청을 발행한다. 남은 이벤트를 재사용하면 컨슈머가
    // 만든 고아 job이 FAILED_FINAL로 굳어 저장소가 영영 안 만들어질 수 있다.
    // 멱등키가 유일하게 유지되므로 저장소가 두 번 만들어지지도 않는다.
    const approved = await decision;
    expect(approved).toMatchObject({
      kind: 'APPROVED',
      repositoryProvisioning: { enabled: true },
    });
    expect(
      approved.kind === 'APPROVED'
        ? approved.repositoryProvisioning.eventId
        : null,
    ).not.toBe(existing.id);
    await expect(
      prisma.application.findUniqueOrThrow({ where: { id: applicationId } }),
    ).resolves.toMatchObject({ status: ApplicationStatus.APPROVED });
    await expect(
      prisma.outboxEvent.count({
        where: { idempotencyKey: `repository-provision:${applicationId}` },
      }),
    ).resolves.toBe(1);
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
    const decision = service.decide(ACTOR_ID, applicationId, ACTOR_GITHUB_ID, {
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

  it('판정 사전 조회 후 학생 취소가 먼저 완료되면 404를 반환한다', async () => {
    // Given
    const applicationId = APPLICATION_IDS[6];
    await createApplication(applicationId, false);
    const originalWithTransaction = repository.withTransaction.bind(repository);
    let releaseDecision: (() => void) | undefined;
    const decisionGate = new Promise<void>((resolve) => {
      releaseDecision = resolve;
    });
    let markDecisionReady: (() => void) | undefined;
    const decisionReady = new Promise<void>((resolve) => {
      markDecisionReady = resolve;
    });
    jest
      .spyOn(repository, 'withTransaction')
      .mockImplementationOnce((operation) =>
        originalWithTransaction((store) =>
          operation({
            // #547 — 판정 전이와 감사 기록이 같은 트랜잭션에서 커밋되므로
            // 경합 테스트의 대리 store도 감사 writer를 그대로 넘겨야 한다.
            auditLogWriter: store.auditLogWriter,
            findApplicationById: (id) => store.findApplicationById(id),
            discardRepositoryProvisionRequest: (id) =>
              store.discardRepositoryProvisionRequest(id),
            findRepositoryProvisionJob: (id) =>
              store.findRepositoryProvisionJob(id),
            findRepositoryProvisionEvent: (key) =>
              store.findRepositoryProvisionEvent(key),
            transitionApplication: async (input) => {
              markDecisionReady?.();
              await decisionGate;
              return store.transitionApplication(input);
            },
            createRepositoryProvisionEvent: (input) =>
              store.createRepositoryProvisionEvent(input),
          }),
        ),
      );

    // When
    const decision = service.decide(ACTOR_ID, applicationId, ACTOR_GITHUB_ID, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });
    await decisionReady;
    await studentService.cancelMine(
      APPLICANT_GITHUB_ID,
      `${applicationId}-program`,
      new Date('2026-07-15T00:00:00.000Z'),
    );
    releaseDecision?.();

    // Then
    await expect(decision).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.APPLICATION_NOT_FOUND,
        status: 404,
      },
    });
  });
  it('없는 신청은 404로 거부한다', async () => {
    // When
    const decision = service.decide(
      ACTOR_ID,
      'synthetic-missing-application',
      ACTOR_GITHUB_ID,
      {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      },
    );

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
    const applicationId = APPLICATION_IDS[7];
    await createApplication(applicationId, true);

    // When
    const decision = service.decide(
      'synthetic-missing-actor',
      applicationId,
      ACTOR_GITHUB_ID,
      {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      },
    );

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
