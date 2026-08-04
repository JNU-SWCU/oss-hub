import { ApplicationStatus } from '@prisma/client';
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
  return { service, record, store, transitionApplication };
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
          rejectionReason: null,
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

  it('거절을 APPLICATION_REJECTED로 기록하고 사유를 함께 남긴다', async () => {
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
          rejectionReason: '제출 서류 누락',
        },
      }),
      auditLogWriter,
    );
    expect(result).toEqual({
      kind: 'REJECTED',
      applicationId: APPLICATION_ID,
      status: ApplicationStatus.REJECTED,
      rejectionReason: '제출 서류 누락',
    });
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
});
