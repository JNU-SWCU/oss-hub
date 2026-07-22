import {
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
  ReviewDecision,
  SubmissionStatus,
} from '@prisma/client';
import { PUBLISH_BLOCKED_REASONS } from './domain/submission-review';
import {
  requiredMilestonesApproved,
  toReviewContext,
} from './submission-review-context.mapper';

const submittedAt = new Date('2026-07-22T00:00:00.000Z');

type ReviewContextInput = Parameters<typeof toReviewContext>[0];

function contextRow(): ReviewContextInput {
  return {
    id: 'submission-1',
    currentRevision: 2,
    application: {
      id: 'application-1',
      teamId: 'team-1',
      applicant: { name: 'Applicant', login: 'applicant' },
      team: { name: 'Synthetic Team' },
      program: { milestones: [{ id: 'milestone-1' }] },
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
        revision: 2,
        content: { url: 'https://example.com/revision-2' },
        comment: 'updated',
        submittedAt,
        review: null,
      },
      {
        revision: 1,
        content: { url: 'https://example.com/revision-1' },
        comment: null,
        submittedAt,
        review: {
          id: 'review-1',
          decision: ReviewDecision.CHANGES_REQUESTED,
          comment: 'revise',
          reviewedAt: submittedAt,
        },
      },
    ],
  };
}

describe('toReviewContext', () => {
  it('팀 신청의 최신 revision과 보존된 이전 판정을 구분한다', () => {
    // Given: 팀 제출의 revision 이력과 공개 가능한 저장소가 있다.
    const row = contextRow();

    // When: 검토 화면 컨텍스트로 변환한다.
    const context = toReviewContext(row);

    // Then: 최신 revision과 이전 history를 분리하고 팀 이름을 표시한다.
    expect(context).toMatchObject({
      application: {
        applicationMode: 'TEAM',
        displayName: 'Synthetic Team',
      },
      currentRevision: { number: 2, review: null },
      history: [
        {
          number: 1,
          review: { decision: ReviewDecision.CHANGES_REQUESTED },
        },
      ],
      repository: { publishEligible: true, blockedReasons: [] },
    });
  });

  it('미승인 마일스톤을 공개 차단 사유로 표시한다', () => {
    // Given: 현재 제출이 아직 승인되지 않았다.
    const row = contextRow();
    row.application.submissions[0] = {
      milestoneId: 'milestone-1',
      status: SubmissionStatus.SUBMITTED,
    };

    // When: 검토 화면 컨텍스트로 변환한다.
    const context = toReviewContext(row);

    // Then: 공개 버튼을 비활성화할 서버 계산 결과를 반환한다.
    expect(context.repository).toMatchObject({
      publishEligible: false,
      blockedReasons: [
        PUBLISH_BLOCKED_REASONS.REQUIRED_MILESTONES_NOT_APPROVED,
      ],
    });
  });
});

describe('requiredMilestonesApproved', () => {
  it('프로그램의 모든 마일스톤에 승인된 현재 제출이 있어야 한다', () => {
    // Given: 두 필수 마일스톤 중 하나만 승인됐다.
    const milestones = [{ id: 'm1' }, { id: 'm2' }];
    const submissions = [
      { milestoneId: 'm1', status: SubmissionStatus.APPROVED },
      { milestoneId: 'm2', status: SubmissionStatus.CHANGES_REQUESTED },
    ];

    // When: 공개 eligibility를 계산한다.
    const eligible = requiredMilestonesApproved(milestones, submissions);

    // Then: 공개할 수 없다.
    expect(eligible).toBe(false);
  });
});
