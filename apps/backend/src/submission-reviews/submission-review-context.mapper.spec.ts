import {
  SubmissionFileLifecycle,
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
/** 공개 게이트가 통과하도록 이미 지난 종료일을 기준값으로 쓴다. */
const programEndedAt = new Date('2026-07-01T00:00:00.000Z');

type ReviewContextInput = Parameters<typeof toReviewContext>[0];

function contextRow(): ReviewContextInput {
  return {
    id: 'submission-1',
    currentRevision: 2,
    application: {
      id: 'application-1',
      teamId: 'team-1',
      applicant: { name: 'Applicant', nickname: 'applicant', profile: null },
      team: { name: 'Synthetic Team' },
      isRepositoryPublicationPlanned: true,
      program: {
        endAt: programEndedAt,
        milestones: [{ id: 'milestone-1', documents: [] }],
      },
      submissions: [
        { milestoneId: 'milestone-1', status: SubmissionStatus.APPROVED },
      ],
      milestoneDocumentSubmissions: [],
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
        files: [],
        review: null,
      },
      {
        revision: 1,
        content: { url: 'https://example.com/revision-1' },
        comment: null,
        submittedAt,
        files: [],
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

  it('1인 팀 신청 표시 이름은 팀 이름을 쓴다', () => {
    // Given: D5 이후 개인 참여도 1인 팀이다. displayName은 team.name을 우선한다.
    const row = contextRow();
    row.application.teamId = 'solo-team-1';
    row.application.team = { name: 'Solo Participant Team' };
    row.application.applicant.profile = { name: 'Profile Applicant' };

    // When
    const context = toReviewContext(row);

    // Then
    expect(context.application.displayName).toBe('Solo Participant Team');
    expect(context.application.applicationMode).toBe('TEAM');
  });

  it('revision 첨부 파일은 ATTACHED·미만료 항목만 storageKey 없이 반환한다', () => {
    // Given
    const row = contextRow();
    const [currentRevision] = row.revisions;
    if (currentRevision === undefined) {
      throw new Error('contextRow must include a current revision');
    }
    currentRevision.content = { type: 'FILE', fileId: 'file-current' };
    currentRevision.files = [
      {
        id: 'file-current',
        originalFileName: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        expiresAt: new Date('2028-01-01T00:00:00.000Z'),
        lifecycle: SubmissionFileLifecycle.ATTACHED,
      },
      {
        id: 'file-pending',
        originalFileName: 'pending.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 4096,
        expiresAt: new Date('2028-01-01T00:00:00.000Z'),
        lifecycle: SubmissionFileLifecycle.PENDING,
      },
      {
        id: 'file-expired',
        originalFileName: 'expired.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 8192,
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
        lifecycle: SubmissionFileLifecycle.ATTACHED,
      },
    ];

    // When
    const context = toReviewContext(row, new Date('2026-07-31T00:00:00.000Z'));

    // Then
    const serialized = JSON.stringify(context);
    expect(context.currentRevision.files).toEqual([
      {
        fileId: 'file-current',
        fileName: 'report.pdf',
        contentType: 'application/pdf',
        size: 2048,
        expiresAt: new Date('2028-01-01T00:00:00.000Z'),
        downloadUrl: '/api/v1/submission-files/file-current',
      },
    ]);
    expect(serialized).not.toContain('storageKey');
    expect(serialized).not.toContain('file-pending');
    expect(serialized).not.toContain('file-expired');
  });
});

describe('requiredMilestonesApproved', () => {
  it('프로그램의 모든 마일스톤에 승인된 현재 제출이 있어야 한다', () => {
    // Given: 두 필수 마일스톤 중 하나만 승인됐다.
    const milestones = [
      { id: 'm1', documents: [] },
      { id: 'm2', documents: [] },
    ];
    const submissions = [
      { milestoneId: 'm1', status: SubmissionStatus.APPROVED },
      { milestoneId: 'm2', status: SubmissionStatus.CHANGES_REQUESTED },
    ];

    // When: 공개 eligibility를 계산한다.
    const eligible = requiredMilestonesApproved(milestones, submissions, []);

    // Then: 공개할 수 없다.
    expect(eligible).toBe(false);
  });

  it('서류만 받는 마일스톤은 필수 서류가 다 승인이면 공개 자격이 난다 (#820)', () => {
    // Given: 코드 제출은 없고 필수 서류 두 건만 있는 마일스톤. 둘 다 승인됐다.
    const milestones = [{ id: 'm1', documents: [{ id: 'd1' }, { id: 'd2' }] }];
    const documentSubmissions = [
      { milestoneDocumentId: 'd1', status: SubmissionStatus.APPROVED },
      { milestoneDocumentId: 'd2', status: SubmissionStatus.APPROVED },
    ];

    // When
    const eligible = requiredMilestonesApproved(
      milestones,
      [],
      documentSubmissions,
    );

    // Then: 예전에는 Submission 행이 없어 영구히 false 였다.
    expect(eligible).toBe(true);
  });

  it('필수 서류 한 건이 미제출이면 공개 자격이 나지 않는다', () => {
    // Given: 필수 서류 두 건 중 하나만 승인이고 나머지는 제출 행이 없다.
    const milestones = [{ id: 'm1', documents: [{ id: 'd1' }, { id: 'd2' }] }];
    const documentSubmissions = [
      { milestoneDocumentId: 'd1', status: SubmissionStatus.APPROVED },
    ];

    // When
    const eligible = requiredMilestonesApproved(
      milestones,
      [],
      documentSubmissions,
    );

    // Then
    expect(eligible).toBe(false);
  });

  it('서류가 다 승인이어도 코드 제출 행이 있으면 그것까지 승인이어야 한다', () => {
    // Given: 두 축이 다 쓰인 마일스톤. 서류는 승인, 코드 제출은 심사 중.
    const milestones = [{ id: 'm1', documents: [{ id: 'd1' }] }];

    // When
    const eligible = requiredMilestonesApproved(
      milestones,
      [{ milestoneId: 'm1', status: SubmissionStatus.SUBMITTED }],
      [{ milestoneDocumentId: 'd1', status: SubmissionStatus.APPROVED }],
    );

    // Then: 서류 축이 코드 축을 덮어쓰지 않는다.
    expect(eligible).toBe(false);
  });
});
