import { ReviewDecision, SubmissionStatus } from '@prisma/client';
import { MilestoneDocumentReviewsService } from './milestone-document-reviews.service';
import { MilestoneDocumentsErrorCode } from './domain/milestone-documents-error-code.enum';
import { MilestoneDocumentsRepository } from './repository/milestone-documents.repository';

const authority = {
  assertActiveStaff: jest
    .fn()
    .mockResolvedValue({ actorId: 'cuid-synthetic-staff' }),
};

const syntheticMilestoneId = 'cuid-synthetic-milestone';
const syntheticProgramId = 'cuid-synthetic-program';
const syntheticDocumentId = 'cuid-synthetic-document-1';
const syntheticApplicationId = 'cuid-synthetic-application';
const syntheticSubmissionId = 'cuid-synthetic-submission';
const syntheticSubmissionHistoryId = 'cuid-synthetic-submission-history';
const syntheticStaffId = 'cuid-synthetic-staff';
const reviewedAt = new Date('2026-09-18T09:00:00.000Z');

const seenRevision = 3;
const seenLatestReviewId = 'cuid-synthetic-review-seen';

const resubmissionDueAt = new Date('2026-09-25T09:00:00.000Z');

function buildRepository(overrides: Partial<Record<string, jest.Mock>> = {}) {
  const mocks = {
    findDocumentContext: jest.fn().mockResolvedValue({
      id: syntheticDocumentId,
      milestoneId: syntheticMilestoneId,
      programId: syntheticProgramId,
      name: '개인정보 수집·이용 동의서',
      dueAt: new Date('2026-09-19T09:00:00.000Z'),
      required: true,
    }),
    findApplicationProgramId: jest.fn().mockResolvedValue(syntheticProgramId),
    lockDocument: jest.fn().mockResolvedValue({
      id: syntheticDocumentId,
      milestoneId: syntheticMilestoneId,
    }),
    findSubmissionForReview: jest.fn().mockResolvedValue({
      id: syntheticSubmissionId,
      revision: seenRevision,
      submissionHistoryId: syntheticSubmissionHistoryId,
      latestHistoryCreatedAt: new Date('2026-09-17T09:00:00.000Z'),
    }),
    findLatestReviewIdForSubmission: jest
      .fn()
      .mockResolvedValue(seenLatestReviewId),
    createReview: jest.fn().mockResolvedValue({
      id: 'cuid-synthetic-review',
      decision: ReviewDecision.CHANGES_REQUESTED,
      comment: '2쪽 서명이 빠졌습니다.',
      reviewedAt,
      resubmissionDueAt,
      reviewerNickname: 'synthetic-staff',
    }),
    updateSubmissionStatus: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  const transactionCalls: string[] = [];

  const clock = jest.fn(() => {
    transactionCalls.push('now');
    return reviewedAt;
  });
  const withTransaction = jest.fn(
    (operation: (store: unknown) => Promise<unknown>) =>
      operation({
        lockDocument: (documentId: string): Promise<unknown> => {
          transactionCalls.push('lockDocument');
          return mocks.lockDocument(documentId) as Promise<unknown>;
        },
        findSubmissionForReview: (
          documentId: string,
          applicationId: string,
        ): Promise<unknown> => {
          transactionCalls.push('findSubmissionForReview');
          return mocks.findSubmissionForReview(
            documentId,
            applicationId,
          ) as Promise<unknown>;
        },
        findLatestReviewIdForSubmission: (
          submissionId: string,
        ): Promise<unknown> => {
          transactionCalls.push('findLatestReviewIdForSubmission');
          return mocks.findLatestReviewIdForSubmission(
            submissionId,
          ) as Promise<unknown>;
        },
        createReview: (input: unknown): Promise<unknown> => {
          transactionCalls.push('createReview');
          return mocks.createReview(input) as Promise<unknown>;
        },
        updateSubmissionStatus: (
          submissionId: string,
          status: SubmissionStatus,
        ): Promise<unknown> => {
          transactionCalls.push('updateSubmissionStatus');
          return mocks.updateSubmissionStatus(
            submissionId,
            status,
          ) as Promise<unknown>;
        },
      }),
  );

  return {
    mocks,
    transactionCalls,
    clock,
    withTransaction,
    repository: {
      ...mocks,
      withTransaction,
    } as unknown as MilestoneDocumentsRepository,
  };
}

function review(
  service: MilestoneDocumentReviewsService,
  clock: () => Date,
  decision: ReviewDecision = ReviewDecision.CHANGES_REQUESTED,
  comment: string | null = '2쪽 서명이 빠졌습니다.',
  version: {
    expectedRevision?: number;
    expectedLatestReviewId?: string | null;
    resubmissionDueAt?: Date | null;
  } = {},
) {
  return service.review(
    1n,
    syntheticMilestoneId,
    syntheticDocumentId,
    syntheticApplicationId,
    {
      decision,
      comment,
      resubmissionDueAt:
        version.resubmissionDueAt === undefined
          ? decision === ReviewDecision.CHANGES_REQUESTED
            ? resubmissionDueAt
            : null
          : version.resubmissionDueAt,
      expectedRevision: version.expectedRevision ?? seenRevision,
      expectedLatestReviewId:
        version.expectedLatestReviewId === undefined
          ? seenLatestReviewId
          : version.expectedLatestReviewId,
    },
    clock,
  );
}

describe('MilestoneDocumentReviewsService.review — 인가 사슬', () => {
  it('서류 항목이 없으면 DOCUMENT_NOT_FOUND를 던지고 아무것도 쓰지 않는다', async () => {
    const { mocks, clock, repository } = buildRepository({
      findDocumentContext: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentReviewsService(repository, authority);

    await expect(review(service, clock)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
    expect(mocks.createReview).not.toHaveBeenCalled();
  });

  it('서류 항목이 다른 마일스톤 소속이면 DOCUMENT_NOT_FOUND로 막는다', async () => {
    const { mocks, clock, repository } = buildRepository({
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: 'cuid-synthetic-other-milestone',
        programId: syntheticProgramId,
        name: '개인정보 수집·이용 동의서',
        dueAt: new Date('2026-09-19T09:00:00.000Z'),
        required: true,
      }),
    });
    const service = new MilestoneDocumentReviewsService(repository, authority);

    await expect(review(service, clock)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
    expect(mocks.createReview).not.toHaveBeenCalled();
  });

  it('신청이 이 마일스톤의 프로그램 소속이 아니면 SUBMISSION_NOT_FOUND로 막는다', async () => {
    const { mocks, clock, repository } = buildRepository({
      findApplicationProgramId: jest
        .fn()
        .mockResolvedValue('cuid-synthetic-other-program'),
    });
    const service = new MilestoneDocumentReviewsService(repository, authority);

    await expect(review(service, clock)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.SUBMISSION_NOT_FOUND },
    });
    expect(mocks.findSubmissionForReview).not.toHaveBeenCalled();
    expect(mocks.createReview).not.toHaveBeenCalled();
  });

  it('신청 자체가 없으면(programId가 null) 같은 코드로 막는다', async () => {
    const { mocks, clock, repository } = buildRepository({
      findApplicationProgramId: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentReviewsService(repository, authority);

    await expect(review(service, clock)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.SUBMISSION_NOT_FOUND },
    });
    expect(mocks.createReview).not.toHaveBeenCalled();
  });

  it('그 (서류, 신청) 제출이 없으면 SUBMISSION_NOT_FOUND로 막는다', async () => {
    const { mocks, clock, repository } = buildRepository({
      findSubmissionForReview: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentReviewsService(repository, authority);

    await expect(review(service, clock)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.SUBMISSION_NOT_FOUND },
    });
    expect(mocks.createReview).not.toHaveBeenCalled();
    expect(mocks.updateSubmissionStatus).not.toHaveBeenCalled();
  });

  it('잠금을 기다리는 사이 서류가 다른 마일스톤 것이 되면 잠금 뒤에 다시 막는다', async () => {
    const { mocks, clock, repository } = buildRepository({
      lockDocument: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: 'cuid-synthetic-other-milestone',
      }),
    });
    const service = new MilestoneDocumentReviewsService(repository, authority);

    await expect(review(service, clock)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
    expect(mocks.createReview).not.toHaveBeenCalled();
  });

  it('잠금을 기다리는 사이 서류 행이 사라졌으면 DOCUMENT_NOT_FOUND로 막는다', async () => {
    const { mocks, clock, repository } = buildRepository({
      lockDocument: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentReviewsService(repository, authority);

    await expect(review(service, clock)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
    expect(mocks.createReview).not.toHaveBeenCalled();
  });
});

describe('MilestoneDocumentReviewsService.review — 기대 버전 대조', () => {
  it('표를 그린 뒤 학생이 다시 냈으면 REVIEW_TARGET_CHANGED로 막는다 — 못 본 내용이 승인되지 않는다', async () => {
    const { mocks, clock, repository } = buildRepository({
      findSubmissionForReview: jest.fn().mockResolvedValue({
        id: syntheticSubmissionId,
        revision: seenRevision + 1,
      }),
    });
    const service = new MilestoneDocumentReviewsService(repository, authority);

    await expect(review(service, clock)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED },
    });
    expect(mocks.createReview).not.toHaveBeenCalled();
    expect(mocks.updateSubmissionStatus).not.toHaveBeenCalled();
  });

  it('같은 밀리초에 겹친 재제출도 막는다 — 시각이 아니라 리비전으로 대조하기 때문이다', async () => {
    const { mocks, clock, repository } = buildRepository({
      findSubmissionForReview: jest.fn().mockResolvedValue({
        id: syntheticSubmissionId,
        revision: seenRevision + 1,
      }),
    });
    const service = new MilestoneDocumentReviewsService(repository, authority);

    await expect(review(service, clock)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED },
    });
    expect(mocks.createReview).not.toHaveBeenCalled();
  });

  it('다른 교직원이 먼저 판정했으면 REVIEW_TARGET_CHANGED로 막는다 — 더 최신 판정을 덮지 않는다', async () => {
    const { mocks, clock, repository } = buildRepository({
      findLatestReviewIdForSubmission: jest
        .fn()
        .mockResolvedValue('cuid-synthetic-review-newer'),
    });
    const service = new MilestoneDocumentReviewsService(repository, authority);

    await expect(review(service, clock)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED },
    });
    expect(mocks.createReview).not.toHaveBeenCalled();
  });

  it('아직 판정이 없던 칸은 기대값 null로 통과한다', async () => {
    const { mocks, clock, repository } = buildRepository({
      findLatestReviewIdForSubmission: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentReviewsService(repository, authority);

    await review(service, clock, ReviewDecision.APPROVED, null, {
      expectedLatestReviewId: null,
    });

    expect(mocks.createReview).toHaveBeenCalledTimes(1);
  });

  it('판정이 없는데 기대값이 어떤 id를 가리키면 막는다 — 그 판정은 이 제출의 것이 아니다', async () => {
    const { mocks, clock, repository } = buildRepository({
      findLatestReviewIdForSubmission: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentReviewsService(repository, authority);

    await expect(review(service, clock)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED },
    });
    expect(mocks.createReview).not.toHaveBeenCalled();
  });

  it('최신 판정은 잠금 아래에서 그 제출 id로 다시 읽는다', async () => {
    const { mocks, transactionCalls, clock, repository } = buildRepository();
    const service = new MilestoneDocumentReviewsService(repository, authority);

    await review(service, clock);

    expect(mocks.findLatestReviewIdForSubmission).toHaveBeenCalledWith(
      syntheticSubmissionId,
    );
    expect(
      transactionCalls.indexOf('findLatestReviewIdForSubmission'),
    ).toBeGreaterThan(transactionCalls.indexOf('lockDocument'));
    expect(
      transactionCalls.indexOf('findLatestReviewIdForSubmission'),
    ).toBeLessThan(transactionCalls.indexOf('createReview'));
  });

  it('대조에 쓰는 제출 리비전은 잠금 아래에서 읽는다', async () => {
    const { transactionCalls, clock, repository } = buildRepository();
    const service = new MilestoneDocumentReviewsService(repository, authority);

    await review(service, clock);

    expect(transactionCalls.indexOf('findSubmissionForReview')).toBeGreaterThan(
      transactionCalls.indexOf('lockDocument'),
    );
    expect(transactionCalls.indexOf('findSubmissionForReview')).toBeLessThan(
      transactionCalls.indexOf('createReview'),
    );
  });

  it('제출 버전이 어긋나면 최신 판정은 읽어 보지도 않는다 — 첫 어긋남에서 멈춘다', async () => {
    const { mocks, clock, repository } = buildRepository({
      findSubmissionForReview: jest.fn().mockResolvedValue({
        id: syntheticSubmissionId,
        revision: seenRevision + 1,
      }),
    });
    const service = new MilestoneDocumentReviewsService(repository, authority);

    await expect(review(service, clock)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED },
    });
    expect(mocks.findLatestReviewIdForSubmission).not.toHaveBeenCalled();
  });
});

