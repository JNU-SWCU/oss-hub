import {
  ApplicationStatus,
  OutboxEventStatus,
  Prisma,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
} from '@prisma/client';
import { ApplicationsRepository } from '../repository/applications.repository';
import { ApplicationsErrorCode } from '../domain/applications-error-code.enum';
import { ApplicationsService } from './applications.service';
import type { AuditLogService } from '../../audit-log/service/audit-log.service';
import type { UsersAuthorityService } from '../../users/service/authority.service';
import { ApplicationJoinCodeService } from './application-join-code.service';

const noopAuditLog = { record: jest.fn() } as unknown as AuditLogService;

const APPLICATION_ID = 'synthetic-application';
const SESSION_GITHUB_ID = 4_242n;
const STAFF_ACTOR_ID = 'synthetic-staff';
const SUBMITTED_AT = new Date('2026-08-05T05:32:00.000Z');
const UPDATED_AT = new Date('2026-08-06T01:00:00.000Z');

type AssertActiveStaff = UsersAuthorityService['assertActiveStaff'];
type AuthorityMock = jest.Mock<
  ReturnType<AssertActiveStaff>,
  Parameters<AssertActiveStaff>
>;

function allowStaff(): AuthorityMock {
  return jest
    .fn<ReturnType<AssertActiveStaff>, Parameters<AssertActiveStaff>>()
    .mockResolvedValue({ actorId: STAFF_ACTOR_ID });
}

function denyStaff(): AuthorityMock {
  return jest.fn<ReturnType<AssertActiveStaff>, Parameters<AssertActiveStaff>>(
    (_sessionGithubId, forbidden) => Promise.reject(forbidden()),
  );
}

const LIST_QUERY = {
  page: 1,
  pageSize: 20,
  search: '',
  status: 'all',
  view: 'default',
} as const;

function applicationRow(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: APPLICATION_ID,
    status: ApplicationStatus.SUBMITTED,
    submittedAt: SUBMITTED_AT,
    updatedAt: UPDATED_AT,
    rejectionReason: null,
    teamId: 'synthetic-team',
    answers: {
      applicantName: '신청자',
      title: '제목',
      summary: '지원 동기와 계획',
    },
    isRepositoryPublicationPlanned: true,
    repository: null,
    program: { repositoryProvisioningEnabled: true },
    applicant: { id: 'synthetic-applicant', name: null, nickname: 'applicant' },
    team: { id: 'synthetic-team', name: '합성 팀', _count: { members: 3 } },
    ...overrides,
  };
}

function readSelect(spy: jest.Mock): Record<string, unknown> {
  const calls = spy.mock.calls as unknown as {
    select: Record<string, unknown>;
  }[][];
  const args = calls[0]?.[0];
  if (args === undefined) {
    throw new Error('조회가 호출되지 않았다');
  }
  return args.select;
}

function buildRepository(transaction: Record<string, unknown>): {
  readonly repository: ApplicationsRepository;
  readonly $transaction: jest.Mock;
} {
  const $transaction = jest
    .fn()
    .mockImplementation(
      (operation: (client: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    );
  const repository = new ApplicationsRepository({ $transaction } as never);
  return { repository, $transaction };
}

function detailTransaction(
  row: Record<string, unknown> | null,
  outbox: { status: OutboxEventStatus; createdAt: Date } | null = null,
  job: {
    status: RepositoryProvisionJobStatus;
    updatedAt: Date;
    lastErrorCode: string | null;
  } | null = null,
) {
  return {
    application: { findUnique: jest.fn().mockResolvedValue(row) },
    outboxEvent: { findUnique: jest.fn().mockResolvedValue(outbox) },
    repositoryProvisionJob: {
      findUnique: jest.fn().mockResolvedValue(job),
    },
  };
}

describe('ApplicationsService.getForStaff', () => {
  it('교직원 권한이 없으면 APP_018 로 막고 신청도 이력도 읽지 않는다', async () => {
    const findApplicationForStaff = jest.fn();
    const listReviewHistory = jest.fn();
    const repository = {
      findApplicationForStaff,
      listReviewHistory,
    } as unknown as ApplicationsRepository;
    const assertActiveStaff = denyStaff();
    const service = new ApplicationsService(
      repository,
      noopAuditLog,
      {
        assertActiveStaff,
      },
      new ApplicationJoinCodeService({
        TEAM_JOIN_CODE_SECRET: 'synthetic-detail-secret',
      }),
    );

    await expect(
      service.getForStaff(SESSION_GITHUB_ID, APPLICATION_ID),
    ).rejects.toMatchObject({
      errorCode: { code: ApplicationsErrorCode.STAFF_LIST_ONLY, status: 403 },
    });
    expect(assertActiveStaff).toHaveBeenCalledWith(
      SESSION_GITHUB_ID,
      expect.any(Function),
    );
    expect(findApplicationForStaff).not.toHaveBeenCalled();
    expect(listReviewHistory).not.toHaveBeenCalled();
  });

  it('없는 신청이면 404 APPLICATION_NOT_FOUND 를 던진다', async () => {
    const findApplicationForStaff = jest.fn().mockResolvedValue(null);
    const repository = {
      findApplicationForStaff,
      listReviewHistory: jest.fn().mockResolvedValue([]),
    } as unknown as ApplicationsRepository;
    const service = new ApplicationsService(
      repository,
      noopAuditLog,
      {
        assertActiveStaff: allowStaff(),
      },
      new ApplicationJoinCodeService({
        TEAM_JOIN_CODE_SECRET: 'synthetic-detail-secret',
      }),
    );

    await expect(
      service.getForStaff(SESSION_GITHUB_ID, APPLICATION_ID),
    ).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.APPLICATION_NOT_FOUND,
        status: 404,
      },
    });
  });

  it('찾은 신청과 검토 이력을 함께 돌려준다', async () => {
    const item = { id: APPLICATION_ID };
    const reviewHistory = [{ id: 'history-1' }];
    const repository = {
      findApplicationForStaff: jest.fn().mockResolvedValue(item),
      listReviewHistory: jest.fn().mockResolvedValue(reviewHistory),
    } as unknown as ApplicationsRepository;
    const service = new ApplicationsService(
      repository,
      noopAuditLog,
      {
        assertActiveStaff: allowStaff(),
      },
      new ApplicationJoinCodeService({
        TEAM_JOIN_CODE_SECRET: 'synthetic-detail-secret',
      }),
    );

    await expect(
      service.getForStaff(SESSION_GITHUB_ID, APPLICATION_ID),
    ).resolves.toEqual({
      application: item,
      reviewHistory,
    });
  });

  it('신청이 없어도 이력 조회는 병행하고 응답은 동일 404다', async () => {
    const listReviewHistory = jest.fn().mockResolvedValue([]);
    const repository = {
      findApplicationForStaff: jest.fn().mockResolvedValue(null),
      listReviewHistory,
    } as unknown as ApplicationsRepository;
    const service = new ApplicationsService(
      repository,
      noopAuditLog,
      {
        assertActiveStaff: allowStaff(),
      },
      new ApplicationJoinCodeService({
        TEAM_JOIN_CODE_SECRET: 'synthetic-detail-secret',
      }),
    );

    await expect(
      service.getForStaff(SESSION_GITHUB_ID, APPLICATION_ID),
    ).rejects.toBeDefined();
    expect(listReviewHistory).toHaveBeenCalledWith(APPLICATION_ID);
  });
});

