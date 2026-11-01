import { SubmissionFileAdmissionService } from './submission-file-admission.service';
import { SubmissionsRepository } from './submissions.repository';
import { MilestoneDocumentCollectionReadRepository } from './milestone-document-collection-read.repository';
import { MilestoneDocumentSubmissionRepository } from './milestone-document-submission.repository';
import { PlatformRepository } from '../platform/platform.repository';
import { LockProgramTreeRepository } from '../platform/lock-program-tree.repository';
import {
  MilestoneDocumentKind,
  ReviewDecision,
  SubmissionStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  MilestoneDocumentFlowFixture,
  flowIds,
} from './milestone-document-flow.integration-fixture';
import { flowGithubIds } from './milestone-document-flow-data.integration-fixture';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';
import { MilestoneDocumentReviewsService } from './milestone-document-reviews.service';
import { SubmissionReviewsService } from './submission-reviews.service';
import { SubmissionReviewsRepository } from './submission-reviews.repository';
import { RepositoryPublishService } from '../github/repository-publish.service';
import { RepositoryUrlService } from '../github/repository-url.service';
import { MilestoneCompletionService } from './milestone-completion.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const fixture = new MilestoneDocumentFlowFixture();
const documentReviews = new MilestoneDocumentReviewsService(
  new MilestoneDocumentsRepository(
    fixture.prisma,
    new LockProgramTreeRepository(),
    new PlatformRepository(),
    new MilestoneDocumentSubmissionRepository(new PlatformRepository()),
    new MilestoneDocumentCollectionReadRepository(fixture.prisma),
  ),
  new MilestoneDocumentSubmissionRepository(new PlatformRepository()),
);
const legacyReviews = new SubmissionReviewsService(
  new SubmissionReviewsRepository(
    fixture.prisma,
    new PlatformRepository(),
    new SubmissionsRepository(fixture.prisma, new PlatformRepository()),
  ),
  { publish: jest.fn() },
  new RepositoryPublishService(),
  new RepositoryUrlService(),
  new MilestoneCompletionService(),
  new SubmissionFileAdmissionService(),
);
const paths = ['document', 'legacy'] as const;
type ReviewPath = (typeof paths)[number];
const operators = [
  { kind: 'staff', hasStaffAccess: true, hasAdminAccess: false },
  { kind: 'admin', hasStaffAccess: false, hasAdminAccess: true },
] as const;

async function review(
  path: ReviewPath,
  actorGithubId: bigint,
  decision: ReviewDecision,
): Promise<unknown> {
  const { id: reviewerId } = await fixture.prisma.user.findUniqueOrThrow({
    where: { githubId: actorGithubId },
    select: { id: true },
  });
  if (path === 'document') {
    return documentReviews.review(
      reviewerId,
      flowIds.milestone,
      flowIds.document,
      flowIds.application,
      {
        decision,
        comment: '합성 검토 사유',
        expectedRevision: 1,
        expectedLatestReviewId: null,
        resubmissionDueAt:
          decision === ReviewDecision.CHANGES_REQUESTED
            ? new Date('2099-12-31T00:00:00.000Z')
            : null,
      },
    );
  }
  await fixture.prisma.milestoneDocument.update({
    where: { id: flowIds.document },
    data: { kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION },
  });
  const submission =
    await fixture.prisma.milestoneDocumentSubmission.findUniqueOrThrow({
      where: {
        milestoneDocumentId_applicationId: {
          milestoneDocumentId: flowIds.document,
          applicationId: flowIds.application,
        },
      },
      select: { id: true },
    });
  return legacyReviews.review(reviewerId, submission.id, {
    revision: 1,
    decision,
    comment: '합성 검토 사유',
  });
}

async function expectSubmissionUnchanged(): Promise<void> {
  const submission =
    await fixture.prisma.milestoneDocumentSubmission.findFirstOrThrow({
      where: { applicationId: flowIds.application },
      select: {
        status: true,
        revision: true,
        reviewHistories: { select: { id: true } },
        histories: { select: { event: true } },
      },
    });
  expect(submission).toEqual({
    status: SubmissionStatus.SUBMITTED,
    revision: 1,
    reviewHistories: [],
    histories: [{ event: 'SUBMITTED' }],
  });
}

describe.each(paths)('%s 자기 팀 검토 차단', (path) => {
  beforeAll(() => fixture.start());
  beforeEach(async () => {
    await fixture.reset();
    expect((await fixture.submit('합성 팀 제출')).status).toBe(201);
  });
  afterAll(() => fixture.stop());

  it.each(
    operators.flatMap((operator) =>
      Object.values(ReviewDecision).map((decision) => ({
        ...operator,
        decision,
      })),
    ),
  )(
    '학생·$kind인 팀장의 $decision은 원장을 바꾸지 않는다',
    async (testCase) => {
      await fixture.prisma.user.update({
        where: { id: flowIds.student },
        data: {
          hasStaffAccess: testCase.hasStaffAccess,
          hasAdminAccess: testCase.hasAdminAccess,
        },
      });

      await expect(
        review(path, flowGithubIds.student, testCase.decision),
      ).rejects.toMatchObject({
        errorCode: {
          code: path === 'document' ? 'MSD_046' : 'SUB_033',
          status: 403,
        },
      });
      await expectSubmissionUnchanged();
    },
  );

  it('제출자나 팀장이 아닌 현재 팀원도 자기 팀을 검토하지 못한다', async () => {
    await fixture.prisma.teamMember.create({
      data: {
        teamId: flowIds.team,
        programId: flowIds.program,
        userId: flowIds.staff,
      },
    });

    await expect(
      review(path, flowGithubIds.staff, ReviewDecision.APPROVED),
    ).rejects.toMatchObject({
      errorCode: {
        code: path === 'document' ? 'MSD_046' : 'SUB_033',
        status: 403,
      },
    });
    await expectSubmissionUnchanged();
  });

  it.each(operators)(
    '다른 팀 $kind 운영자는 계속 검토한다',
    async (operator) => {
      await fixture.prisma.user.update({
        where: { id: flowIds.staff },
        data: {
          hasStaffAccess: operator.hasStaffAccess,
          hasAdminAccess: operator.hasAdminAccess,
        },
      });

      await review(path, flowGithubIds.staff, ReviewDecision.APPROVED);

      await expect(
        fixture.prisma.milestoneDocumentSubmission.findFirstOrThrow({
          where: { applicationId: flowIds.application },
          select: {
            status: true,
            reviewHistories: { select: { reviewerId: true } },
          },
        }),
      ).resolves.toEqual({
        status: SubmissionStatus.APPROVED,
        reviewHistories: [{ reviewerId: flowIds.staff }],
      });
    },
  );
});
