import {
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
  SubmissionStatus,
} from '@prisma/client';
import type { RepositoriesService } from '../github/service/repositories.service';
import {
  PUBLISH_BLOCKED_REASONS,
  type PublishBlockedReason,
  type RepositoryPublishEligibility,
} from './domain/submission-review';
import type { PrismaService } from '../prisma/prisma.service';
import {
  SubmissionReviewsRepository,
  type SubmissionReviewsRepositoryPort,
} from './submission-reviews.repository';
import { SubmissionReviewsErrorCode } from './submission-reviews-error-code.enum';
import { SubmissionReviewsService } from './submission-reviews.service';
import { toReviewContext } from './submission-review-context.mapper';

const NOW = new Date('2026-07-23T00:00:00.000Z');
const PROGRAM_ENDED_AT = new Date('2026-07-01T00:00:00.000Z');
const PROGRAM_ENDS_LATER = new Date('2026-08-01T00:00:00.000Z');
const ACTOR_GITHUB_ID = 9_600_000_000_100_001n;

type ReviewContextRow = Parameters<typeof toReviewContext>[0];
type ReviewApplication = ReviewContextRow['application'];
type ReviewRepository = NonNullable<ReviewApplication['repository']>;

/** 네 게이트를 모두 통과하는 기준 행 — 시나리오가 여기서 한 조건씩 무너뜨린다. */
function eligibleRow(): ReviewContextRow {
  return {
    id: 'submission-1',
    currentRevision: 1,
    application: {
      id: 'application-1',
      teamId: 'team-1',
      applicant: { name: 'Applicant', nickname: 'applicant', profile: null },
      team: { name: 'Synthetic Team' },
      isRepositoryPublicationPlanned: true,
      program: {
        endAt: PROGRAM_ENDED_AT,
        milestones: [{ id: 'milestone-1' }],
      },
      submissions: [
        { milestoneId: 'milestone-1', status: SubmissionStatus.APPROVED },
      ],
      repository: {
        id: 'repository-1',
        url: 'https://github.com/synthetic-org/synthetic-repository',
        visibility: RepositoryVisibility.PRIVATE,
        provisionJob: {
          status: RepositoryProvisionJobStatus.SUCCEEDED,
          repositoryId: 'repository-1',
        },
      },
    },
    milestone: { id: 'milestone-1', name: 'Final submission' },
    revisions: [
      {
        revision: 1,
        content: { url: 'https://example.com/revision-1' },
        comment: null,
        submittedAt: NOW,
        files: [],
        review: null,
      },
    ],
  };
}

/** 같은 상태를 서버 게이트가 보는 모양으로 옮긴 것. */
function eligibleEligibility(): RepositoryPublishEligibility {
  return {
    repositoryId: 'repository-1',
    visibility: RepositoryVisibility.PRIVATE,
    provisionStatus: RepositoryProvisionJobStatus.SUCCEEDED,
    requiredMilestonesApproved: true,
    isRepositoryPublicationPlanned: true,
    programEndAt: PROGRAM_ENDED_AT,
  };
}

/**
 * 게이트 하나를 무너뜨리는 방법을 화면 쪽·서버 쪽 **양쪽**으로 적는다.
 * 두 표면이 같은 상태를 어떻게 판정하는지 나란히 비교하는 것이 이 파일의 목적이다.
 */
