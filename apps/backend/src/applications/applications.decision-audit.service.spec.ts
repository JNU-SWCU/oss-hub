import {
  ApplicationStatus,
  RepositoryConnectionMode,
  RepositoryProvisionJobStatus,
} from '@prisma/client';
import type { AuditLogService } from '../audit-log/audit-log.service';
import { DomainException } from '../common/error-code';
import { APPLICATION_DECISION_ACTIONS } from './domain/application-decision';
import type {
  ApplicationsRepository,
  ApplicationsTransactionStore,
} from './applications.repository';
import { ApplicationsErrorCode } from './applications-error-code.enum';
import { ApplicationsService } from './applications.service';

/**
 * #547 — STAFF 승인·거절에 typed audit 기록이 없었다. 판정 전이와 같은 트랜잭션에서
 * 기록되는지, 그리고 기존 응답 계약이 그대로인지를 고정한다.
 * REVERT 경로(반려 취소·미완료 승인 되돌리기·완료 잠금·재승인 멱등)도 여기서 고정한다.
 */
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
    teamId: null,
    status: overrides.status ?? ApplicationStatus.SUBMITTED,
    collaboratorGithubLogins: [] as string[],
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
  const store: ApplicationsTransactionStore = {
    auditLogWriter,
    findApplicationById: jest.fn().mockResolvedValue(
      baseApplication({
        repositoryProvisioningEnabled: options.provisioningEnabled,
      }),
    ),
    findRepositoryProvisionJob,
    findRepositoryProvisionEvent,
    discardRepositoryProvisionRequest,
    transitionApplication,
    createRepositoryProvisionEvent,
  };
  const repository = {
    withTransaction: jest.fn(
      async (
        operation: (s: ApplicationsTransactionStore) => Promise<unknown>,
      ) => operation(store),
    ),
    findRepositoryProvisionEvent: jest.fn(),
    discardRepositoryProvisionRequest: jest.fn().mockResolvedValue(undefined),
  } as unknown as ApplicationsRepository;
  const service = new ApplicationsService(repository, {
    record,
  } as unknown as AuditLogService);
  return {
    service,
    record,
    store,
    transitionApplication,
    createRepositoryProvisionEvent,
    findRepositoryProvisionJob,
    findRepositoryProvisionEvent,
    discardRepositoryProvisionRequest,
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
  it('승인을 APPLICATION_APPROVED로 기록하고 판정과 같은 트랜잭션 writer를 쓴다', async () => {
    const { service, record } = createHarness();

    const result = await service.decide(
      ACTOR_ID,
      APPLICATION_ID,
      ACTOR_GITHUB_ID,
      { action: APPLICATION_DECISION_ACTIONS.APPROVE },
    );

    expect(record).toHaveBeenCalledWith(
      {
        actorGithubId: ACTOR_GITHUB_ID,
        action: 'APPLICATION_APPROVED',
        targetType: 'APPLICATION',
        targetId: APPLICATION_ID,
        metadata: {
          schemaVersion: 1,
          before: { status: ApplicationStatus.SUBMITTED },
          after: { status: ApplicationStatus.APPROVED },
        },
      },
      auditLogWriter,
    );
    // 기존 응답 계약은 바뀌지 않는다.
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
    const { service, record } = createHarness();

    const result = await service.decide(
      ACTOR_ID,
      APPLICATION_ID,
      ACTOR_GITHUB_ID,
      {
        action: APPLICATION_DECISION_ACTIONS.REJECT,
        reason: '제출 서류 누락',
      },
    );

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'APPLICATION_REJECTED',
        metadata: {
          schemaVersion: 1,
          before: { status: ApplicationStatus.SUBMITTED },
          after: { status: ApplicationStatus.REJECTED },
        },
      }),
      auditLogWriter,
    );
    // 응답 계약은 그대로다 — 사유는 응답과 `Application` 테이블에만 남는다.
    expect(result).toEqual({
      kind: 'REJECTED',
      applicationId: APPLICATION_ID,
      status: ApplicationStatus.REJECTED,
      rejectionReason: '제출 서류 누락',
    });
  });

  // 회귀 방지: 반려 사유 원문이 감사 기록 인자 어디로도 새어 나가면 안 된다.
  // `GET /audit-logs`는 metadata JSON을 필드 선별 없이 그대로 실어 보내고(#621),
  // `AuditLog`는 append-only 트리거로 UPDATE·DELETE가 막혀 있어 한 번 쓴 개인정보는
  // 지울 수 없다. 노출 계약 통합 테스트(public-exposure-persona.http)가 잡는 것과
  // 같은 누출을 DB 없이 여기서 먼저 잡는다.
  it('감사 기록 인자 어디에도 반려 사유 원문이 실리지 않는다', async () => {
    const { service, record } = createHarness();

    await service.decide(ACTOR_ID, APPLICATION_ID, ACTOR_GITHUB_ID, {
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
    const { service, record, store } = createHarness();
    (store.findApplicationById as jest.Mock).mockResolvedValue(
      baseApplication({ status: ApplicationStatus.APPROVED }),
    );

    await expect(
      service.decide(ACTOR_ID, APPLICATION_ID, ACTOR_GITHUB_ID, {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      }),
    ).rejects.toBeDefined();

    expect(record).not.toHaveBeenCalled();
  });

  it('전이 CAS에서 밀린 요청은 감사 기록을 남기지 않는다', async () => {
    const { service, record, transitionApplication } = createHarness();
    transitionApplication.mockResolvedValue(false);

    await expect(
      service.decide(ACTOR_ID, APPLICATION_ID, ACTOR_GITHUB_ID, {
        action: APPLICATION_DECISION_ACTIONS.APPROVE,
      }),
    ).rejects.toBeDefined();

    expect(record).not.toHaveBeenCalled();
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

    await service.decide(ACTOR_ID, APPLICATION_ID, ACTOR_GITHUB_ID, {
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

    const result = await service.decide(
      ACTOR_ID,
      APPLICATION_ID,
      ACTOR_GITHUB_ID,
      { action: APPLICATION_DECISION_ACTIONS.REVERT },
    );

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
          schemaVersion: 1,
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

    const result = await service.decide(
      ACTOR_ID,
      APPLICATION_ID,
      ACTOR_GITHUB_ID,
      { action: APPLICATION_DECISION_ACTIONS.REVERT },
    );

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
    // 되돌리기는 진행 중이던 프로비저닝 요청도 지운다. 남겨 두면 워커가 집어 간 job이
    // FAILED_FINAL이 되고, 재승인은 기존 이벤트를 재사용해 새 job을 만들지 않아
    // 저장소가 영영 만들어지지 않는다.
    expect(discardRepositoryProvisionRequest).toHaveBeenCalledWith(
      APPLICATION_ID,
    );
  });

  it('반려 취소도 진행 중 프로비저닝 요청을 지운다', async () => {
    const { service, store, discardRepositoryProvisionRequest } =
      createHarness();
    (store.findApplicationById as jest.Mock).mockResolvedValue(
      baseApplication({ status: ApplicationStatus.REJECTED }),
    );

    await service.decide(ACTOR_ID, APPLICATION_ID, ACTOR_GITHUB_ID, {
      action: APPLICATION_DECISION_ACTIONS.REVERT,
    });

    expect(discardRepositoryProvisionRequest).toHaveBeenCalledWith(
      APPLICATION_ID,
    );
  });

  it('승인 되돌리기(프로비저닝 완료): 409 + revertBlockedReason', async () => {
    const { service, record, findRepositoryProvisionJob, store } =
      createHarness();
    (store.findApplicationById as jest.Mock).mockResolvedValue(
      baseApplication({ status: ApplicationStatus.APPROVED }),
    );
    findRepositoryProvisionJob.mockResolvedValue({
      status: RepositoryProvisionJobStatus.SUCCEEDED,
      repositoryId: 'synthetic-repository',
    });

    let thrown: unknown;
    try {
      await service.decide(ACTOR_ID, APPLICATION_ID, ACTOR_GITHUB_ID, {
        action: APPLICATION_DECISION_ACTIONS.REVERT,
      });
    } catch (error) {
      thrown = error;
    }

    expectDomainCode(thrown, ApplicationsErrorCode.APPLICATION_REVERT_BLOCKED);
    expect(thrown).toBeInstanceOf(DomainException);
    if (thrown instanceof DomainException) {
      expect(thrown.errorCode.status).toBe(409);
      expect(thrown.extensions).toEqual(
        expect.objectContaining({
          latestStatus: ApplicationStatus.APPROVED,
          revertBlockedReason: expect.stringContaining('succeeded') as unknown,
        }),
      );
    }
    expect(record).not.toHaveBeenCalled();
  });

  it('SUBMITTED에 REVERT를 시도하면 APPLICATION_REVERT_INVALID_STATUS', async () => {
    const { service, record } = createHarness();

    let thrown: unknown;
    try {
      await service.decide(ACTOR_ID, APPLICATION_ID, ACTOR_GITHUB_ID, {
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

  it('되돌리기 후 재승인: 성공하고 저장소 프로비저닝 이벤트를 재생성하지 않는다', async () => {
    const {
      service,
      store,
      createRepositoryProvisionEvent,
      findRepositoryProvisionEvent,
      findRepositoryProvisionJob,
    } = createHarness({ provisioningEnabled: true });

    // 1) APPROVED + PENDING job → REVERT
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

    await service.decide(ACTOR_ID, APPLICATION_ID, ACTOR_GITHUB_ID, {
      action: APPLICATION_DECISION_ACTIONS.REVERT,
    });

    // 2) SUBMITTED 재승인 — 기존 outbox 이벤트 재사용
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

    const reapprove = await service.decide(
      ACTOR_ID,
      APPLICATION_ID,
      ACTOR_GITHUB_ID,
      { action: APPLICATION_DECISION_ACTIONS.APPROVE },
    );

    expect(createRepositoryProvisionEvent).not.toHaveBeenCalled();
    expect(reapprove).toEqual({
      kind: 'APPROVED',
      applicationId: APPLICATION_ID,
      status: ApplicationStatus.APPROVED,
      repositoryProvisioning: {
        enabled: true,
        eventId: 'existing-provision-event',
        jobStatus: RepositoryProvisionJobStatus.PENDING,
      },
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
      await service.decide(ACTOR_ID, APPLICATION_ID, ACTOR_GITHUB_ID, {
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

    await service.decide(ACTOR_ID, APPLICATION_ID, ACTOR_GITHUB_ID, {
      action: APPLICATION_DECISION_ACTIONS.REVERT,
    });

    expect(transitionApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        processedBy: 'preserve',
      }),
    );
    // 새 actor id가 processedBy로 실리지 않는다.
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
      service.decide(ACTOR_ID, APPLICATION_ID, ACTOR_GITHUB_ID, {
        action: APPLICATION_DECISION_ACTIONS.REVERT,
      }),
    ).resolves.toMatchObject({
      kind: 'REVERTED',
      status: ApplicationStatus.SUBMITTED,
    });
  });
});