describe('ApplicationsRepository.findApplicationForStaff', () => {
  it('없는 신청은 null 이고 outbox·job 을 읽지 않는다', async () => {
    const transaction = detailTransaction(null);
    const { repository } = buildRepository(transaction);

    await expect(
      repository.findApplicationForStaff(APPLICATION_ID),
    ).resolves.toBeNull();
    expect(transaction.outboxEvent.findUnique).not.toHaveBeenCalled();
    expect(
      transaction.repositoryProvisionJob.findUnique,
    ).not.toHaveBeenCalled();
  });

  it('상세와 목록이 같은 select 를 쓴다', async () => {
    const detail = detailTransaction(applicationRow());
    const { repository: detailRepository } = buildRepository(detail);
    await detailRepository.findApplicationForStaff(APPLICATION_ID);

    const list = {
      application: {
        findMany: jest.fn().mockResolvedValue([applicationRow()]),
        count: jest.fn().mockResolvedValue(1),
      },
      outboxEvent: { findMany: jest.fn().mockResolvedValue([]) },
      repositoryProvisionJob: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const { repository: listRepository } = buildRepository(list);
    await listRepository.listApplicationsForProgram('program', LIST_QUERY);

    expect(readSelect(detail.application.findUnique)).toEqual(
      readSelect(list.application.findMany),
    );
  });

  it('신청·outbox·job 을 RepeatableRead 한 트랜잭션에서 읽는다', async () => {
    const transaction = detailTransaction(applicationRow());
    const { repository, $transaction } = buildRepository(transaction);

    await repository.findApplicationForStaff(APPLICATION_ID);

    expect($transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });

  it('신청 id 로 outbox 멱등키와 provision job 을 찾는다', async () => {
    const transaction = detailTransaction(applicationRow());
    const { repository } = buildRepository(transaction);

    await repository.findApplicationForStaff(APPLICATION_ID);

    expect(transaction.outboxEvent.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: `repository-provision:${APPLICATION_ID}` },
      }),
    );
    expect(transaction.repositoryProvisionJob.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { applicationId: APPLICATION_ID } }),
    );
  });

  it('provision job 상태를 저장소 프로비저닝 필드로 옮긴다', async () => {
    const transaction = detailTransaction(
      applicationRow({ status: ApplicationStatus.APPROVED }),
      { status: OutboxEventStatus.PROCESSED, createdAt: UPDATED_AT },
      {
        status: RepositoryProvisionJobStatus.SUCCEEDED,
        updatedAt: UPDATED_AT,
        lastErrorCode: null,
      },
    );
    const { repository } = buildRepository(transaction);

    const item = await repository.findApplicationForStaff(APPLICATION_ID);

    expect(item?.repositoryProvisioning).toEqual({
      enabled: true,
      jobStatus: 'SUCCEEDED',
      updatedAt: UPDATED_AT,
      safeErrorClass: null,
    });
  });

  it('지원 내용과 저장소 주소를 목록과 같은 모양으로 옮긴다', async () => {
    const transaction = detailTransaction(
      applicationRow({
        status: ApplicationStatus.REJECTED,
        rejectionReason: '예산 항목이 비어 있습니다',
        repository: {
          nameWithOwner: 'synthetic-org/team-1',
          visibility: RepositoryVisibility.PRIVATE,
        },
      }),
    );
    const { repository } = buildRepository(transaction);

    const item = await repository.findApplicationForStaff(APPLICATION_ID);

    expect(item).toMatchObject({
      id: APPLICATION_ID,
      status: ApplicationStatus.REJECTED,
      submittedAt: SUBMITTED_AT,
      rejectionReason: '예산 항목이 비어 있습니다',
      participation: 'TEAM',
      repository: {
        url: 'https://github.com/synthetic-org/team-1',
        visibility: RepositoryVisibility.PRIVATE,
      },
      team: { id: 'synthetic-team', name: '합성 팀', memberCount: 3 },
      answers: {
        applicantName: '신청자',
        title: '제목',
        summary: '지원 동기와 계획',
      },
    });
  });
});