const SCENARIOS = [
  {
    label: '저장소 프로비저닝이 아직 안 끝났다',
    reason: PUBLISH_BLOCKED_REASONS.REPOSITORY_NOT_READY,
    errorCode: SubmissionReviewsErrorCode.REPOSITORY_NOT_READY,
    breakRow: (repository: ReviewRepository) => {
      repository.provisionJob = {
        status: RepositoryProvisionJobStatus.PROCESSING,
        repositoryId: 'repository-1',
      };
    },
    breakEligibility: (eligibility: RepositoryPublishEligibility) => ({
      ...eligibility,
      provisionStatus: RepositoryProvisionJobStatus.PROCESSING,
    }),
  },
  {
    label: '지원서가 저장소 공개를 계획하지 않았다',
    reason: PUBLISH_BLOCKED_REASONS.REPOSITORY_PUBLICATION_NOT_PLANNED,
    errorCode: SubmissionReviewsErrorCode.REPOSITORY_PUBLICATION_NOT_PLANNED,
    breakRow: (_repository: ReviewRepository, application: ReviewApplication) =>
      void (application.isRepositoryPublicationPlanned = false),
    breakEligibility: (eligibility: RepositoryPublishEligibility) => ({
      ...eligibility,
      isRepositoryPublicationPlanned: false,
    }),
  },
  {
    label: '프로그램 종료일이 아직 지나지 않았다',
    reason: PUBLISH_BLOCKED_REASONS.PROGRAM_NOT_ENDED,
    errorCode: SubmissionReviewsErrorCode.PROGRAM_NOT_ENDED,
    breakRow: (_repository: ReviewRepository, application: ReviewApplication) =>
      void (application.program.endAt = PROGRAM_ENDS_LATER),
    breakEligibility: (eligibility: RepositoryPublishEligibility) => ({
      ...eligibility,
      programEndAt: PROGRAM_ENDS_LATER,
    }),
  },
  {
    label: '프로그램 종료일이 설정되지 않았다(스키마상 "미종료")',
    reason: PUBLISH_BLOCKED_REASONS.PROGRAM_NOT_ENDED,
    errorCode: SubmissionReviewsErrorCode.PROGRAM_NOT_ENDED,
    breakRow: (_repository: ReviewRepository, application: ReviewApplication) =>
      void (application.program.endAt = null),
    breakEligibility: (eligibility: RepositoryPublishEligibility) => ({
      ...eligibility,
      programEndAt: null,
    }),
  },
  {
    label: '필수 마일스톤이 아직 승인되지 않았다',
    reason: PUBLISH_BLOCKED_REASONS.REQUIRED_MILESTONES_NOT_APPROVED,
    errorCode: SubmissionReviewsErrorCode.REQUIRED_MILESTONES_NOT_APPROVED,
    breakRow: (_repository: ReviewRepository, application: ReviewApplication) =>
      void (application.submissions = [
        { milestoneId: 'milestone-1', status: SubmissionStatus.SUBMITTED },
      ]),
    breakEligibility: (eligibility: RepositoryPublishEligibility) => ({
      ...eligibility,
      requiredMilestonesApproved: false,
    }),
  },
] as const;

function brokenRow(
  breakRow: (
    repository: ReviewRepository,
    application: ReviewApplication,
  ) => void,
): ReviewContextRow {
  const row = eligibleRow();
  const repository = row.application.repository;
  if (repository === null) throw new Error('fixture: repository is required');
  breakRow(repository, row.application);
  return row;
}

function serviceFor(eligibility: RepositoryPublishEligibility | null) {
  const repositories = {
    publish: jest.fn().mockResolvedValue({
      id: 'repository-1',
      githubRepositoryId: 123n,
      name: 'synthetic-repository',
      url: 'https://github.com/synthetic-org/synthetic-repository',
      visibility: RepositoryVisibility.PUBLIC,
      publishedAt: NOW,
    }),
  } as jest.Mocked<Pick<RepositoriesService, 'publish'>>;
  const repository = {
    findReviewContext: jest.fn(),
    findPublishEligibility: jest.fn().mockResolvedValue(eligibility),
    withTransaction: jest.fn(),
  } as unknown as jest.Mocked<SubmissionReviewsRepositoryPort>;
  return {
    repositories,
    service: new SubmissionReviewsService(repository, repositories),
  };
}

