import { ReviewDecision, SubmissionStatus } from '@prisma/client';
import { MilestoneDocumentReviewsService } from './milestone-document-reviews.service';
import { MilestoneDocumentsErrorCode } from './milestone-documents-error-code.enum';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';

// 합성 데이터만 사용한다 (docs/rules/security.md)
const syntheticMilestoneId = 'cuid-synthetic-milestone';
const syntheticProgramId = 'cuid-synthetic-program';
const syntheticDocumentId = 'cuid-synthetic-document-1';
const syntheticApplicationId = 'cuid-synthetic-application';
const syntheticSubmissionId = 'cuid-synthetic-submission';
const syntheticStaffId = 'cuid-synthetic-staff';
const reviewedAt = new Date('2026-09-18T09:00:00.000Z');
/** 교직원이 수합 표에서 **본** 제출 버전. 요청이 이 값을 그대로 들고 온다. */
const seenSubmittedAt = new Date('2026-09-16T14:22:00.000Z');
const seenLatestReviewId = 'cuid-synthetic-review-seen';

function buildRepository(overrides: Partial<Record<string, jest.Mock>> = {}) {
  const mocks = {
    findDocumentContext: jest.fn().mockResolvedValue({
      id: syntheticDocumentId,
      milestoneId: syntheticMilestoneId,
      programId: syntheticProgramId,
      name: '개인정보 수집·이용 동의서',
      dueAt: new Date('2026-09-19T09:00:00.000Z'),
      required: true,
      submissionType: 'FILE',
    }),
    findApplicationProgramId: jest.fn().mockResolvedValue(syntheticProgramId),
    lockDocument: jest.fn().mockResolvedValue({
      id: syntheticDocumentId,
      milestoneId: syntheticMilestoneId,
      submissionType: 'FILE',
    }),
    findSubmissionForReview: jest.fn().mockResolvedValue({
      id: syntheticSubmissionId,
      submittedAt: seenSubmittedAt,
    }),
    findLatestReviewIdForSubmission: jest
      .fn()
      .mockResolvedValue(seenLatestReviewId),
    createReview: jest.fn().mockResolvedValue({
      id: 'cuid-synthetic-review',
      decision: ReviewDecision.CHANGES_REQUESTED,
      comment: '2쪽 서명이 빠졌습니다.',
      reviewedAt,
      reviewerNickname: 'synthetic-staff',
    }),
    updateSubmissionStatus: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  /**
   * store를 거쳐 나간 문장만 순서대로 쌓는다. 「잠근 뒤에 찾는다」·「판정과 상태 갱신이 한
   * 트랜잭션이다」 같은 요구는 호출 횟수가 아니라 이 순서 기록으로만 드러난다.
   */
  const transactionCalls: string[] = [];
  /**
   * 판정 시각을 찍는 순간도 같은 기록에 남긴다 — 「잠금을 얻은 뒤에 찍는다」는 값이 아니라
   * **순서**로만 드러나기 때문이다. 시각을 미리 찍어 두면 잠금을 늦게 얻은 요청이 옛 시각을
   * 들고 마지막에 커밋해, `status`가 가리키는 판정과 「최신 판정」 조회 결과가 갈린다.
   */
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
    expectedSubmittedAt?: Date;
    expectedLatestReviewId?: string | null;
  } = {},
) {
  return service.review(
    syntheticStaffId,
    syntheticMilestoneId,
    syntheticDocumentId,
    syntheticApplicationId,
    {
      decision,
      comment,
      expectedSubmittedAt: version.expectedSubmittedAt ?? seenSubmittedAt,
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
    // Given
    const { mocks, clock, repository } = buildRepository({
      findDocumentContext: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentReviewsService(repository);

    // When / Then
    await expect(review(service, clock)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
    expect(mocks.createReview).not.toHaveBeenCalled();
  });

  it('서류 항목이 다른 마일스톤 소속이면 DOCUMENT_NOT_FOUND로 막는다', async () => {
    // Given: 경로의 milestoneId와 서류의 실제 소속이 다르다.
    const { mocks, clock, repository } = buildRepository({
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: 'cuid-synthetic-other-milestone',
        programId: syntheticProgramId,
        name: '개인정보 수집·이용 동의서',
        dueAt: new Date('2026-09-19T09:00:00.000Z'),
        required: true,
        submissionType: 'FILE',
      }),
    });
    const service = new MilestoneDocumentReviewsService(repository);

    // When / Then
    await expect(review(service, clock)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
    expect(mocks.createReview).not.toHaveBeenCalled();
  });

  it('신청이 이 마일스톤의 프로그램 소속이 아니면 SUBMISSION_NOT_FOUND로 막는다', async () => {
    // Given: 가드는 역할만 보므로, 경로를 위조해 남의 프로그램 제출을 판정하려는 시도를
    // 이 단계가 막는다. 그것이 이 검사가 존재하는 유일한 이유다.
    const { mocks, clock, repository } = buildRepository({
      findApplicationProgramId: jest
        .fn()
        .mockResolvedValue('cuid-synthetic-other-program'),
    });
    const service = new MilestoneDocumentReviewsService(repository);

    // When / Then
    await expect(review(service, clock)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.SUBMISSION_NOT_FOUND },
    });
    expect(mocks.findSubmissionForReview).not.toHaveBeenCalled();
    expect(mocks.createReview).not.toHaveBeenCalled();
  });

  it('신청 자체가 없으면(programId가 null) 같은 코드로 막는다', async () => {
    // Given
    const { mocks, clock, repository } = buildRepository({
      findApplicationProgramId: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentReviewsService(repository);

    // When / Then
    await expect(review(service, clock)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.SUBMISSION_NOT_FOUND },
    });
    expect(mocks.createReview).not.toHaveBeenCalled();
  });

  it('그 (서류, 신청) 제출이 없으면 SUBMISSION_NOT_FOUND로 막는다', async () => {
    // Given: 아직 아무것도 내지 않은 팀을 판정할 수는 없다.
    const { mocks, clock, repository } = buildRepository({
      findSubmissionForReview: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentReviewsService(repository);

    // When / Then
    await expect(review(service, clock)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.SUBMISSION_NOT_FOUND },
    });
    expect(mocks.createReview).not.toHaveBeenCalled();
    expect(mocks.updateSubmissionStatus).not.toHaveBeenCalled();
  });

  it('잠금을 기다리는 사이 서류가 다른 마일스톤 것이 되면 잠금 뒤에 다시 막는다', async () => {
    // Given: 트랜잭션 밖 조회는 통과했는데 잠근 뒤 다시 읽은 값이 다르다.
    const { mocks, clock, repository } = buildRepository({
      lockDocument: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: 'cuid-synthetic-other-milestone',
        submissionType: 'FILE',
      }),
    });
    const service = new MilestoneDocumentReviewsService(repository);

    // When / Then
    await expect(review(service, clock)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
    expect(mocks.createReview).not.toHaveBeenCalled();
  });

  it('잠금을 기다리는 사이 서류 행이 사라졌으면 DOCUMENT_NOT_FOUND로 막는다', async () => {
    // Given
    const { mocks, clock, repository } = buildRepository({
      lockDocument: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentReviewsService(repository);

    // When / Then
    await expect(review(service, clock)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
    expect(mocks.createReview).not.toHaveBeenCalled();
  });
});

describe('MilestoneDocumentReviewsService.review — 기대 버전 대조', () => {
  it('표를 그린 뒤 학생이 다시 냈으면 REVIEW_TARGET_CHANGED로 막는다 — 못 본 내용이 승인되지 않는다', async () => {
    // Given: 잠금 아래에서 읽은 제출의 submittedAt이 교직원이 본 값과 다르다. 잠금만으로는
    // 이것을 알 수 없다 — 잠금은 순서를 세울 뿐 「내가 본 그 버전인가」에 답하지 못한다.
    // 이 대조가 없으면 교직원이 읽어 보지도 못한 제출이 승인된다.
    const { mocks, clock, repository } = buildRepository({
      findSubmissionForReview: jest.fn().mockResolvedValue({
        id: syntheticSubmissionId,
        submittedAt: new Date('2026-09-17T08:00:00.000Z'),
      }),
    });
    const service = new MilestoneDocumentReviewsService(repository);

    // When / Then
    await expect(review(service, clock)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED },
    });
    expect(mocks.createReview).not.toHaveBeenCalled();
    expect(mocks.updateSubmissionStatus).not.toHaveBeenCalled();
  });

  it('다른 교직원이 먼저 판정했으면 REVIEW_TARGET_CHANGED로 막는다 — 더 최신 판정을 덮지 않는다', async () => {
    // Given: 제출은 그대로인데(재제출이 없었다) 판정 이력에만 새 행이 붙었다. submittedAt만
    // 보면 이 사건은 그대로 통과한다 — 그래서 두 값을 함께 본다.
    const { mocks, clock, repository } = buildRepository({
      findLatestReviewIdForSubmission: jest
        .fn()
        .mockResolvedValue('cuid-synthetic-review-newer'),
    });
    const service = new MilestoneDocumentReviewsService(repository);

    // When / Then
    await expect(review(service, clock)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED },
    });
    expect(mocks.createReview).not.toHaveBeenCalled();
  });

  it('아직 판정이 없던 칸은 기대값 null로 통과한다', async () => {
    // Given: 첫 판정이다. 「판정 없음」을 null로 명시해 보내고 서버도 null을 읽는다.
    const { mocks, clock, repository } = buildRepository({
      findLatestReviewIdForSubmission: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentReviewsService(repository);

    // When
    await review(service, clock, ReviewDecision.APPROVED, null, {
      expectedLatestReviewId: null,
    });

    // Then
    expect(mocks.createReview).toHaveBeenCalledTimes(1);
  });

  it('판정이 없는데 기대값이 어떤 id를 가리키면 막는다 — 그 판정은 이 제출의 것이 아니다', async () => {
    // Given: 화면이 다른 칸의 판정 id를 실어 보냈거나 표가 어긋났다.
    const { mocks, clock, repository } = buildRepository({
      findLatestReviewIdForSubmission: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentReviewsService(repository);

    // When / Then
    await expect(review(service, clock)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED },
    });
    expect(mocks.createReview).not.toHaveBeenCalled();
  });

  it('최신 판정은 잠금 아래에서 그 제출 id로 다시 읽는다', async () => {
    // Given: 트랜잭션 밖에서 읽으면 읽은 뒤에 커밋되는 판정을 그대로 놓친다 — 지금 고치려는
    // 문제가 검사만 붙인 채 그대로 남는다.
    const { mocks, transactionCalls, clock, repository } = buildRepository();
    const service = new MilestoneDocumentReviewsService(repository);

    // When
    await review(service, clock);

    // Then
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

  it('제출 버전이 어긋나면 최신 판정은 읽어 보지도 않는다 — 첫 어긋남에서 멈춘다', async () => {
    // Given
    const { mocks, clock, repository } = buildRepository({
      findSubmissionForReview: jest.fn().mockResolvedValue({
        id: syntheticSubmissionId,
        submittedAt: new Date('2026-09-17T08:00:00.000Z'),
      }),
    });
    const service = new MilestoneDocumentReviewsService(repository);

    // When / Then
    await expect(review(service, clock)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED },
    });
    expect(mocks.findLatestReviewIdForSubmission).not.toHaveBeenCalled();
  });
});

