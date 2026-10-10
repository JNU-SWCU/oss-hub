import {
  AffiliationKind,
  ApplicationStatus,
  MemberKind,
  ProgramCategory,
  RepositoryConnectionMode,
  RepositoryIssuanceOutcome,
  RepositoryProvisionJobStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { APPLICATION_DECISION_ACTIONS } from '../domain/application-decision';
import { ApplicationsErrorCode } from '../domain/applications-error-code.enum';
import { ApplicationsRepository } from '../repository/applications.repository';
import { ApplicationsService } from './applications.service';
import { AuditLogRepository } from '../../audit-log/repository/audit-log.repository';
import { AuditLogService } from '../../audit-log/service/audit-log.service';
import { UsersAuthorityRepository } from '../../users/repository/authority.repository';
import { UsersAuthorityService } from '../../users/service/authority.service';
import { StudentApplicationManagementRepository } from '../repository/student-application-management.repository';
import { StudentApplicationManagementService } from './student-application-management.service';
import { ApplicationJoinCodeService } from './application-join-code.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new ApplicationsRepository(prisma);
const service = new ApplicationsService(
  repository,
  new AuditLogService(new AuditLogRepository(prisma)),
  new UsersAuthorityService(new UsersAuthorityRepository(prisma)),
  new ApplicationJoinCodeService({
    TEAM_JOIN_CODE_SECRET: 'synthetic-applications-integration-secret',
  }),
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
  'synthetic-switch-reject-application',
  'synthetic-switch-approve-application',
  'synthetic-provisioned-application',
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
          selectedMemberKind: MemberKind.STAFF,
          hasStaffAccess: true,
        },
        {
          id: APPLICANT_ID,
          githubId: APPLICANT_GITHUB_ID,
          nickname: 'Synthetic-Applicant',
          selectedMemberKind: MemberKind.STUDENT,
        },
      ],
    });
    await prisma.userProfile.createMany({
      data: [
        {
          userId: ACTOR_ID,
          name: 'Synthetic user',
          studentId: null,
          department: 'Synthetic program office',
          memberKind: MemberKind.STAFF,
          affiliationKind: AffiliationKind.PROGRAM_OFFICE,
          affiliationName: 'Synthetic program office',
        },
        {
          userId: APPLICANT_ID,
          name: 'Synthetic user',
          studentId: '800002',
          department: 'Synthetic department',
          memberKind: MemberKind.STUDENT,
          affiliationKind: AffiliationKind.DEPARTMENT,
          affiliationName: 'Synthetic department',
        },
      ],
    });
  });

  afterEach(async () => {
    await prisma.notification.deleteMany({
      where: { type: 'APPLICATION_DECISION' },
    });
    await prisma.repositoryIssuanceHistory.deleteMany({
      where: { applicationId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.outboxEvent.deleteMany({
      where: { aggregateId: { in: [...APPLICATION_IDS] } },
    });

    await prisma.repositoryProvisionJob.deleteMany({
      where: { applicationId: { in: [...APPLICATION_IDS] } },
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
    await prisma.$disconnect();
  });

  it('프로그램 최소 인원이 1보다 크면 1인 팀 자동 생성 신청을 거절한다', async () => {
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

        repositoryProvisioningEnabled: true,
      },
    });

    const application = service.create(
      8_000_000_000_002n,
      CREATE_PROGRAM_ID,
      {
        answers: { title: '팀 제목' },
        teamName: null,
        applicationTemplateVersion: 1,
        isRepositoryPublicationPlanned: true,
      },
      new Date('2026-07-15T00:00:00.000Z'),
    );

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
    const applicationId = APPLICATION_IDS[0];
    await createApplication(applicationId, true);

    const result = await service.decide(ACTOR_GITHUB_ID, applicationId, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });

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
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { applicationId },
      }),
    ).resolves.toMatchObject({
      currentEventId: event.id,
      status: RepositoryProvisionJobStatus.PENDING,
      attemptCount: 0,
      lockedAt: null,
      lockedBy: null,
    });

    const auditLog = await prisma.auditLog.findFirstOrThrow({
      where: { targetType: 'APPLICATION', targetId: applicationId },
    });
    expect(auditLog).toMatchObject({
      actorId: ACTOR_ID,
      action: 'APPLICATION_APPROVED',
    });
    expect(auditLog.metadata).toMatchObject({
      schemaVersion: 2,
      programName: `program-${applicationId}`,
      applicantGithubLogin: 'Synthetic-Applicant',
      after: { status: ApplicationStatus.APPROVED },
    });
    const notification = await prisma.notification.findFirstOrThrow({
      where: {
        userId: APPLICANT_ID,
        type: 'APPLICATION_DECISION',
        status: 'UNREAD',
      },
    });
    expect(notification).toMatchObject({
      channel: 'IN_APP',
      payload: {
        schemaVersion: 1,
        applicationId,
        programId: `${applicationId}-program`,
        programName: `program-${applicationId}`,
        decision: ApplicationStatus.APPROVED,
        decidedAt: application.processedAt?.toISOString(),
      },
    });
  });

  it('저장소 기능이 꺼진 프로그램은 승인하고 outbox를 만들지 않는다', async () => {
    const applicationId = APPLICATION_IDS[1];
    await createApplication(applicationId, false);

    const result = await service.decide(ACTOR_GITHUB_ID, applicationId, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });

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

    await service.decide(ACTOR_GITHUB_ID, applicationId, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });

    const event = await prisma.outboxEvent.findUniqueOrThrow({
      where: { idempotencyKey: `repository-provision:${applicationId}` },
    });
    expect(event.payload).toMatchObject({
      teamId,
      collaboratorGithubLogins: ['synthetic-applicant', 'synthetic-staff'],
    });
    await expect(
      prisma.notification.count({
        where: { type: 'APPLICATION_DECISION' },
      }),
    ).resolves.toBe(2);
  });

  it('반려는 사유를 저장하고 outbox를 만들지 않는다', async () => {
    const applicationId = APPLICATION_IDS[2];
    await createApplication(applicationId, true);

    await service.decide(ACTOR_GITHUB_ID, applicationId, {
      action: APPLICATION_DECISION_ACTIONS.REJECT,
      reason: '합성 반려 사유',
    });
    const application = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
    });

    expect(application).toMatchObject({
      status: ApplicationStatus.REJECTED,
      rejectionReason: '합성 반려 사유',
      processedById: ACTOR_ID,
    });
    expect(application.processedAt).toBeInstanceOf(Date);
    await expect(
      prisma.outboxEvent.count({ where: { aggregateId: applicationId } }),
    ).resolves.toBe(0);
    const rejectedNotification = await prisma.notification.findFirstOrThrow({
      where: { userId: APPLICANT_ID, type: 'APPLICATION_DECISION' },
    });
    expect(rejectedNotification.payload).toMatchObject({
      applicationId,
      decision: ApplicationStatus.REJECTED,
    });
  });

  it('동시 승인은 상태와 idempotencyKey 기준 이벤트 한 건으로 수렴한다', async () => {
    const applicationId = APPLICATION_IDS[3];
    await createApplication(applicationId, true);

    const decisions = await Promise.allSettled([
      service.decide(ACTOR_GITHUB_ID, applicationId, {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      }),
      service.decide(ACTOR_GITHUB_ID, applicationId, {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      }),
    ]);

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

  it('동시 반려는 CAS 승자 하나만 이력·알림을 남기고 패자는 부수효과가 0이다', async () => {
    const applicationId = APPLICATION_IDS[4];
    await createApplication(applicationId, false);

    const decisions = await Promise.allSettled([
      service.decide(ACTOR_GITHUB_ID, applicationId, {
        action: APPLICATION_DECISION_ACTIONS.REJECT,
        reason: '합성 반려 사유 A',
      }),
      service.decide(ACTOR_GITHUB_ID, applicationId, {
        action: APPLICATION_DECISION_ACTIONS.REJECT,
        reason: '합성 반려 사유 B',
      }),
    ]);

    expect(
      decisions.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejectionEvents = await prisma.applicationReviewHistory.count({
      where: { applicationId, eventKind: 'REJECTED' },
    });
    expect(rejectionEvents).toBe(1);
    const notifications = await prisma.notification.count({
      where: {
        type: 'APPLICATION_DECISION',
        payload: { path: ['applicationId'], equals: applicationId },
      },
    });

    expect(notifications).toBe(1);
  });

  it('남은 미완료 요청은 지우고 새 이벤트를 발행한다 — 먱등키 충돌 없음', async () => {
    const applicationId = APPLICATION_IDS[4];
    await createApplication(applicationId, true);
    const existing = await prisma.outboxEvent.create({
      data: {
        type: 'REPOSITORY_PROVISION_REQUESTED',
        aggregateType: 'Application',
        aggregateId: applicationId,
        idempotencyKey: `repository-provision:${applicationId}`,
        payload: {
          applicationId,
          programId: `${applicationId}-program`,
          teamId: `${applicationId}-team`,
          requestedAt: new Date('2026-09-17T00:00:00.000Z').toISOString(),
          collaboratorGithubLogins: ['synthetic-applicant'],
          repositoryConnectionMode: RepositoryConnectionMode.NEW,
          repositoryUrl: null,
        },
      },
    });

    const decision = service.decide(ACTOR_GITHUB_ID, applicationId, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });

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
      prisma.repositoryIssuanceHistory.findUniqueOrThrow({
        where: { requestId: existing.id },
      }),
    ).resolves.toMatchObject({
      applicationId,
      connectionMode: RepositoryConnectionMode.NEW,
      outcome: RepositoryIssuanceOutcome.DISCARDED,
    });
    await expect(
      prisma.repositoryIssuanceHistory.count({
        where: { requestId: existing.id },
      }),
    ).resolves.toBe(1);
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
    const applicationId = APPLICATION_IDS[5];
    await createApplication(applicationId, false);
    await prisma.application.update({
      where: { id: applicationId },
      data: { status: ApplicationStatus.APPROVED },
    });

    const decision = service.decide(ACTOR_GITHUB_ID, applicationId, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });

    await expect(decision).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.APPLICATION_ALREADY_DECIDED,
        status: 409,
      },
      extensions: { latestStatus: ApplicationStatus.APPROVED },
    });
  });

  it('#1272 승인→반려: PATCH 한 번으로 전이하고 미완료 요청을 같은 트랜잭션에서 지운다', async () => {
    const applicationId = APPLICATION_IDS[8];
    await createApplication(applicationId, true);
    await service.decide(ACTOR_GITHUB_ID, applicationId, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });
    await expect(
      prisma.outboxEvent.count({ where: { aggregateId: applicationId } }),
    ).resolves.toBe(1);

    const result = await service.decide(ACTOR_GITHUB_ID, applicationId, {
      action: APPLICATION_DECISION_ACTIONS.REJECT,
      reason: '합성 재판정 사유',
    });

    expect(result).toMatchObject({
      kind: 'REJECTED',
      status: ApplicationStatus.REJECTED,
      rejectionReason: '합성 재판정 사유',
    });
    await expect(
      prisma.application.findUniqueOrThrow({ where: { id: applicationId } }),
    ).resolves.toMatchObject({
      status: ApplicationStatus.REJECTED,
      rejectionReason: '합성 재판정 사유',
      processedById: ACTOR_ID,
    });

    await expect(
      prisma.outboxEvent.count({ where: { aggregateId: applicationId } }),
    ).resolves.toBe(0);

    const auditLogs = await prisma.auditLog.findMany({
      where: { targetType: 'APPLICATION', targetId: applicationId },
    });
    expect(auditLogs.map((log) => log.action).sort()).toEqual([
      'APPLICATION_APPROVED',
      'APPLICATION_REJECTED',
    ]);
    const rejectedLog = auditLogs.find(
      (log) => log.action === 'APPLICATION_REJECTED',
    );
    expect(rejectedLog?.metadata).toMatchObject({
      before: { status: ApplicationStatus.APPROVED },
      after: { status: ApplicationStatus.REJECTED },
    });
    await expect(
      prisma.notification.count({
        where: {
          userId: APPLICANT_ID,
          type: 'APPLICATION_DECISION',
        },
      }),
    ).resolves.toBe(2);
  });

  it('#1272 반려→승인: PATCH 한 번으로 전이하고 새 프로비저닝 이벤트를 발행한다', async () => {
    const applicationId = APPLICATION_IDS[9];
    await createApplication(applicationId, true);
    await service.decide(ACTOR_GITHUB_ID, applicationId, {
      action: APPLICATION_DECISION_ACTIONS.REJECT,
      reason: '합성 반려 사유',
    });

    const result = await service.decide(ACTOR_GITHUB_ID, applicationId, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });

    const event = await prisma.outboxEvent.findUniqueOrThrow({
      where: { idempotencyKey: `repository-provision:${applicationId}` },
    });
    expect(result).toMatchObject({
      kind: 'APPROVED',
      status: ApplicationStatus.APPROVED,
      repositoryProvisioning: {
        enabled: true,
        eventId: event.id,
        jobStatus: RepositoryProvisionJobStatus.PENDING,
      },
    });
    const application = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
    });
    expect(application).toMatchObject({
      status: ApplicationStatus.APPROVED,
      processedById: ACTOR_ID,
    });

    expect(application.rejectionReason).toBeNull();
  });

  it('프로비저닝이 끝난 승인도 반려·되돌림·재승인이 다 되고 완료된 요청은 보존된다', async () => {
    const applicationId = APPLICATION_IDS[10];
    await createApplication(applicationId, true);
    await service.decide(ACTOR_GITHUB_ID, applicationId, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });
    await prisma.repositoryProvisionJob.update({
      where: { applicationId },
      data: { status: RepositoryProvisionJobStatus.SUCCEEDED },
    });
    const provisionedJob =
      await prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { applicationId },
      });
    const provisionedEvent = await prisma.outboxEvent.findUniqueOrThrow({
      where: { idempotencyKey: `repository-provision:${applicationId}` },
    });

    await expect(
      service.decide(ACTOR_GITHUB_ID, applicationId, {
        action: APPLICATION_DECISION_ACTIONS.REJECT,
        reason: '합성 반려 사유',
      }),
    ).resolves.toMatchObject({ kind: 'REJECTED' });

    await expect(
      prisma.application.findUniqueOrThrow({ where: { id: applicationId } }),
    ).resolves.toMatchObject({ status: ApplicationStatus.REJECTED });
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { applicationId },
      }),
    ).resolves.toMatchObject({
      id: provisionedJob.id,
      status: RepositoryProvisionJobStatus.SUCCEEDED,
    });
    await expect(
      prisma.outboxEvent.findUniqueOrThrow({
        where: { idempotencyKey: `repository-provision:${applicationId}` },
      }),
    ).resolves.toMatchObject({ id: provisionedEvent.id });

    await expect(
      service.decide(ACTOR_GITHUB_ID, applicationId, {
        action: APPLICATION_DECISION_ACTIONS.REVERT,
      }),
    ).resolves.toMatchObject({ kind: 'REVERTED' });
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { applicationId },
      }),
    ).resolves.toMatchObject({ id: provisionedJob.id });

    const reapproved = await service.decide(ACTOR_GITHUB_ID, applicationId, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });

    expect(reapproved).toMatchObject({
      kind: 'APPROVED',
      repositoryProvisioning: {
        enabled: true,
        eventId: provisionedEvent.id,
        jobStatus: RepositoryProvisionJobStatus.SUCCEEDED,
      },
    });
    await expect(
      prisma.outboxEvent.count({
        where: { aggregateId: applicationId, aggregateType: 'Application' },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { applicationId },
      }),
    ).resolves.toMatchObject({
      id: provisionedJob.id,
      status: RepositoryProvisionJobStatus.SUCCEEDED,
    });

    const history = await prisma.applicationReviewHistory.findMany({
      where: { applicationId },
      orderBy: { occurredAt: 'asc' },
      select: { eventKind: true, revision: true },
    });
    expect(history.map((row) => row.eventKind)).toEqual([
      'APPROVED',
      'REJECTED',
      'REVERTED',
      'APPROVED',
    ]);

    expect(history.every((row) => row.revision === 1)).toBe(true);
  });

  it('판정 사전 조회 후 학생 취소가 먼저 완료되면 404를 반환한다', async () => {
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
            auditLogWriter: store.auditLogWriter,
            appendReviewHistory: (input) => store.appendReviewHistory(input),
            findApplicationById: (id) => store.findApplicationById(id),
            discardRepositoryProvisionRequest: (id, discardedAt) =>
              store.discardRepositoryProvisionRequest(id, discardedAt),
            findRepositoryProvisionJob: (id) =>
              store.findRepositoryProvisionJob(id),
            findRepositoryProvisionEvent: (key) =>
              store.findRepositoryProvisionEvent(key),
            transitionApplication: async (input) => {
              markDecisionReady?.();
              await decisionGate;
              return store.transitionApplication(input);
            },
            createApplicationDecisionNotifications: (input) =>
              store.createApplicationDecisionNotifications(input),
            createRepositoryProvisionEvent: (input) =>
              store.createRepositoryProvisionEvent(input),
          }),
        ),
      );

    const decision = service.decide(ACTOR_GITHUB_ID, applicationId, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });
    await decisionReady;
    await studentService.cancelMine(
      APPLICANT_GITHUB_ID,
      `${applicationId}-program`,
      new Date('2026-07-15T00:00:00.000Z'),
    );
    releaseDecision?.();

    await expect(decision).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.APPLICATION_NOT_FOUND,
        status: 404,
      },
    });
  });
  it('없는 신청은 404로 거부한다', async () => {
    const decision = service.decide(
      ACTOR_GITHUB_ID,
      'synthetic-missing-application',
      {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      },
    );

    await expect(decision).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.APPLICATION_NOT_FOUND,
        status: 404,
      },
    });
  });

  it('알림 기록 뒤 판정 트랜잭션 실패는 상태·감사·알림을 모두 롤백한다', async () => {
    const applicationId = APPLICATION_IDS[7];
    await createApplication(applicationId, true);
    const originalWithTransaction = repository.withTransaction.bind(repository);
    jest
      .spyOn(repository, 'withTransaction')
      .mockImplementationOnce((operation) =>
        originalWithTransaction((store) =>
          operation({
            auditLogWriter: store.auditLogWriter,
            appendReviewHistory: (input) => store.appendReviewHistory(input),
            findApplicationById: (id) => store.findApplicationById(id),
            discardRepositoryProvisionRequest: (id, discardedAt) =>
              store.discardRepositoryProvisionRequest(id, discardedAt),
            findRepositoryProvisionJob: (id) =>
              store.findRepositoryProvisionJob(id),
            findRepositoryProvisionEvent: (key) =>
              store.findRepositoryProvisionEvent(key),
            transitionApplication: (input) =>
              store.transitionApplication(input),
            createApplicationDecisionNotifications: async (input) => {
              await store.createApplicationDecisionNotifications(input);
              throw new Error('synthetic post-notification failure');
            },
            createRepositoryProvisionEvent: (input) =>
              store.createRepositoryProvisionEvent(input),
          }),
        ),
      );

    const decision = service.decide(ACTOR_GITHUB_ID, applicationId, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });

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
    await expect(
      prisma.notification.count({ where: { type: 'APPLICATION_DECISION' } }),
    ).resolves.toBe(0);
    await expect(
      prisma.auditLog.count({
        where: { targetType: 'APPLICATION', targetId: applicationId },
      }),
    ).resolves.toBe(0);
  });
});
