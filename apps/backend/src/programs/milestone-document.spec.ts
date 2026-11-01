import { ProgramScheduleService } from './program-schedule.service';
import { MilestoneDocumentSubmissionWindowService } from './milestone-document-submission-window.service';
import { MilestoneDocumentCollectionService } from './milestone-document-collection.service';
import { MilestoneDocumentsService } from './milestone-documents.service';
import { MilestoneDocumentReviewsService } from './milestone-document-reviews.service';
import {
  MilestoneSubmissionType,
  ReviewDecision,
  SubmissionStatus,
} from '@prisma/client';
import { MilestoneDocumentsErrorCode } from './milestone-documents-error-code.error';

const milestoneDocumentCollectionService =
  new MilestoneDocumentCollectionService({} as never);
const milestoneDocumentsService = new MilestoneDocumentsService(
  {} as never,
  new MilestoneDocumentSubmissionWindowService(new ProgramScheduleService()),
  new MilestoneDocumentCollectionService({} as never),
  new ProgramScheduleService(),
  {} as never,
);
const milestoneDocumentReviewsService = new MilestoneDocumentReviewsService(
  {} as never,
  {} as never,
);
const milestoneDocumentSubmissionWindowService =
  new MilestoneDocumentSubmissionWindowService(new ProgramScheduleService());

describe('document-delivery-status', () => {
  const dueAt = new Date('2026-08-14T12:00:00Z');
  const early = new Date('2026-08-14T11:00:00Z');
  const late = new Date('2026-08-14T12:00:00.001Z');

  describe('required-document delivery axis', () => {
    it.each([
      {
        label: 'no required items',
        dates: [],
        dueAt,
        expected: 'NO_REQUIRED_ITEMS',
      },
      {
        label: 'missing wins over another late submission',
        dates: [late, null],
        dueAt,
        expected: 'MISSING',
      },
      {
        label: 'late first submission',
        dates: [early, late],
        dueAt,
        expected: 'LATE',
      },
      {
        label: 'exact deadline is on time',
        dates: [dueAt],
        dueAt,
        expected: 'COMPLETE',
      },
      {
        label: 'on-time first submission remains complete',
        dates: [early],
        dueAt,
        expected: 'COMPLETE',
      },
      {
        label: 'no deadline cannot be late',
        dates: [late],
        dueAt: null,
        expected: 'COMPLETE',
      },
      {
        label: 'no deadline still needs a required submission',
        dates: [null],
        dueAt: null,
        expected: 'MISSING',
      },
    ])('$label', ({ dates, dueAt: deadline, expected }) => {
      const status = milestoneDocumentCollectionService.documentDeliveryStatus({
        requiredFirstSubmissions: dates,
        dueAt: deadline,
      });

      expect(status).toBe(expected);
    });
  });
});

describe('milestone-document-content', () => {
  describe('parseMilestoneDocumentContent', () => {
    it('내용만 제출할 수 있다', () => {
      expect(
        milestoneDocumentsService.parseMilestoneDocumentContent({
          text: '  진행 내용을 적었습니다.  ',
        }),
      ).toEqual({
        text: '진행 내용을 적었습니다.',
        fileId: null,
      });
    });

    it('파일만 제출할 수 있다', () => {
      expect(
        milestoneDocumentsService.parseMilestoneDocumentContent({
          fileId: '  synthetic-file-id  ',
        }),
      ).toEqual({
        text: null,
        fileId: 'synthetic-file-id',
      });
    });

    it('내용과 파일을 함께 제출할 수 있다', () => {
      expect(
        milestoneDocumentsService.parseMilestoneDocumentContent({
          text: '설명',
          fileId: 'synthetic-file-id',
        }),
      ).toEqual({ text: '설명', fileId: 'synthetic-file-id' });
    });

    it('내용과 파일이 모두 비어 있으면 거부한다', () => {
      try {
        milestoneDocumentsService.parseMilestoneDocumentContent({
          text: '  ',
          fileId: '  ',
        });
        throw new Error('빈 제출이 거부되지 않았습니다.');
      } catch (error: unknown) {
        expect(error).toMatchObject({
          errorCode: { code: MilestoneDocumentsErrorCode.CONTENT_REQUIRED },
        });
      }
    });

    it('기존 저장 TEXT 본문 모양은 계속 읽을 수 있다', () => {
      expect(
        milestoneDocumentCollectionService.readMilestoneDocumentSubmittedContent(
          {
            type: MilestoneSubmissionType.TEXT,
            text: '기존 본문',
          },
        ),
      ).toEqual({ type: MilestoneSubmissionType.TEXT, text: '기존 본문' });
    });
  });
});

describe('milestone-document-review', () => {
  describe('reviewDecisionToSubmissionStatus', () => {
    it.each([
      [ReviewDecision.APPROVED, SubmissionStatus.APPROVED],
      [ReviewDecision.CHANGES_REQUESTED, SubmissionStatus.CHANGES_REQUESTED],
      [ReviewDecision.REJECTED, SubmissionStatus.REJECTED],
    ])('%s는 제출 상태 %s에 대응한다', (decision, status) => {
      expect(
        milestoneDocumentReviewsService.reviewDecisionToSubmissionStatus(
          decision,
        ),
      ).toBe(status);
    });

    it('모든 판정 값에 대응 상태가 있다 — 빠진 값이 있으면 undefined가 새어 나간다', () => {
      const decisions = Object.values(ReviewDecision);

      const statuses = decisions.map((decision) =>
        milestoneDocumentReviewsService.reviewDecisionToSubmissionStatus(
          decision,
        ),
      );

      expect(statuses).toHaveLength(decisions.length);
      expect(statuses.every((status) => status !== undefined)).toBe(true);
    });
  });

  describe('isResubmissionAllowedAfter', () => {
    it('판정이 없으면 허용한다 — 첫 제출이거나 아직 아무도 보지 않았다', () => {
      expect(
        milestoneDocumentSubmissionWindowService.isResubmissionAllowedAfter(
          null,
        ),
      ).toBe(true);
    });

    it('보완 요청 뒤에는 허용한다 — 「다시 내라」는 뜻이다', () => {
      expect(
        milestoneDocumentSubmissionWindowService.isResubmissionAllowedAfter(
          ReviewDecision.CHANGES_REQUESTED,
        ),
      ).toBe(true);
    });

    it('승인 뒤에는 막는다 — 승인된 서류가 조용히 다른 내용으로 바뀌면 안 된다', () => {
      expect(
        milestoneDocumentSubmissionWindowService.isResubmissionAllowedAfter(
          ReviewDecision.APPROVED,
        ),
      ).toBe(false);
    });

    it('반려 뒤에는 막는다 — 끝난 판정이다', () => {
      expect(
        milestoneDocumentSubmissionWindowService.isResubmissionAllowedAfter(
          ReviewDecision.REJECTED,
        ),
      ).toBe(false);
    });
  });
});
