import {
  ApplicationStatus,
  RepositoryConnectionMode,
  RepositoryProvisionJobStatus,
} from '@prisma/client';
import type { AuditLogService } from '../audit-log/service/audit-log.service';
import { DomainException } from '../common/error-code';
import {
  APPLICATION_DECISION_ACTIONS,
  type ApplicationDecisionNotificationInput,
} from './domain/application-decision';
import type {
  ApplicationsRepository,
  ApplicationsTransactionStore,
} from './applications.repository';
import { ApplicationsErrorCode } from './applications-error-code.enum';
import { ApplicationsService } from './applications.service';
import type { UsersAuthorityService } from '../users/service/authority.service';

type AssertActiveStaff = UsersAuthorityService['assertActiveStaff'];

const APPLICATION_ID = 'synthetic-application';
const ACTOR_ID = 'synthetic-actor';
const PRIOR_PROCESSOR_ID = 'synthetic-prior-processor';
const ACTOR_GITHUB_ID = 4242n;
const PRIOR_PROCESSED_AT = new Date('2026-07-01T00:00:00.000Z');

const auditLogWriter = {
  auditLog: {},
} as ApplicationsTransactionStore['auditLogWriter'];

function baseApplication(
  overrides: Partial<{
    status: ApplicationStatus;
    repositoryProvisioningEnabled: boolean;
    repositoryConnectionMode: RepositoryConnectionMode;
    repositoryUrl: string | null;
    processedById: string | null;
    processedAt: Date | null;
  }> = {},
) {
  return {
    id: APPLICATION_ID,
    programId: 'synthetic-program',
    programName: '합성 프로그램',
    applicantGithubLogin: 'synthetic-applicant-login',
    teamId: null,
    status: overrides.status ?? ApplicationStatus.SUBMITTED,
    collaboratorGithubLogins: [] as string[],
    notificationRecipientIds: ['synthetic-applicant'] as string[],
    repositoryProvisioningEnabled:
      overrides.repositoryProvisioningEnabled ?? false,
    repositoryConnectionMode:
      overrides.repositoryConnectionMode ?? RepositoryConnectionMode.NEW,
    repositoryUrl: overrides.repositoryUrl ?? null,
    processedById: overrides.processedById ?? null,
    processedAt: overrides.processedAt ?? null,
  };
}

function createHarness(
  options: { provisioningEnabled: boolean } = {
    provisioningEnabled: false,
  },
) {
  const record = jest.fn().mockResolvedValue({});
  const transitionApplication = jest.fn().mockResolvedValue(true);
  const createRepositoryProvisionEvent = jest
    .fn()
    .mockResolvedValue({ id: 'synthetic-event' });
  const findRepositoryProvisionJob = jest.fn().mockResolvedValue(null);
  const findRepositoryProvisionEvent = jest.fn().mockResolvedValue(null);
  const discardRepositoryProvisionRequest = jest
    .fn()
    .mockResolvedValue(undefined);
  const createApplicationDecisionNotifications = jest
    .fn<Promise<void>, [ApplicationDecisionNotificationInput]>()
    .mockResolvedValue(undefined);
  const appendReviewHistory = jest
    .fn<
      ReturnType<ApplicationsTransactionStore['appendReviewHistory']>,
      Parameters<ApplicationsTransactionStore['appendReviewHistory']>
    >()
    .mockResolvedValue({ revision: 1 });
  const store: ApplicationsTransactionStore = {
    auditLogWriter,
    appendReviewHistory,
    findApplicationById: jest.fn().mockResolvedValue(
      baseApplication({
        repositoryProvisioningEnabled: options.provisioningEnabled,
      }),
    ),
    findRepositoryProvisionJob,
    findRepositoryProvisionEvent,
    discardRepositoryProvisionRequest,
    transitionApplication,
    createApplicationDecisionNotifications,
    createRepositoryProvisionEvent,
  };
  const withTransaction = jest.fn(
    async (operation: (s: ApplicationsTransactionStore) => Promise<unknown>) =>
      operation(store),
  );
  const assertActiveStaff = jest
    .fn<ReturnType<AssertActiveStaff>, Parameters<AssertActiveStaff>>()
    .mockResolvedValue({ actorId: ACTOR_ID });
  const repository = {
    withTransaction,
    findRepositoryProvisionEvent: jest.fn(),
    discardRepositoryProvisionRequest: jest.fn().mockResolvedValue(undefined),
  } as unknown as ApplicationsRepository;
  const service = new ApplicationsService(
    repository,
    { record } as unknown as AuditLogService,
    { assertActiveStaff },
  );
  return {
    service,
    record,
    store,
    withTransaction,
    assertActiveStaff,
    transitionApplication,
    createRepositoryProvisionEvent,
    findRepositoryProvisionJob,
    findRepositoryProvisionEvent,
    discardRepositoryProvisionRequest,
    createApplicationDecisionNotifications,
    appendReviewHistory,
  };
}

