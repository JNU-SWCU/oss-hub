import { ApplicationStatus, RepositoryConnectionMode } from '@prisma/client';
import type { AuditLogService } from '../audit-log/audit-log.service';
import { APPLICATION_DECISION_ACTIONS } from './domain/application-decision';
import type {
  ApplicationsRepository,
  ApplicationsTransactionStore,
} from './applications.repository';
import { ApplicationsService } from './applications.service';

/**
 * #547 — STAFF 승인·거절에 typed audit 기록이 없었다. 판정 전이와 같은 트랜잭션에서
 * 기록되는지, 그리고 기존 응답 계약이 그대로인지를 고정한다.
 */
const APPLICATION_ID = 'synthetic-application';
const ACTOR_ID = 'synthetic-actor';
const ACTOR_GITHUB_ID = 4242n;

const auditLogWriter = {
  auditLog: {},
} as ApplicationsTransactionStore['auditLogWriter'];

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
  const store: ApplicationsTransactionStore = {
    auditLogWriter,
    findApplicationById: jest.fn().mockResolvedValue({
      id: APPLICATION_ID,
      programId: 'synthetic-program',
      teamId: null,
      status: ApplicationStatus.SUBMITTED,
      collaboratorGithubLogins: [],
      repositoryProvisioningEnabled: options.provisioningEnabled,
      repositoryConnectionMode: RepositoryConnectionMode.NEW,
      repositoryUrl: null,
    }),
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
  };
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
    (store.findApplicationById as jest.Mock).mockResolvedValue({
      id: APPLICATION_ID,
      programId: 'synthetic-program',
      teamId: null,
      status: ApplicationStatus.APPROVED,
      collaboratorGithubLogins: [],
      repositoryProvisioningEnabled: false,
      repositoryConnectionMode: RepositoryConnectionMode.NEW,
      repositoryUrl: null,
    });

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
    (store.findApplicationById as jest.Mock).mockResolvedValue({
      id: APPLICATION_ID,
      programId: 'synthetic-program',
      teamId: null,
      status: ApplicationStatus.SUBMITTED,
      collaboratorGithubLogins: ['synthetic-login'],
      repositoryProvisioningEnabled: true,
      repositoryConnectionMode: RepositoryConnectionMode.OWN,
      repositoryUrl: 'https://github.com/synthetic-org/synthetic-repo',
    });

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