describe('저장소 공개 — 검토 화면과 공개 확정이 같은 게이트를 본다', () => {
  it('네 게이트를 모두 통과하면 화면은 버튼을 열고 서버는 공개한다', async () => {
    // Given: 어떤 게이트도 무너뜨리지 않은 기준 상태.
    const row = eligibleRow();
    const { service, repositories } = serviceFor(eligibleEligibility());

    // When: 화면이 판정하고 서버가 공개를 실행한다.
    const context = toReviewContext(row, NOW);
    await service.publishRepository('repository-1', ACTOR_GITHUB_ID, NOW);

    // Then: 화면은 차단 사유가 없고 서버는 GitHub 공개를 호출한다.
    expect(context.repository).toMatchObject({
      publishEligible: true,
      blockedReasons: [],
    });
    expect(repositories.publish).toHaveBeenCalled();
  });

  it('종료일이 지금과 같은 순간이면 이미 종료로 본다', async () => {
    // Given: endAt 이 정확히 판정 시각과 같다(옛 서버 조건은 `endAt > now` 일 때만 막았다).
    const row = eligibleRow();
    row.application.program.endAt = NOW;
    const { service, repositories } = serviceFor({
      ...eligibleEligibility(),
      programEndAt: NOW,
    });

    // When: 화면이 판정하고 서버가 공개를 실행한다.
    const context = toReviewContext(row, NOW);
    await service.publishRepository('repository-1', ACTOR_GITHUB_ID, NOW);

    // Then: 양쪽 모두 통과시킨다.
    expect(context.repository?.blockedReasons).toEqual([]);
    expect(repositories.publish).toHaveBeenCalled();
  });

  it.each(SCENARIOS)(
    '$label — 화면이 차단하는 사유와 서버가 거절하는 코드가 같은 게이트다',
    async ({ reason, errorCode, breakRow, breakEligibility }) => {
      // Given: 게이트 하나만 무너진 같은 상태를 두 표면에 각각 준다.
      const row = brokenRow(breakRow);
      const { service, repositories } = serviceFor(
        breakEligibility(eligibleEligibility()),
      );

      // When: 화면이 판정하고 교직원이 공개 버튼을 누른다.
      const context = toReviewContext(row, NOW);
      const publish = service.publishRepository(
        'repository-1',
        ACTOR_GITHUB_ID,
        NOW,
      );

      // Then: 화면은 버튼을 닫고 그 사유를 말하며, 서버는 같은 게이트로 거절한다.
      await expect(publish).rejects.toMatchObject({
        errorCode: { code: errorCode },
      });
      expect(repositories.publish).not.toHaveBeenCalled();
      expect(context.repository?.publishEligible).toBe(false);
      expect(context.repository?.blockedReasons).toContain(reason);
    },
  );

  it('선언된 차단 사유는 모두 화면이 실제로 낼 수 있다', () => {
    // Given: 네 게이트를 한꺼번에 무너뜨린 행.
    // (사유가 늘었는데 화면 쪽 재료가 안 실리면 여기서 걸린다.)
    const row = brokenRow((repository, application) => {
      for (const scenario of SCENARIOS)
        scenario.breakRow(repository, application);
    });

    // When: 검토 화면 컨텍스트로 변환한다.
    const context = toReviewContext(row, NOW);

    // Then: 도메인이 선언한 사유 집합과 화면이 낸 사유 집합이 같다.
    expect(new Set(context.repository?.blockedReasons)).toEqual(
      new Set<PublishBlockedReason>(Object.values(PUBLISH_BLOCKED_REASONS)),
    );
  });

  it('게이트가 한꺼번에 막히면 화면은 게이트 순서대로 나열하고 서버는 첫 게이트로 거절한다', async () => {
    // Given: 네 게이트가 동시에 막혔다.
    // 사유는 순서 있는 계약이다 — 서버가 첫 사유로 거절하므로 순서가 곧 교직원이 볼 오류 코드다.
    const row = brokenRow((repository, application) => {
      for (const scenario of SCENARIOS)
        scenario.breakRow(repository, application);
    });
    const { service, repositories } = serviceFor({
      repositoryId: 'repository-1',
      visibility: RepositoryVisibility.PRIVATE,
      provisionStatus: RepositoryProvisionJobStatus.PROCESSING,
      requiredMilestonesApproved: false,
      isRepositoryPublicationPlanned: false,
      programEndAt: null,
    });

    // When: 화면이 판정하고 교직원이 공개 버튼을 누른다.
    const context = toReviewContext(row, NOW);
    const publish = service.publishRepository(
      'repository-1',
      ACTOR_GITHUB_ID,
      NOW,
    );

    // Then: 화면은 AGENTS.md 「다섯 게이트」의 2~5 순서로 나열한다(집합이 아니라 순서다).
    expect(context.repository?.blockedReasons).toEqual([
      PUBLISH_BLOCKED_REASONS.REPOSITORY_NOT_READY,
      PUBLISH_BLOCKED_REASONS.REPOSITORY_PUBLICATION_NOT_PLANNED,
      PUBLISH_BLOCKED_REASONS.PROGRAM_NOT_ENDED,
      PUBLISH_BLOCKED_REASONS.REQUIRED_MILESTONES_NOT_APPROVED,
    ]);
    // 그리고 서버는 그중 첫 게이트로 거절한다 — 이 갈래가 리팩터 전 동작이다.
    await expect(publish).rejects.toMatchObject({
      errorCode: { code: SubmissionReviewsErrorCode.REPOSITORY_NOT_READY },
    });
    expect(repositories.publish).not.toHaveBeenCalled();
  });

  it('저장소 조회가 게이트 재료를 DB 값 그대로 옮긴다', async () => {
    // Given: 네 게이트가 저마다 다른 값을 갖는 저장소 행.
    // (여기서 한 칸이라도 상수로 굳으면 서버가 아무 신청이나 공개해 버린다 —
    //  Prisma 를 흉내 내는 것이 아니라 "행 → 게이트 재료" 옮김만 붙잡는 테스트다.)
    const findUnique = jest.fn().mockResolvedValue({
      id: 'repository-1',
      visibility: RepositoryVisibility.PRIVATE,
      application: {
        isRepositoryPublicationPlanned: false,
        provisionJob: {
          status: RepositoryProvisionJobStatus.PROCESSING,
          repositoryId: 'repository-1',
        },
        program: {
          endAt: PROGRAM_ENDED_AT,
          milestones: [{ id: 'milestone-1' }],
        },
        submissions: [
          { milestoneId: 'milestone-1', status: SubmissionStatus.SUBMITTED },
        ],
      },
    });
    const repository = new SubmissionReviewsRepository({
      repository: { findUnique },
    } as unknown as PrismaService);

    // When: 공개 게이트 재료를 조회한다.
    const eligibility = await repository.findPublishEligibility('repository-1');

    // Then: 네 칸이 모두 행의 값에서 왔다.
    expect(eligibility).toEqual({
      repositoryId: 'repository-1',
      visibility: RepositoryVisibility.PRIVATE,
      provisionStatus: RepositoryProvisionJobStatus.PROCESSING,
      requiredMilestonesApproved: false,
      isRepositoryPublicationPlanned: false,
      programEndAt: PROGRAM_ENDED_AT,
    });
  });

  it('다른 저장소의 프로비저닝 작업은 준비 상태로 세지 않는다', async () => {
    // Given: 신청에 달린 job 이 이 저장소가 아닌 다른 저장소를 가리킨다.
    const findUnique = jest.fn().mockResolvedValue({
      id: 'repository-1',
      visibility: RepositoryVisibility.PRIVATE,
      application: {
        isRepositoryPublicationPlanned: true,
        provisionJob: {
          status: RepositoryProvisionJobStatus.SUCCEEDED,
          repositoryId: 'repository-2',
        },
        program: { endAt: PROGRAM_ENDED_AT, milestones: [] },
        submissions: [],
      },
    });
    const repository = new SubmissionReviewsRepository({
      repository: { findUnique },
    } as unknown as PrismaService);

    // When: 공개 게이트 재료를 조회한다.
    const eligibility = await repository.findPublishEligibility('repository-1');

    // Then: 남의 SUCCEEDED 를 빌려 오지 않는다.
    expect(eligibility?.provisionStatus).toBeNull();
  });

  it('저장소를 찾지 못하면 준비되지 않은 것으로 거절한다', async () => {
    // Given: 주소의 저장소가 없다(`findPublishEligibility` 가 null 을 준다).
    const { service, repositories } = serviceFor(null);

    // When: 공개 전환을 요청한다.
    const publish = service.publishRepository(
      'repository-1',
      ACTOR_GITHUB_ID,
      NOW,
    );

    // Then: 존재 여부를 알려 주지 않고 준비 미완으로 거절하며 GitHub 를 부르지 않는다.
    await expect(publish).rejects.toMatchObject({
      errorCode: { code: SubmissionReviewsErrorCode.REPOSITORY_NOT_READY },
    });
    expect(repositories.publish).not.toHaveBeenCalled();
  });

  it('이미 공개된 저장소는 게이트를 적용하지 않는다', () => {
    // Given: 게이트가 전부 무너졌지만 저장소가 이미 PUBLIC 이다.
    const row = brokenRow((repository, application) => {
      for (const scenario of SCENARIOS)
        scenario.breakRow(repository, application);
      repository.visibility = RepositoryVisibility.PUBLIC;
    });

    // When: 검토 화면 컨텍스트로 변환한다.
    const context = toReviewContext(row, NOW);

    // Then: 차단 사유 없이 공개 상태로 본다.
    expect(context.repository).toMatchObject({
      visibility: RepositoryVisibility.PUBLIC,
      publishEligible: true,
      blockedReasons: [],
    });
  });
});
