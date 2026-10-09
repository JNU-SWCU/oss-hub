import {
  MilestoneDocumentKind,
  MilestoneSubmissionType,
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
import {
  toReviewContext,
  type ReviewContextRow,
} from './submission-review-context.mapper';

const NOW = new Date('2026-07-23T00:00:00.000Z');
const PROGRAM_ENDED_AT = new Date('2026-07-01T00:00:00.000Z');
const PROGRAM_ENDS_LATER = new Date('2026-08-01T00:00:00.000Z');
const ACTOR_GITHUB_ID = 9_600_000_000_100_001n;

type ReviewApplication = ReviewContextRow['application'];
type ReviewRepository = NonNullable<ReviewApplication['repository']>;

function eligibleRow(): ReviewContextRow {
  return {
    id: 'milestone-document-submission-1',
    legacySubmissionId: 'submission-1',
    revision: 1,
    application: {
      id: 'application-1',
      teamId: 'team-1',
      applicant: { nickname: 'applicant', profile: { name: 'Applicant' } },
      team: { name: 'Synthetic Team' },
      isRepositoryPublicationPlanned: true,
      provisionJob: {
        status: RepositoryProvisionJobStatus.SUCCEEDED,
        repositoryId: 'repository-1',
      },
      program: {
        endAt: PROGRAM_ENDED_AT,
        milestones: [
          {
            id: 'milestone-1',
            submissionType: MilestoneSubmissionType.FILE,
            documents: [],
          },
        ],
      },
      milestoneDocumentSubmissions: [
        {
          status: SubmissionStatus.APPROVED,
          milestoneDocument: {
            id: 'legacy-submission-document-1',
            milestoneId: 'milestone-1',
            kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
          },
        },
      ],
      repository: {
        id: 'repository-1',
        nameWithOwner: 'synthetic-org/synthetic-repository',
        visibility: RepositoryVisibility.PRIVATE,
      },
    },
    milestoneDocument: {
      milestone: { id: 'milestone-1', name: 'Final submission' },
    },
    histories: [
      {
        id: 'submission-history-1',
        revision: 1,
        content: { url: 'https://example.com/revision-1' },
        comment: null,
        createdAt: NOW,
        files: [],
        reviewHistories: [],
      },
    ],
  };
}

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

const SCENARIOS = [
  {
    label: '저장소 프로비저닝이 아직 안 끝났다',
    reason: PUBLISH_BLOCKED_REASONS.REPOSITORY_NOT_READY,
    errorCode: SubmissionReviewsErrorCode.REPOSITORY_NOT_READY,
    breakRow: (
      _repository: ReviewRepository,
      application: ReviewApplication,
    ) => {
      application.provisionJob = {
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
    label: '필수 마일스톤이 아직 승인되지 않았다',
    reason: PUBLISH_BLOCKED_REASONS.REQUIRED_MILESTONES_NOT_APPROVED,
    errorCode: SubmissionReviewsErrorCode.REQUIRED_MILESTONES_NOT_APPROVED,
    breakRow: (_repository: ReviewRepository, application: ReviewApplication) =>
      void (application.milestoneDocumentSubmissions = [
        {
          status: SubmissionStatus.SUBMITTED,
          milestoneDocument: {
            id: 'legacy-submission-document-1',
            milestoneId: 'milestone-1',
            kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
          },
        },
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
      profile: { name: 'synthetic-repository' },
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
    service: new SubmissionReviewsService(repository, repositories, {
      assertActiveStaff: jest.fn().mockResolvedValue({ actorId: 'reviewer-1' }),
    }),
  };
}

describe('저장소 공개 — 검토 화면과 공개 확정이 같은 게이트를 본다', () => {
  it('네 게이트를 모두 통과하면 화면은 버튼을 열고 서버는 공개한다', async () => {
    const row = eligibleRow();
    const { service, repositories } = serviceFor(eligibleEligibility());

    const context = toReviewContext(row, NOW);
    await service.publishRepository('repository-1', ACTOR_GITHUB_ID, NOW);

    expect(context.repository).toMatchObject({
      publishEligible: true,
      blockedReasons: [],
    });
    expect(repositories.publish).toHaveBeenCalled();
  });

  it('종료일이 지금과 같은 순간이면 이미 종료로 본다', async () => {
    const row = eligibleRow();
    row.application.program.endAt = NOW;
    const { service, repositories } = serviceFor({
      ...eligibleEligibility(),
      programEndAt: NOW,
    });

    const context = toReviewContext(row, NOW);
    await service.publishRepository('repository-1', ACTOR_GITHUB_ID, NOW);

    expect(context.repository?.blockedReasons).toEqual([]);
    expect(repositories.publish).toHaveBeenCalled();
  });

  it.each(SCENARIOS)(
    '$label — 화면이 차단하는 사유와 서버가 거절하는 코드가 같은 게이트다',
    async ({ reason, errorCode, breakRow, breakEligibility }) => {
      const row = brokenRow(breakRow);
      const { service, repositories } = serviceFor(
        breakEligibility(eligibleEligibility()),
      );

      const context = toReviewContext(row, NOW);
      const publish = service.publishRepository(
        'repository-1',
        ACTOR_GITHUB_ID,
        NOW,
      );

      await expect(publish).rejects.toMatchObject({
        errorCode: { code: errorCode },
      });
      expect(repositories.publish).not.toHaveBeenCalled();
      expect(context.repository?.publishEligible).toBe(false);
      expect(context.repository?.blockedReasons).toContain(reason);
    },
  );

  it('선언된 차단 사유는 모두 화면이 실제로 낼 수 있다', () => {
    const row = brokenRow((repository, application) => {
      for (const scenario of SCENARIOS)
        scenario.breakRow(repository, application);
    });

    const context = toReviewContext(row, NOW);

    expect(new Set(context.repository?.blockedReasons)).toEqual(
      new Set<PublishBlockedReason>(Object.values(PUBLISH_BLOCKED_REASONS)),
    );
  });

  it('게이트가 한꺼번에 막히면 화면은 게이트 순서대로 나열하고 서버는 첫 게이트로 거절한다', async () => {
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
      programEndAt: new Date('2026-12-31T00:00:00.000Z'),
    });

    const context = toReviewContext(row, NOW);
    const publish = service.publishRepository(
      'repository-1',
      ACTOR_GITHUB_ID,
      NOW,
    );

    expect(context.repository?.blockedReasons).toEqual([
      PUBLISH_BLOCKED_REASONS.REPOSITORY_NOT_READY,
      PUBLISH_BLOCKED_REASONS.REPOSITORY_PUBLICATION_NOT_PLANNED,
      PUBLISH_BLOCKED_REASONS.PROGRAM_NOT_ENDED,
      PUBLISH_BLOCKED_REASONS.REQUIRED_MILESTONES_NOT_APPROVED,
    ]);

    await expect(publish).rejects.toMatchObject({
      errorCode: { code: SubmissionReviewsErrorCode.REPOSITORY_NOT_READY },
    });
    expect(repositories.publish).not.toHaveBeenCalled();
  });

  it('저장소 조회가 게이트 재료를 DB 값 그대로 옮긴다', async () => {
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
          milestones: [{ id: 'milestone-1', documents: [] }],
        },
        milestoneDocumentSubmissions: [
          {
            status: SubmissionStatus.SUBMITTED,
            milestoneDocument: {
              id: 'legacy-submission-document-1',
              milestoneId: 'milestone-1',
              kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
            },
          },
        ],
      },
    });
    const repository = new SubmissionReviewsRepository({
      githubRepository: { findUnique },
    } as unknown as PrismaService);

    const eligibility = await repository.findPublishEligibility('repository-1');

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
        milestoneDocumentSubmissions: [],
      },
    });
    const repository = new SubmissionReviewsRepository({
      githubRepository: { findUnique },
    } as unknown as PrismaService);

    const eligibility = await repository.findPublishEligibility('repository-1');

    expect(eligibility?.provisionStatus).toBeNull();
  });

  it('저장소를 찾지 못하면 준비되지 않은 것으로 거절한다', async () => {
    const { service, repositories } = serviceFor(null);

    const publish = service.publishRepository(
      'repository-1',
      ACTOR_GITHUB_ID,
      NOW,
    );

    await expect(publish).rejects.toMatchObject({
      errorCode: { code: SubmissionReviewsErrorCode.REPOSITORY_NOT_READY },
    });
    expect(repositories.publish).not.toHaveBeenCalled();
  });

  it('이미 공개된 저장소는 게이트를 적용하지 않는다', () => {
    const row = brokenRow((repository, application) => {
      for (const scenario of SCENARIOS)
        scenario.breakRow(repository, application);
      repository.visibility = RepositoryVisibility.PUBLIC;
    });

    const context = toReviewContext(row, NOW);

    expect(context.repository).toMatchObject({
      visibility: RepositoryVisibility.PUBLIC,
      publishEligible: true,
      blockedReasons: [],
    });
  });
});