function expectDomainCode(error: unknown, code: ApplicationsErrorCode): void {
  expect(error).toBeInstanceOf(DomainException);
  if (!(error instanceof DomainException)) {
    throw new Error('DomainException expected');
  }
  expect(error.errorCode.code).toBe(code);
}

describe('ApplicationsService.decide — #547 감사 기록', () => {
  it.each([
    { action: APPLICATION_DECISION_ACTIONS.APPROVE },
    { action: 'UNKNOWN' },
    { action: APPLICATION_DECISION_ACTIONS.REJECT },
    { action: APPLICATION_DECISION_ACTIONS.REJECT, reason: '   ' },
  ])(
    '교직원 권한이 없으면 $action 의미 검증 전에 APP_004로 막는다',
    async (input) => {
      const { service, record, withTransaction, assertActiveStaff } =
        createHarness();
      assertActiveStaff.mockImplementation((_sessionGithubId, forbidden) =>
        Promise.reject(forbidden()),
      );

      let thrown: unknown;
      try {
        await service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, input);
      } catch (error) {
        thrown = error;
      }

      expectDomainCode(thrown, ApplicationsErrorCode.STAFF_ONLY);
      expect(thrown).toMatchObject({ errorCode: { status: 403 } });
      expect(assertActiveStaff).toHaveBeenCalledWith(
        ACTOR_GITHUB_ID,
        expect.any(Function),
      );
      expect(withTransaction).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ action: 'UNKNOWN' }, ApplicationsErrorCode.INVALID_DECISION_ACTION],
    [{ action: 'REJECT' }, ApplicationsErrorCode.REJECTION_REASON_REQUIRED],
    [
      { action: 'REJECT', reason: '   ' },
      ApplicationsErrorCode.REJECTION_REASON_REQUIRED,
    ],
  ] as const)(
    '교직원 권한 확인 뒤 %j의 의미 오류를 유지한다',
    async (input, code) => {
      const { service, withTransaction, assertActiveStaff } = createHarness();

      await expect(
        service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, input),
      ).rejects.toMatchObject({ errorCode: { code, status: 400 } });
      expect(assertActiveStaff).toHaveBeenCalledWith(
        ACTOR_GITHUB_ID,
        expect.any(Function),
      );
      expect(withTransaction).not.toHaveBeenCalled();
    },
  );

  it('승인을 APPLICATION_APPROVED로 기록하고 판정과 같은 트랜잭션 writer를 쓴다', async () => {
    const { service, record, createApplicationDecisionNotifications } =
      createHarness();

    const result = await service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });

    expect(record).toHaveBeenCalledWith(
      {
        actorGithubId: ACTOR_GITHUB_ID,
        action: 'APPLICATION_APPROVED',
        targetType: 'APPLICATION',
        targetId: APPLICATION_ID,
        metadata: {
          schemaVersion: 2,
          programName: '합성 프로그램',
          applicantGithubLogin: 'synthetic-applicant-login',
          before: { status: ApplicationStatus.SUBMITTED },
          after: { status: ApplicationStatus.APPROVED },
        },
      },
      auditLogWriter,
    );
    const approvedNotification =
      createApplicationDecisionNotifications.mock.calls[0]?.[0];
    expect(approvedNotification).toMatchObject({
      applicationId: APPLICATION_ID,
      programId: 'synthetic-program',
      programName: '합성 프로그램',
      recipientUserIds: ['synthetic-applicant'],
      decision: ApplicationStatus.APPROVED,
    });
    expect(approvedNotification?.decidedAt).toBeInstanceOf(Date);

    expect(result).toEqual({
      kind: 'APPROVED',
      applicationId: APPLICATION_ID,
      status: ApplicationStatus.APPROVED,
      repositoryProvisioning: {
        enabled: false,
        eventId: null,
        jobStatus: null,
      },
    });
  });

  it('거절을 APPLICATION_REJECTED로 기록하되 사유 원문은 감사 metadata에 담지 않는다', async () => {
    const { service, record, createApplicationDecisionNotifications } =
      createHarness();

    const result = await service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
      action: APPLICATION_DECISION_ACTIONS.REJECT,
      reason: '제출 서류 누락',
    });

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'APPLICATION_REJECTED',
        metadata: {
          schemaVersion: 2,
          programName: '합성 프로그램',
          applicantGithubLogin: 'synthetic-applicant-login',
          before: { status: ApplicationStatus.SUBMITTED },
          after: { status: ApplicationStatus.REJECTED },
        },
      }),
      auditLogWriter,
    );
    expect(createApplicationDecisionNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: ApplicationStatus.REJECTED,
        recipientUserIds: ['synthetic-applicant'],
      }),
    );

    expect(result).toEqual({
      kind: 'REJECTED',
      applicationId: APPLICATION_ID,
      status: ApplicationStatus.REJECTED,
      rejectionReason: '제출 서류 누락',
    });
  });

  it('감사 기록 인자 어디에도 반려 사유 원문이 실리지 않는다', async () => {
    const { service, record } = createHarness();

    await service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
      action: APPLICATION_DECISION_ACTIONS.REJECT,
      reason: '제출 서류 누락',
    });

    const serialized = JSON.stringify(
      record.mock.calls,
      (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
    );
    expect(serialized).not.toContain('rejectionReason');
    expect(serialized).not.toContain('제출 서류 누락');
  });

  it('이미 판정된 신청은 감사 기록을 남기지 않는다', async () => {
    const { service, record, store, createApplicationDecisionNotifications } =
      createHarness();
    (store.findApplicationById as jest.Mock).mockResolvedValue(
      baseApplication({ status: ApplicationStatus.APPROVED }),
    );

    await expect(
      service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      }),
    ).rejects.toBeDefined();

    expect(record).not.toHaveBeenCalled();
    expect(createApplicationDecisionNotifications).not.toHaveBeenCalled();
  });

  it('전이 CAS에서 밀린 요청은 감사 기록을 남기지 않는다', async () => {
    const {
      service,
      record,
      transitionApplication,
      createApplicationDecisionNotifications,
    } = createHarness();
    transitionApplication.mockResolvedValue(false);

    await expect(
      service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      }),
    ).rejects.toBeDefined();

    expect(record).not.toHaveBeenCalled();
    expect(createApplicationDecisionNotifications).not.toHaveBeenCalled();
  });

  it('OWN이면 입력 URL이 프로비저닝 이벤트에 실린다', async () => {
    const { service, store, createRepositoryProvisionEvent } = createHarness({
      provisioningEnabled: true,
    });
    (store.findApplicationById as jest.Mock).mockResolvedValue(
      baseApplication({
        repositoryProvisioningEnabled: true,
        repositoryConnectionMode: RepositoryConnectionMode.OWN,
        repositoryUrl: 'https://github.com/synthetic-org/synthetic-repo',
      }),
    );

    await service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });

    expect(createRepositoryProvisionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: APPLICATION_ID,
        repositoryConnectionMode: RepositoryConnectionMode.OWN,
        repositoryUrl: 'https://github.com/synthetic-org/synthetic-repo',
      }),
    );
  });
});