describe('MilestoneDocumentReviewsService.review — 잠금과 트랜잭션', () => {
  it('서류 행을 잠근 뒤에야 제출을 찾고 판정을 쌓고 상태를 옮긴다 — 한 트랜잭션 안이다', async () => {
    const { transactionCalls, clock, withTransaction, repository } =
      buildRepository();
    const service = new MilestoneDocumentReviewsService(repository, authority);

    await review(service, clock);

    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(transactionCalls).toEqual([
      'lockDocument',
      'findSubmissionForReview',
      'findLatestReviewIdForSubmission',
      'now',
      'createReview',
      'updateSubmissionStatus',
    ]);
  });

  it('판정 시각은 잠금을 얻은 뒤에 찍는다 — 커밋 순서와 reviewedAt 순서를 맞춘다', async () => {
    const { transactionCalls, clock, repository } = buildRepository();
    const service = new MilestoneDocumentReviewsService(repository, authority);

    await review(service, clock);

    expect(clock).toHaveBeenCalledTimes(1);
    expect(transactionCalls.indexOf('now')).toBeGreaterThan(
      transactionCalls.indexOf('lockDocument'),
    );
    expect(transactionCalls.indexOf('now')).toBeLessThan(
      transactionCalls.indexOf('createReview'),
    );
  });

  it('잠금 뒤 재확인에서 막히면 시각을 아예 찍지 않는다', async () => {
    const { clock, repository } = buildRepository({
      lockDocument: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentReviewsService(repository, authority);

    await expect(review(service, clock)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
    expect(clock).not.toHaveBeenCalled();
  });

  it('잠그는 대상은 판정 대상 서류 항목이다 — 전역 잠금 순서의 마지막 하나만 잡는다', async () => {
    const { mocks, clock, repository } = buildRepository();
    const service = new MilestoneDocumentReviewsService(repository, authority);

    await review(service, clock);

    expect(mocks.lockDocument).toHaveBeenCalledWith(syntheticDocumentId);
  });

  it('제출은 (서류, 신청) 짝으로 찾는다 — 경로의 신청 id를 그대로 쓴다', async () => {
    const { mocks, clock, repository } = buildRepository();
    const service = new MilestoneDocumentReviewsService(repository, authority);

    await review(service, clock);

    expect(mocks.findSubmissionForReview).toHaveBeenCalledWith(
      syntheticDocumentId,
      syntheticApplicationId,
    );
  });

  it('직전 원장 사건과 같은 시각의 판정은 1ms 뒤로 저장한다', async () => {
    const latest = new Date('2026-09-18T09:00:00.000Z');
    const { mocks, repository } = buildRepository({
      findSubmissionForReview: jest.fn().mockResolvedValue({
        id: syntheticSubmissionId,
        revision: seenRevision,
        submissionHistoryId: syntheticSubmissionHistoryId,
        latestHistoryCreatedAt: latest,
      }),
    });
    const service = new MilestoneDocumentReviewsService(repository, authority);

    await review(service, () => latest);

    expect(mocks.createReview).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewedAt: new Date('2026-09-18T09:00:00.001Z'),
      }),
    );
  });
});

