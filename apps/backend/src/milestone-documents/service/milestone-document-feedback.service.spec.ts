import {
  MilestoneDocumentKind,
  ReviewDecision,
  SubmissionStatus,
} from '@prisma/client';
import type { RecentMilestoneDocumentReview } from '../repository/milestone-document-feedback.repository';
import { MilestoneDocumentFeedbackService } from './milestone-document-feedback.service';

const NOW = new Date('2026-09-23T03:00:00.000Z');

function review(
  overrides: Partial<RecentMilestoneDocumentReview> = {},
): RecentMilestoneDocumentReview {
  return {
    id: 'review-1',
    decision: ReviewDecision.CHANGES_REQUESTED,
    comment: '표지를 보완해 주세요.',
    reviewedAt: new Date('2026-09-20T01:00:00.000Z'),
    resubmissionDueAt: new Date('2026-09-27T14:59:00.000Z'),
    applicationId: 'synthetic-application',
    programId: 'synthetic-program',
    milestoneId: 'seed:milestone',
    milestoneName: '중간 보고',
    documentName: '합성 계획서',
    documentKind: MilestoneDocumentKind.DOCUMENT,
    submissionId: 'submission-1',
    submissionStatus: SubmissionStatus.CHANGES_REQUESTED,
    ...overrides,
  };
}

function serviceWith(
  reviews: readonly RecentMilestoneDocumentReview[],
  now: Date = NOW,
) {
  const findRecentForParticipant = jest.fn().mockResolvedValue(reviews);
  return {
    service: new MilestoneDocumentFeedbackService(
      { findRecentForParticipant },
      () => now,
    ),
    findRecentForParticipant,
  };
}

describe('MilestoneDocumentFeedbackService', () => {
  it('판정을 저장소가 준 순서대로 신청 ID·학생 서류 화면 주소와 함께 싣는다', async () => {
    const { service } = serviceWith([
      review(),
      review({
        id: 'review-0',
        decision: ReviewDecision.APPROVED,
        comment: null,
        reviewedAt: new Date('2026-09-19T01:00:00.000Z'),
        resubmissionDueAt: null,
      }),
    ]);

    const response = await service.recentForParticipant(34_290_200n);

    expect(response.items).toEqual([
      {
        id: 'review-1',
        decision: ReviewDecision.CHANGES_REQUESTED,
        comment: '표지를 보완해 주세요.',
        reviewedAt: '2026-09-20T01:00:00.000Z',
        resubmissionDueAt: '2026-09-27T14:59:00.000Z',
        applicationId: 'synthetic-application',
        programId: 'synthetic-program',
        milestoneId: 'seed:milestone',
        milestoneName: '중간 보고',
        itemName: '합성 계획서',
        href: '/programs/synthetic-program/documents?milestoneId=seed%3Amilestone',
      },
      expect.objectContaining({
        id: 'review-0',
        decision: ReviewDecision.APPROVED,
        comment: null,
        resubmissionDueAt: null,
      }),
    ]);
  });

  it.each([
    [
      '서울 0시 30분(UTC로는 전날)',
      '2026-09-20T15:30:00.000Z',
      '2026-09-13T15:00:00.000Z',
    ],
    ['서울 23시 59분', '2026-09-20T14:59:59.999Z', '2026-09-12T15:00:00.000Z'],
  ])(
    '%s에는 서울 날짜로 7일 전 0시부터의 판정을 읽는다',
    async (_label, now, reviewedSince) => {
      const { service, findRecentForParticipant } = serviceWith(
        [],
        new Date(now),
      );

      await service.recentForParticipant(34_290_204n);

      expect(findRecentForParticipant).toHaveBeenCalledWith(
        34_290_204n,
        new Date(reviewedSince),
      );
    },
  );

  it('옛 단일 제출 슬롯의 판정은 슬롯 이름 대신 지금 마일스톤 이름을 항목 이름으로 쓴다', async () => {
    const { service } = serviceWith([
      review({
        documentKind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
        documentName: '이관 당시 마일스톤 이름',
        milestoneName: '최종 보고',
      }),
    ]);

    const response = await service.recentForParticipant(34_290_201n);

    expect(response.items[0]?.itemName).toBe('최종 보고');
  });

  it('지금도 열려 있는 보완 요청에만 재제출 기한을 싣는다', async () => {
    const { service } = serviceWith([
      review({
        id: 'review-3',
        submissionId: 'submission-a',
        reviewedAt: new Date('2026-09-22T01:00:00.000Z'),
      }),
      review({
        id: 'review-2',
        submissionId: 'submission-b',
        submissionStatus: SubmissionStatus.SUBMITTED,
        reviewedAt: new Date('2026-09-21T01:00:00.000Z'),
      }),
      review({
        id: 'review-1',
        submissionId: 'submission-a',
        reviewedAt: new Date('2026-09-18T01:00:00.000Z'),
      }),
    ]);

    const response = await service.recentForParticipant(34_290_203n);

    expect(
      response.items.map((item) => [item.id, item.resubmissionDueAt]),
    ).toEqual([
      ['review-3', '2026-09-27T14:59:00.000Z'],
      ['review-2', null],
      ['review-1', null],
    ]);
  });

  it('응답 항목에 검토자 정보와 카드 제목이 이미 가진 프로그램 이름을 싣지 않는다', async () => {
    const { service } = serviceWith([
      {
        ...review(),
        reviewerId: 'synthetic-staff',
        reviewerNickname: 'synthetic-reviewer',
        programName: '합성 프로그램',
      } as RecentMilestoneDocumentReview,
    ]);

    const response = await service.recentForParticipant(34_290_202n);

    expect(Object.keys(response.items[0] ?? {}).sort()).toEqual([
      'applicationId',
      'comment',
      'decision',
      'href',
      'id',
      'itemName',
      'milestoneId',
      'milestoneName',
      'programId',
      'resubmissionDueAt',
      'reviewedAt',
    ]);
  });
});