describe('ApplicationsService.decide — REVERT', () => {
  it('반려 취소: REJECTED → SUBMITTED 성공하고 APPLICATION_REVERTED를 기록한다', async () => {
    const { service, record, store, transitionApplication } = createHarness();
    (store.findApplicationById as jest.Mock).mockResolvedValue(
      baseApplication({
        status: ApplicationStatus.REJECTED,
        processedById: PRIOR_PROCESSOR_ID,
        processedAt: PRIOR_PROCESSED_AT,
      }),
    );

    const result = await service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
      action: APPLICATION_DECISION_ACTIONS.REVERT,
    });

    expect(result).toEqual({
      kind: 'REVERTED',
      applicationId: APPLICATION_ID,
      status: ApplicationStatus.SUBMITTED,
    });
    expect(transitionApplication).toHaveBeenCalledWith({
      applicationId: APPLICATION_ID,
      expectedStatus: ApplicationStatus.REJECTED,
      nextStatus: ApplicationStatus.SUBMITTED,
      rejectionReason: null,
      processedBy: 'preserve',
    });
    expect(record).toHaveBeenCalledWith(
      {
        actorGithubId: ACTOR_GITHUB_ID,
        action: 'APPLICATION_REVERTED',
        targetType: 'APPLICATION',
        targetId: APPLICATION_ID,
        metadata: {
          schemaVersion: 2,
          programName: '합성 프로그램',
          applicantGithubLogin: 'synthetic-applicant-login',
          before: { status: ApplicationStatus.REJECTED },
          after: { status: ApplicationStatus.SUBMITTED },
        },
      },
      auditLogWriter,
    );
  });

  it('승인 되돌리기(프로비저닝 미완료): APPROVED → SUBMITTED 성공', async () => {
    const {
      service,
      transitionApplication,
      findRepositoryProvisionJob,
      discardRepositoryProvisionRequest,
      store,
    } = createHarness();
    (store.findApplicationById as jest.Mock).mockResolvedValue(
      baseApplication({
        status: ApplicationStatus.APPROVED,
        processedById: PRIOR_PROCESSOR_ID,
        processedAt: PRIOR_PROCESSED_AT,
      }),
    );
    findRepositoryProvisionJob.mockResolvedValue({
      status: RepositoryProvisionJobStatus.PENDING,
      repositoryId: null,
    });

    const result = await service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
      action: APPLICATION_DECISION_ACTIONS.REVERT,
    });

    expect(result).toEqual({
      kind: 'REVERTED',
      applicationId: APPLICATION_ID,
      status: ApplicationStatus.SUBMITTED,
    });
    expect(transitionApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStatus: ApplicationStatus.APPROVED,
        nextStatus: ApplicationStatus.SUBMITTED,
        processedBy: 'preserve',
      }),
    );

    expect(discardRepositoryProvisionRequest).toHaveBeenCalledWith(
      APPLICATION_ID,
      expect.any(Date),
    );
  });

  it('반려 취소도 진행 중 프로비저닝 요청을 지운다', async () => {
    const { service, store, discardRepositoryProvisionRequest } =
      createHarness();
    (store.findApplicationById as jest.Mock).mockResolvedValue(
      baseApplication({ status: ApplicationStatus.REJECTED }),
    );

    await service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
      action: APPLICATION_DECISION_ACTIONS.REVERT,
    });

    expect(discardRepositoryProvisionRequest).toHaveBeenCalledWith(
      APPLICATION_ID,
      expect.any(Date),
    );
  });

  it.each([
    RepositoryProvisionJobStatus.SUCCEEDED,
    RepositoryProvisionJobStatus.PENDING,
    RepositoryProvisionJobStatus.PROCESSING,
    RepositoryProvisionJobStatus.FAILED_RETRYABLE,
    RepositoryProvisionJobStatus.FAILED_FINAL,
  ])(
    '생성된 저장소가 있어도 %s에서 되돌리기가 통과하고 완료된 요청은 보존한다',
    async (status) => {
      const {
        service,
        record,
        store,
        transitionApplication,
        discardRepositoryProvisionRequest,
        findRepositoryProvisionJob,
      } = createHarness();
      (store.findApplicationById as jest.Mock).mockResolvedValue(
        baseApplication({ status: ApplicationStatus.APPROVED }),
      );
      findRepositoryProvisionJob.mockResolvedValue({
        status,
        repositoryId: 'synthetic-repository',
      });

      const result = await service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
        action: APPLICATION_DECISION_ACTIONS.REVERT,
      });

      expect(result).toMatchObject({
        kind: 'REVERTED',
        status: ApplicationStatus.SUBMITTED,
      });
      expect(transitionApplication).toHaveBeenCalled();
      expect(record).toHaveBeenCalled();
      expect(discardRepositoryProvisionRequest).not.toHaveBeenCalled();
    },
  );

  it('미완료 프로비저닝은 되돌리기가 여전히 거둔다', async () => {
    const {
      service,
      store,
      discardRepositoryProvisionRequest,
      findRepositoryProvisionJob,
    } = createHarness();
    (store.findApplicationById as jest.Mock).mockResolvedValue(
      baseApplication({ status: ApplicationStatus.APPROVED }),
    );
    findRepositoryProvisionJob.mockResolvedValue({
      status: RepositoryProvisionJobStatus.PENDING,
      repositoryId: null,
    });

    await service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
      action: APPLICATION_DECISION_ACTIONS.REVERT,
    });

    expect(discardRepositoryProvisionRequest).toHaveBeenCalledWith(
      APPLICATION_ID,
      expect.any(Date),
    );
  });

  it('SUBMITTED에 REVERT를 시도하면 APPLICATION_REVERT_INVALID_STATUS', async () => {
    const { service, record } = createHarness();

    let thrown: unknown;
    try {
      await service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
        action: APPLICATION_DECISION_ACTIONS.REVERT,
      });
    } catch (error) {
      thrown = error;
    }

    expectDomainCode(
      thrown,
      ApplicationsErrorCode.APPLICATION_REVERT_INVALID_STATUS,
    );
    expect(record).not.toHaveBeenCalled();
  });

  it('되돌리기 후 재승인: 남은 요청을 지우고 이벤트를 새로 발행한다', async () => {
    const {
      service,
      store,
      createRepositoryProvisionEvent,
      findRepositoryProvisionEvent,
      findRepositoryProvisionJob,
      discardRepositoryProvisionRequest,
    } = createHarness({ provisioningEnabled: true });

    (store.findApplicationById as jest.Mock).mockResolvedValue(
      baseApplication({
        status: ApplicationStatus.APPROVED,
        repositoryProvisioningEnabled: true,
        processedById: PRIOR_PROCESSOR_ID,
        processedAt: PRIOR_PROCESSED_AT,
      }),
    );
    findRepositoryProvisionJob.mockResolvedValue({
      status: RepositoryProvisionJobStatus.PENDING,
      repositoryId: null,
    });

    await service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
      action: APPLICATION_DECISION_ACTIONS.REVERT,
    });

    (store.findApplicationById as jest.Mock).mockResolvedValue(
      baseApplication({
        status: ApplicationStatus.SUBMITTED,
        repositoryProvisioningEnabled: true,
        processedById: PRIOR_PROCESSOR_ID,
        processedAt: PRIOR_PROCESSED_AT,
      }),
    );
    findRepositoryProvisionEvent.mockResolvedValue({
      id: 'existing-provision-event',
    });
    findRepositoryProvisionJob.mockResolvedValue({
      status: RepositoryProvisionJobStatus.PENDING,
      repositoryId: null,
    });

    const reapprove = await service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });

    expect(discardRepositoryProvisionRequest).toHaveBeenCalledTimes(2);
    expect(createRepositoryProvisionEvent).toHaveBeenCalledTimes(1);
    expect(reapprove).toMatchObject({
      kind: 'APPROVED',
      applicationId: APPLICATION_ID,
      status: ApplicationStatus.APPROVED,
      repositoryProvisioning: { enabled: true },
    });
  });

  it('OWN + repositoryUrl 없음 승인: 400 OWN_REPOSITORY_URL_REQUIRED', async () => {
    const { service, record, store } = createHarness({
      provisioningEnabled: true,
    });
    (store.findApplicationById as jest.Mock).mockResolvedValue(
      baseApplication({
        repositoryProvisioningEnabled: true,
        repositoryConnectionMode: RepositoryConnectionMode.OWN,
        repositoryUrl: null,
      }),
    );

    let thrown: unknown;
    try {
      await service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      });
    } catch (error) {
      thrown = error;
    }

    expectDomainCode(thrown, ApplicationsErrorCode.OWN_REPOSITORY_URL_REQUIRED);
    expect(record).not.toHaveBeenCalled();
  });

  it('되돌리기 시 processedBy를 preserve로 넘겨 감사 추적을 보존한다', async () => {
    const { service, transitionApplication, store } = createHarness();
    (store.findApplicationById as jest.Mock).mockResolvedValue(
      baseApplication({
        status: ApplicationStatus.REJECTED,
        processedById: PRIOR_PROCESSOR_ID,
        processedAt: PRIOR_PROCESSED_AT,
      }),
    );

    await service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
      action: APPLICATION_DECISION_ACTIONS.REVERT,
    });

    expect(transitionApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        processedBy: 'preserve',
      }),
    );

    const transitionCalls = transitionApplication.mock
      .calls as readonly (readonly unknown[])[];
    const firstTransition: unknown = transitionCalls[0]?.[0];
    expect(firstTransition).not.toEqual(
      expect.objectContaining({
        processedBy: expect.objectContaining({ id: ACTOR_ID }) as unknown,
      }),
    );
  });

  it('FAILED_RETRYABLE 프로비저닝은 미완료로 보고 승인 되돌리기를 허용한다', async () => {
    const { service, findRepositoryProvisionJob, store } = createHarness();
    (store.findApplicationById as jest.Mock).mockResolvedValue(
      baseApplication({ status: ApplicationStatus.APPROVED }),
    );
    findRepositoryProvisionJob.mockResolvedValue({
      status: RepositoryProvisionJobStatus.FAILED_RETRYABLE,
      repositoryId: null,
    });

    await expect(
      service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
        action: APPLICATION_DECISION_ACTIONS.REVERT,
      }),
    ).resolves.toMatchObject({
      kind: 'REVERTED',
      status: ApplicationStatus.SUBMITTED,
    });
  });

  it('OWN은 프로비저닝 SUCCEEDED여도 되돌리기를 허용하고 완료된 연결을 보존한다', async () => {
    const {
      service,
      findRepositoryProvisionJob,
      discardRepositoryProvisionRequest,
      store,
    } = createHarness();
    (store.findApplicationById as jest.Mock).mockResolvedValue(
      baseApplication({
        status: ApplicationStatus.APPROVED,
        repositoryConnectionMode: RepositoryConnectionMode.OWN,
        repositoryUrl: 'https://github.com/synthetic-org/synthetic-repo',
      }),
    );
    findRepositoryProvisionJob.mockResolvedValue({
      status: RepositoryProvisionJobStatus.SUCCEEDED,
      repositoryId: 'synthetic-repository',
    });

    await expect(
      service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
        action: APPLICATION_DECISION_ACTIONS.REVERT,
      }),
    ).resolves.toMatchObject({
      kind: 'REVERTED',
      status: ApplicationStatus.SUBMITTED,
    });

    expect(findRepositoryProvisionJob).toHaveBeenCalledWith(APPLICATION_ID);
    expect(discardRepositoryProvisionRequest).not.toHaveBeenCalled();
  });
});