describe('MilestoneDocumentReviewsService.review — 판정 저장과 응답', () => {
  it('판정자·사유·시각을 그대로 쌓고 판정자 nickname까지 실어 돌려준다', async () => {
    const { mocks, clock, repository } = buildRepository();
    const service = new MilestoneDocumentReviewsService(repository, authority);

    const result = await review(service, clock);

    expect(mocks.createReview).toHaveBeenCalledWith({
      milestoneDocumentSubmissionId: syntheticSubmissionId,
      submissionHistoryId: syntheticSubmissionHistoryId,
      revision: seenRevision,
      reviewerId: syntheticStaffId,
      decision: ReviewDecision.CHANGES_REQUESTED,
      comment: '2쪽 서명이 빠졌습니다.',
      resubmissionDueAt,
      reviewedAt,
    });
    expect(result).toEqual({
      id: 'cuid-synthetic-review',
      decision: ReviewDecision.CHANGES_REQUESTED,
      comment: '2쪽 서명이 빠졌습니다.',
      reviewedAt: reviewedAt.toISOString(),
      resubmissionDueAt: resubmissionDueAt.toISOString(),
      reviewerNickname: 'synthetic-staff',
    });
  });

  it('판정 시각보다 이르거나 같은 기한은 422로 거절하고 아무것도 쓰지 않는다', async () => {
    const { mocks, clock, repository } = buildRepository();
    const service = new MilestoneDocumentReviewsService(repository, authority);

    for (const dueAt of [
      new Date(reviewedAt.getTime() - 1),
      new Date(reviewedAt.getTime()),
    ]) {
      await expect(
        review(
          service,
          clock,
          ReviewDecision.CHANGES_REQUESTED,
          '고쳐 주세요.',
          {
            resubmissionDueAt: dueAt,
          },
        ),
      ).rejects.toMatchObject({
        errorCode: {
          code: MilestoneDocumentsErrorCode.RESUBMISSION_DUE_AT_NOT_FUTURE,
        },
      });
    }
    expect(mocks.createReview).not.toHaveBeenCalled();
    expect(mocks.updateSubmissionStatus).not.toHaveBeenCalled();
  });

  it('승인은 사유 없이도 저장된다 — comment가 null로 들어간다', async () => {
    const { mocks, clock, repository } = buildRepository();
    const service = new MilestoneDocumentReviewsService(repository, authority);

    await review(service, clock, ReviewDecision.APPROVED, null);

    expect(mocks.createReview).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: ReviewDecision.APPROVED,
        comment: null,

        resubmissionDueAt: null,
      }),
    );
  });
});

describe('MilestoneDocumentReviewsService.review — 판정 → 제출 상태', () => {
  it.each([
    [ReviewDecision.APPROVED, SubmissionStatus.APPROVED],
    [ReviewDecision.CHANGES_REQUESTED, SubmissionStatus.CHANGES_REQUESTED],
    [ReviewDecision.REJECTED, SubmissionStatus.REJECTED],
  ])('%s 판정은 제출 상태를 %s로 옮긴다', async (decision, status) => {
    const { mocks, clock, repository } = buildRepository();
    const service = new MilestoneDocumentReviewsService(repository, authority);

    await review(service, clock, decision, '사유');

    expect(mocks.updateSubmissionStatus).toHaveBeenCalledWith(
      syntheticSubmissionId,
      status,
    );
  });
});
