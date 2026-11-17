import { PlatformRepository } from '../platform/platform.repository';
import { RepositoryProvisionGenerationRepository } from '../platform/repository-provision-generation.repository';
import { TeamHistoryRepository } from './team-history.repository';
import { RepositoryProvisionEventService } from '../github/repository-provision-event.service';
import { ApplicationStatus } from '@prisma/client';
import {
  ApplicationsRepository,
  type ApplicationListRow,
} from './team.repository';
import { ApplicationsErrorCode } from './teams.error';
import {
  TeamApplicationService,
  ApplicationAnswersService,
} from './team-application.service';
import { RepositoryUrlService } from '../github/repository-url.service';

const APPLICATION_ID = 'synthetic-application';
const SUBMITTED_AT = new Date('2026-08-05T05:32:00.000Z');
const UPDATED_AT = new Date('2026-08-06T01:00:00.000Z');

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
    teamRepos: [],
    applicant: { id: 'synthetic-applicant', name: null, nickname: 'applicant' },
    name: '합성 팀',
    _count: { members: 3 },
    ...overrides,
  };
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
  const repository = new ApplicationsRepository(
    { $transaction, ...transaction } as never,
    new TeamHistoryRepository(),
    new RepositoryProvisionGenerationRepository(),
    new PlatformRepository(),
  );
  return { repository, $transaction };
}

function detailTransaction(row: Record<string, unknown> | null) {
  return { team: { findFirst: jest.fn().mockResolvedValue(row) } };
}

function mapItem(row: ApplicationListRow | null | undefined) {
  return row
    ? new TeamApplicationService(
        undefined as never,
        new RepositoryUrlService(),
        new ApplicationAnswersService(),
        new RepositoryProvisionEventService(),
      )['toApplicationListItem'](row)
    : undefined;
}

describe('TeamApplicationService.getForStaff', () => {
  it('없는 신청이면 404 APPLICATION_NOT_FOUND 를 던진다', async () => {
    const findApplicationForStaff = jest.fn().mockResolvedValue(null);
    const repository = {
      findApplicationForStaff,
      listReviewHistory: jest.fn().mockResolvedValue([]),
    } as unknown as ApplicationsRepository;
    const service = new TeamApplicationService(
      repository,
      new RepositoryUrlService(),
      new ApplicationAnswersService(),
      new RepositoryProvisionEventService(),
    );

    await expect(service.getForStaff(APPLICATION_ID)).rejects.toMatchObject({
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
      findApplicationForStaff: jest.fn().mockResolvedValue({
        row: {},
        outbox: undefined,
        job: undefined,
      }),
      listReviewHistory: jest.fn().mockResolvedValue(reviewHistory),
    } as unknown as ApplicationsRepository;
    const service = new TeamApplicationService(
      repository,
      new RepositoryUrlService(),
      new ApplicationAnswersService(),
      new RepositoryProvisionEventService(),
    );

    jest
      .spyOn(
        service as unknown as { toApplicationListItem: () => unknown },
        'toApplicationListItem',
      )
      .mockReturnValue(item);

    await expect(service.getForStaff(APPLICATION_ID)).resolves.toEqual({
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
    const service = new TeamApplicationService(
      repository,
      new RepositoryUrlService(),
      new ApplicationAnswersService(),
      new RepositoryProvisionEventService(),
    );

    await expect(service.getForStaff(APPLICATION_ID)).rejects.toBeDefined();
    expect(listReviewHistory).toHaveBeenCalledWith(APPLICATION_ID);
  });
});

describe('ApplicationsRepository.findApplicationForStaff', () => {
  it('없는 신청은 null 이다', async () => {
    const transaction = detailTransaction(null);
    const { repository } = buildRepository(transaction);

    await expect(
      repository.findApplicationForStaff(APPLICATION_ID),
    ).resolves.toBeNull();
  });

  it('상세에 상태·반려 사유·신청자 이름만 옮긴다', async () => {
    const transaction = detailTransaction(
      applicationRow({
        status: ApplicationStatus.REJECTED,
        rejectionReason: '예산 항목이 비어 있습니다',
      }),
    );
    const { repository } = buildRepository(transaction);

    const item = mapItem(
      await repository.findApplicationForStaff(APPLICATION_ID),
    );

    expect(item).toEqual({
      status: ApplicationStatus.REJECTED,
      rejectionReason: '예산 항목이 비어 있습니다',
      applicant: expect.objectContaining({
        nickname: expect.any(String) as unknown,
      }) as unknown,
    });
  });
});