describe('ApplicationsService.decide — #1272 반대 판정 직행', () => {
  it('APPROVED → REJECT: 기대 상태 APPROVED로 한 번에 전이하고 반려로 기록한다', async () => {
    const {
      service,
      record,
      store,
      transitionApplication,
      discardRepositoryProvisionRequest,
      findRepositoryProvisionJob,
      createApplicationDecisionNotifications,
    } = createHarness({ provisioningEnabled: true });
    (store.findApplicationById as jest.Mock).mockResolvedValue(
      baseApplication({
        status: ApplicationStatus.APPROVED,
        repositoryProvisioningEnabled: true,
        processedById: PRIOR_PROCESSOR_ID,
        processedAt: PRIOR_PROCESSED_AT,
      }),
    );
    findRepositoryProvisionJob.mockResolvedValue({
      status: RepositoryProvisionJobStatus.PENDING,
      repositoryId: null,
    });

    const result = await service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
      action: APPLICATION_DECISION_ACTIONS.REJECT,
      reason: '합성 반려 사유',
    });

    expect(result).toEqual({
      kind: 'REJECTED',
      applicationId: APPLICATION_ID,
      status: ApplicationStatus.REJECTED,
      rejectionReason: '합성 반려 사유',
    });

    expect(transitionApplication).toHaveBeenCalledTimes(1);
    expect(transitionApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: APPLICATION_ID,
        expectedStatus: ApplicationStatus.APPROVED,
        nextStatus: ApplicationStatus.REJECTED,
        rejectionReason: '합성 반려 사유',
      }),
    );

    const rejectTransition = (
      transitionApplication.mock.calls as readonly (readonly unknown[])[]
    )[0]?.[0];
    expect(rejectTransition).toEqual(
      expect.objectContaining({
        processedBy: expect.objectContaining({ id: ACTOR_ID }) as unknown,
      }),
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'APPLICATION_REJECTED',
        metadata: expect.objectContaining({
          before: { status: ApplicationStatus.APPROVED },
          after: { status: ApplicationStatus.REJECTED },
        }) as unknown,
      }),
      auditLogWriter,
    );
    expect(createApplicationDecisionNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ decision: ApplicationStatus.REJECTED }),
    );

    expect(discardRepositoryProvisionRequest).toHaveBeenCalledWith(
      APPLICATION_ID,
      expect.any(Date),
    );
  });

  it('REJECTED → APPROVE: 한 번에 전이하고 새 프로비저닝 이벤트를 발행한다', async () => {
    const {
      service,
      record,
      store,
      transitionApplication,
      discardRepositoryProvisionRequest,
      createRepositoryProvisionEvent,
    } = createHarness({ provisioningEnabled: true });
    (store.findApplicationById as jest.Mock).mockResolvedValue(
      baseApplication({
        status: ApplicationStatus.REJECTED,
        repositoryProvisioningEnabled: true,
        processedById: PRIOR_PROCESSOR_ID,
        processedAt: PRIOR_PROCESSED_AT,
      }),
    );

    const result = await service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
      action: APPLICATION_DECISION_ACTIONS.APPROVE,
    });

    expect(result).toMatchObject({
      kind: 'APPROVED',
      status: ApplicationStatus.APPROVED,
      repositoryProvisioning: {
        enabled: true,
        eventId: 'synthetic-event',
        jobStatus: RepositoryProvisionJobStatus.PENDING,
      },
    });
    expect(transitionApplication).toHaveBeenCalledTimes(1);
    expect(transitionApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStatus: ApplicationStatus.REJECTED,
        nextStatus: ApplicationStatus.APPROVED,
      }),
    );

    expect(discardRepositoryProvisionRequest).toHaveBeenCalledWith(
      APPLICATION_ID,
      expect.any(Date),
    );
    expect(createRepositoryProvisionEvent).toHaveBeenCalledTimes(1);
    expect(createRepositoryProvisionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: APPLICATION_ID,
        idempotencyKey: `repository-provision:${APPLICATION_ID}`,
      }),
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'APPLICATION_APPROVED',
        metadata: expect.objectContaining({
          before: { status: ApplicationStatus.REJECTED },
          after: { status: ApplicationStatus.APPROVED },
        }) as unknown,
      }),
      auditLogWriter,
    );
  });

  it('같은 판정 재전송(REJECTED에 REJECT)은 그대로 409다', async () => {
    const { service, record, store, transitionApplication } = createHarness();
    (store.findApplicationById as jest.Mock).mockResolvedValue(
      baseApplication({ status: ApplicationStatus.REJECTED }),
    );

    let thrown: unknown;
    try {
      await service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
        action: APPLICATION_DECISION_ACTIONS.REJECT,
        reason: '합성 반려 사유',
      });
    } catch (error) {
      thrown = error;
    }

    expectDomainCode(thrown, ApplicationsErrorCode.APPLICATION_ALREADY_DECIDED);
    if (thrown instanceof DomainException) {
      expect(thrown.errorCode.status).toBe(409);
      expect(thrown.extensions).toEqual(
        expect.objectContaining({
          latestStatus: ApplicationStatus.REJECTED,
        }),
      );
    }
    expect(transitionApplication).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it.each([
    RepositoryProvisionJobStatus.SUCCEEDED,
    RepositoryProvisionJobStatus.PENDING,
    RepositoryProvisionJobStatus.PROCESSING,
    RepositoryProvisionJobStatus.FAILED_RETRYABLE,
    RepositoryProvisionJobStatus.FAILED_FINAL,
  ])(
    '생성된 NEW 저장소가 있어도 %s에서 반려가 통과하고 완료된 요청은 보존한다',
    async (status) => {
      const {
        service,
        record,
        store,
        transitionApplication,
        discardRepositoryProvisionRequest,
        findRepositoryProvisionJob,
      } = createHarness({ provisioningEnabled: true });
      (store.findApplicationById as jest.Mock).mockResolvedValue(
        baseApplication({
          status: ApplicationStatus.APPROVED,
          repositoryProvisioningEnabled: true,
        }),
      );
      findRepositoryProvisionJob.mockResolvedValue({
        status,
        repositoryId: 'synthetic-repository',
      });

      const result = await service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
        action: APPLICATION_DECISION_ACTIONS.REJECT,
        reason: '합성 반려 사유',
      });

      expect(result).toMatchObject({
        kind: 'REJECTED',
        status: ApplicationStatus.REJECTED,
      });
      expect(transitionApplication).toHaveBeenCalled();
      expect(record).toHaveBeenCalled();
      expect(discardRepositoryProvisionRequest).not.toHaveBeenCalled();
    },
  );

  it('미완료 NEW 프로비저닝은 승인→반려에서 여전히 거둔다', async () => {
    const {
      service,
      store,
      discardRepositoryProvisionRequest,
      findRepositoryProvisionJob,
    } = createHarness({ provisioningEnabled: true });
    (store.findApplicationById as jest.Mock).mockResolvedValue(
      baseApplication({
        status: ApplicationStatus.APPROVED,
        repositoryProvisioningEnabled: true,
      }),
    );
    findRepositoryProvisionJob.mockResolvedValue({
      status: RepositoryProvisionJobStatus.PROCESSING,
      repositoryId: null,
    });

    await service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
      action: APPLICATION_DECISION_ACTIONS.REJECT,
      reason: '합성 반려 사유',
    });

    expect(discardRepositoryProvisionRequest).toHaveBeenCalledWith(
      APPLICATION_ID,
      expect.any(Date),
    );
  });

  it('OWN은 SUCCEEDED여도 승인→반려를 허용하고 완료된 연결을 보존한다', async () => {
    const {
      service,
      findRepositoryProvisionJob,
      discardRepositoryProvisionRequest,
      store,
    } = createHarness({
      provisioningEnabled: true,
    });
    (store.findApplicationById as jest.Mock).mockResolvedValue(
      baseApplication({
        status: ApplicationStatus.APPROVED,
        repositoryProvisioningEnabled: true,
        repositoryConnectionMode: RepositoryConnectionMode.OWN,
        repositoryUrl: 'https://github.com/synthetic-org/synthetic-repo',
      }),
    );
    findRepositoryProvisionJob.mockResolvedValue({
      status: RepositoryProvisionJobStatus.SUCCEEDED,
      repositoryId: 'synthetic-repository',
    });

    await expect(
      service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
        action: APPLICATION_DECISION_ACTIONS.REJECT,
        reason: '합성 반려 사유',
      }),
    ).resolves.toMatchObject({
      kind: 'REJECTED',
      status: ApplicationStatus.REJECTED,
    });

    expect(findRepositoryProvisionJob).toHaveBeenCalledWith(APPLICATION_ID);
    expect(discardRepositoryProvisionRequest).not.toHaveBeenCalled();
  });

  it('경합으로 APPROVED가 이미 밀렸으면 CAS가 판정을 거절한다', async () => {
    const { service, record, store, transitionApplication } = createHarness();
    (store.findApplicationById as jest.Mock)
      .mockResolvedValueOnce(
        baseApplication({ status: ApplicationStatus.APPROVED }),
      )

      .mockResolvedValueOnce(
        baseApplication({ status: ApplicationStatus.REJECTED }),
      );
    transitionApplication.mockResolvedValue(false);

    let thrown: unknown;
    try {
      await service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
        action: APPLICATION_DECISION_ACTIONS.REJECT,
        reason: '합성 반려 사유',
      });
    } catch (error) {
      thrown = error;
    }

    expectDomainCode(thrown, ApplicationsErrorCode.APPLICATION_ALREADY_DECIDED);
    if (thrown instanceof DomainException) {
      expect(thrown.extensions).toEqual(
        expect.objectContaining({
          latestStatus: ApplicationStatus.REJECTED,
        }),
      );
    }
    expect(record).not.toHaveBeenCalled();
  });
});

