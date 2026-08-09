import {
  ApplicationStatus,
  OutboxEventStatus,
  Prisma,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
} from '@prisma/client';
import { ApplicationsRepository } from './applications.repository';
import { ApplicationsErrorCode } from './applications-error-code.enum';
import { ApplicationsService } from './applications.service';
import type { AuditLogService } from '../audit-log/audit-log.service';

/** 이 스펙들은 판정 경로를 타지 않으므로 감사 기록기는 호출되지 않는다. */
const noopAuditLog = { record: jest.fn() } as unknown as AuditLogService;

const APPLICATION_ID = 'synthetic-application';
const SUBMITTED_AT = new Date('2026-08-05T05:32:00.000Z');
const UPDATED_AT = new Date('2026-08-06T01:00:00.000Z');

const LIST_QUERY = {
  page: 1,
  pageSize: 20,
  search: '',
  status: 'all',
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

/** jest.fn() 의 호출 인자는 any 라 명시적으로 좁혀 읽는다. */
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
  const repository = new ApplicationsRepository({ $transaction } as never, {
    TEAM_JOIN_CODE_SECRET: 'synthetic-detail-secret',
  });
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
  it('없는 신청이면 404 APPLICATION_NOT_FOUND 를 던진다', async () => {
    const findApplicationForStaff = jest.fn().mockResolvedValue(null);
    const repository = {
      findApplicationForStaff,
    } as unknown as ApplicationsRepository;
    const service = new ApplicationsService(repository, noopAuditLog);

    await expect(service.getForStaff(APPLICATION_ID)).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.APPLICATION_NOT_FOUND,
        status: 404,
      },
    });
  });

  it('찾은 신청을 그대로 돌려준다', async () => {
    const item = { id: APPLICATION_ID };
    const repository = {
      findApplicationForStaff: jest.fn().mockResolvedValue(item),
    } as unknown as ApplicationsRepository;
    const service = new ApplicationsService(repository, noopAuditLog);

    await expect(service.getForStaff(APPLICATION_ID)).resolves.toBe(item);
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
    // 한쪽 select 만 늘어나면 목록에서 보이던 값이 상세에서 사라진다 — 두 조회가
    // 같은 상수를 쓴다는 사실 자체를 고정한다.
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
    // 셋을 따로 읽으면 그 사이 판정이 끼어들어 「반려인데 저장소 작업 진행 중」 같은
    // 있을 수 없는 조합이 화면에 그려진다.
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
          url: 'https://github.test/synthetic-org/team-1',
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
        url: 'https://github.test/synthetic-org/team-1',
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