describe('MilestoneDocumentReviewsService.review — 잠금과 트랜잭션', () => {
  it('서류 행을 잠근 뒤에야 제출을 찾고 판정을 쌓고 상태를 옮긴다 — 한 트랜잭션 안이다', async () => {
    // Given: 잠금이 없으면 방금 교체된 제출에 판정이 붙고, 학생 쪽은 그 판정을 못 본 채
    // 재제출이 통과한다. 순서 기록이 비면 그 문장이 트랜잭션 밖으로 샌 것이다.
    const { transactionCalls, clock, withTransaction, repository } =
      buildRepository();
    const service = new MilestoneDocumentReviewsService(repository);

    // When
    await review(service, clock);

    // Then
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(transactionCalls).toEqual([
      'lockDocument',
      'now',
      'findSubmissionForReview',
      'findLatestReviewIdForSubmission',
      'createReview',
      'updateSubmissionStatus',
    ]);
  });

  it('판정 시각은 잠금을 얻은 뒤에 찍는다 — 커밋 순서와 reviewedAt 순서를 맞춘다', async () => {
    // Given: 두 교직원의 판정이 겹치면 잠금이 둘을 한 줄로 세운다. 시각을 잠금 전에 찍으면
    // 먼저 시작했지만 잠금을 늦게 얻은 요청이 **옛 시각**을 들고 마지막에 커밋한다. 그러면
    // 제출 상태는 마지막 커밋을 반영하는데 「최신 판정」 조회(reviewedAt DESC)는 다른 판정을
    // 골라, 배지·사유·재제출 규칙이 서로 다른 판정을 근거로 삼는다.
    const { transactionCalls, clock, repository } = buildRepository();
    const service = new MilestoneDocumentReviewsService(repository);

    // When
    await review(service, clock);

    // Then: 잠금 뒤, 판정을 쓰기 전에 딱 한 번 찍는다.
    expect(clock).toHaveBeenCalledTimes(1);
    expect(transactionCalls.indexOf('now')).toBeGreaterThan(
      transactionCalls.indexOf('lockDocument'),
    );
    expect(transactionCalls.indexOf('now')).toBeLessThan(
      transactionCalls.indexOf('createReview'),
    );
  });

  it('잠금 뒤 재확인에서 막히면 시각을 아예 찍지 않는다', async () => {
    // Given: 잠금을 기다리는 사이 서류 행이 사라졌다. 시각이 잠금 전에 찍혔다면 이 경로에서도
    // 이미 찍혀 있을 것이다 — 그것이 곧 「잠금 전에 찍었다」는 증거다.
    const { clock, repository } = buildRepository({
      lockDocument: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentReviewsService(repository);

    // When / Then
    await expect(review(service, clock)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
    expect(clock).not.toHaveBeenCalled();
  });

  it('잠그는 대상은 판정 대상 서류 항목이다 — 전역 잠금 순서의 마지막 하나만 잡는다', async () => {
    // Given: 서류 항목의 집합을 바꾸지 않으므로 마일스톤 행까지 잡지 않는다.
    const { mocks, clock, repository } = buildRepository();
    const service = new MilestoneDocumentReviewsService(repository);

    // When
    await review(service, clock);

    // Then
    expect(mocks.lockDocument).toHaveBeenCalledWith(syntheticDocumentId);
  });

  it('제출은 (서류, 신청) 짝으로 찾는다 — 경로의 신청 id를 그대로 쓴다', async () => {
    // Given
    const { mocks, clock, repository } = buildRepository();
    const service = new MilestoneDocumentReviewsService(repository);

    // When
    await review(service, clock);

    // Then
    expect(mocks.findSubmissionForReview).toHaveBeenCalledWith(
      syntheticDocumentId,
      syntheticApplicationId,
    );
  });
});

describe('MilestoneDocumentReviewsService.review — 판정 저장과 응답', () => {
  it('판정자·사유·시각을 그대로 쌓고 판정자 nickname까지 실어 돌려준다', async () => {
    // Given
    const { mocks, clock, repository } = buildRepository();
    const service = new MilestoneDocumentReviewsService(repository);

    // When
    const result = await review(service, clock);

    // Then
    expect(mocks.createReview).toHaveBeenCalledWith({
      milestoneDocumentSubmissionId: syntheticSubmissionId,
      reviewerId: syntheticStaffId,
      decision: ReviewDecision.CHANGES_REQUESTED,
      comment: '2쪽 서명이 빠졌습니다.',
      reviewedAt,
    });
    expect(result).toEqual({
      id: 'cuid-synthetic-review',
      decision: ReviewDecision.CHANGES_REQUESTED,
      comment: '2쪽 서명이 빠졌습니다.',
      reviewedAt: reviewedAt.toISOString(),
      reviewerNickname: 'synthetic-staff',
    });
  });

  it('승인은 사유 없이도 저장된다 — comment가 null로 들어간다', async () => {
    // Given
    const { mocks, clock, repository } = buildRepository();
    const service = new MilestoneDocumentReviewsService(repository);

    // When
    await review(service, clock, ReviewDecision.APPROVED, null);

    // Then
    expect(mocks.createReview).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: ReviewDecision.APPROVED,
        comment: null,
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
    // Given: 옛 제출물 판정(submission-reviews)의 매핑 표와 같아야 한다.
    const { mocks, clock, repository } = buildRepository();
    const service = new MilestoneDocumentReviewsService(repository);

    // When
    await review(service, clock, decision, '사유');

    // Then
    expect(mocks.updateSubmissionStatus).toHaveBeenCalledWith(
      syntheticSubmissionId,
      status,
    );
  });
});