describe('ApplicationsService.decide — 판정 이력과 알림', () => {
  it.each([
    [
      APPLICATION_DECISION_ACTIONS.APPROVE,
      ApplicationStatus.SUBMITTED,
      'APPROVED',
      null,
    ],
    [
      APPLICATION_DECISION_ACTIONS.REVERT,
      ApplicationStatus.APPROVED,
      'REVERTED',
      null,
    ],
  ] as const)(
    '%s 판정은 %s에서 %s 이력을 상태 변경과 같은 store로 남긴다',
    async (action, from, eventKind, rejectionReason) => {
      const { service, store, appendReviewHistory } = createHarness();
      (store.findApplicationById as jest.Mock).mockResolvedValue(
        baseApplication({ status: from }),
      );

      await service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
        action,
      });

      expect(appendReviewHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          applicationId: APPLICATION_ID,
          eventKind,
          actorId: ACTOR_ID,
          rejectionReason,
        }),
      );

      expect(appendReviewHistory.mock.calls[0]?.[0].occurredAt).toBeInstanceOf(
        Date,
      );
    },
  );

  it('반려는 사유를 이력에 함께 남긴다 — 다음 판정이 덮어써도 그때의 지적이 남는다', async () => {
    const { service, appendReviewHistory } = createHarness();

    await service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
      action: APPLICATION_DECISION_ACTIONS.REJECT,
      reason: '서류가 비었습니다',
    });

    expect(appendReviewHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: 'REJECTED',
        rejectionReason: '서류가 비었습니다',
      }),
    );
  });

  it('되돌림도 학생에게 알린다 — 승인이 풀린 사실을 화면을 다시 열기 전에 알아야 한다', async () => {
    const { service, store, createApplicationDecisionNotifications } =
      createHarness();
    (store.findApplicationById as jest.Mock).mockResolvedValue(
      baseApplication({ status: ApplicationStatus.APPROVED }),
    );

    await service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
      action: APPLICATION_DECISION_ACTIONS.REVERT,
    });

    expect(createApplicationDecisionNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: APPLICATION_ID,
        decision: ApplicationStatus.SUBMITTED,
      }),
    );
  });

  it('CAS가 밀린 요청은 이력도 알림도 남기지 않는다', async () => {
    const {
      service,
      store,
      transitionApplication,
      appendReviewHistory,
      createApplicationDecisionNotifications,
    } = createHarness();
    transitionApplication.mockResolvedValue(false);
    (store.findApplicationById as jest.Mock)
      .mockResolvedValueOnce(
        baseApplication({ status: ApplicationStatus.SUBMITTED }),
      )
      .mockResolvedValueOnce(
        baseApplication({ status: ApplicationStatus.APPROVED }),
      );

    let thrown: unknown;
    try {
      await service.decide(ACTOR_GITHUB_ID, APPLICATION_ID, {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      });
    } catch (error) {
      thrown = error;
    }

    expectDomainCode(thrown, ApplicationsErrorCode.APPLICATION_ALREADY_DECIDED);
    expect(appendReviewHistory).not.toHaveBeenCalled();
    expect(createApplicationDecisionNotifications).not.toHaveBeenCalled();
  });
});
