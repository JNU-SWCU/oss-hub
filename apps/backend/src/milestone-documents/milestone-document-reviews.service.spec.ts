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
    findSubmissionForReview: jest
      .fn()
      .mockResolvedValue({ id: syntheticSubmissionId }),
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
    withTransaction,
    repository: {
      ...mocks,
      withTransaction,
    } as unknown as MilestoneDocumentsRepository,
  };
}

function review(
  service: MilestoneDocumentReviewsService,
  decision: ReviewDecision = ReviewDecision.CHANGES_REQUESTED,
  comment: string | null = '2쪽 서명이 빠졌습니다.',
) {
  return service.review(
    syntheticStaffId,
    syntheticMilestoneId,
    syntheticDocumentId,
    syntheticApplicationId,
    { decision, comment },
    reviewedAt,
  );
}

describe('MilestoneDocumentReviewsService.review — 인가 사슬', () => {
  it('서류 항목이 없으면 DOCUMENT_NOT_FOUND를 던지고 아무것도 쓰지 않는다', async () => {
    // Given
    const { mocks, repository } = buildRepository({
      findDocumentContext: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentReviewsService(repository);

    // When / Then
    await expect(review(service)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
    expect(mocks.createReview).not.toHaveBeenCalled();
  });

  it('서류 항목이 다른 마일스톤 소속이면 DOCUMENT_NOT_FOUND로 막는다', async () => {
    // Given: 경로의 milestoneId와 서류의 실제 소속이 다르다.
    const { mocks, repository } = buildRepository({
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
    await expect(review(service)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
    expect(mocks.createReview).not.toHaveBeenCalled();
  });

  it('신청이 이 마일스톤의 프로그램 소속이 아니면 SUBMISSION_NOT_FOUND로 막는다', async () => {
    // Given: 가드는 역할만 보므로, 경로를 위조해 남의 프로그램 제출을 판정하려는 시도를
    // 이 단계가 막는다. 그것이 이 검사가 존재하는 유일한 이유다.
    const { mocks, repository } = buildRepository({
      findApplicationProgramId: jest
        .fn()
        .mockResolvedValue('cuid-synthetic-other-program'),
    });
    const service = new MilestoneDocumentReviewsService(repository);

    // When / Then
    await expect(review(service)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.SUBMISSION_NOT_FOUND },
    });
    expect(mocks.findSubmissionForReview).not.toHaveBeenCalled();
    expect(mocks.createReview).not.toHaveBeenCalled();
  });

  it('신청 자체가 없으면(programId가 null) 같은 코드로 막는다', async () => {
    // Given
    const { mocks, repository } = buildRepository({
      findApplicationProgramId: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentReviewsService(repository);

    // When / Then
    await expect(review(service)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.SUBMISSION_NOT_FOUND },
    });
    expect(mocks.createReview).not.toHaveBeenCalled();
  });

  it('그 (서류, 신청) 제출이 없으면 SUBMISSION_NOT_FOUND로 막는다', async () => {
    // Given: 아직 아무것도 내지 않은 팀을 판정할 수는 없다.
    const { mocks, repository } = buildRepository({
      findSubmissionForReview: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentReviewsService(repository);

    // When / Then
    await expect(review(service)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.SUBMISSION_NOT_FOUND },
    });
    expect(mocks.createReview).not.toHaveBeenCalled();
    expect(mocks.updateSubmissionStatus).not.toHaveBeenCalled();
  });

  it('잠금을 기다리는 사이 서류가 다른 마일스톤 것이 되면 잠금 뒤에 다시 막는다', async () => {
    // Given: 트랜잭션 밖 조회는 통과했는데 잠근 뒤 다시 읽은 값이 다르다.
    const { mocks, repository } = buildRepository({
      lockDocument: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: 'cuid-synthetic-other-milestone',
        submissionType: 'FILE',
      }),
    });
    const service = new MilestoneDocumentReviewsService(repository);

    // When / Then
    await expect(review(service)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
    expect(mocks.createReview).not.toHaveBeenCalled();
  });

  it('잠금을 기다리는 사이 서류 행이 사라졌으면 DOCUMENT_NOT_FOUND로 막는다', async () => {
    // Given
    const { mocks, repository } = buildRepository({
      lockDocument: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentReviewsService(repository);

    // When / Then
    await expect(review(service)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
    expect(mocks.createReview).not.toHaveBeenCalled();
  });
});

describe('MilestoneDocumentReviewsService.review — 잠금과 트랜잭션', () => {
  it('서류 행을 잠근 뒤에야 제출을 찾고 판정을 쌓고 상태를 옮긴다 — 한 트랜잭션 안이다', async () => {
    // Given: 잠금이 없으면 방금 교체된 제출에 판정이 붙고, 학생 쪽은 그 판정을 못 본 채
    // 재제출이 통과한다. 순서 기록이 비면 그 문장이 트랜잭션 밖으로 샌 것이다.
    const { transactionCalls, withTransaction, repository } = buildRepository();
    const service = new MilestoneDocumentReviewsService(repository);

    // When
    await review(service);

    // Then
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(transactionCalls).toEqual([
      'lockDocument',
      'findSubmissionForReview',
      'createReview',
      'updateSubmissionStatus',
    ]);
  });

  it('잠그는 대상은 판정 대상 서류 항목이다 — 전역 잠금 순서의 마지막 하나만 잡는다', async () => {
    // Given: 서류 항목의 집합을 바꾸지 않으므로 마일스톤 행까지 잡지 않는다.
    const { mocks, repository } = buildRepository();
    const service = new MilestoneDocumentReviewsService(repository);

    // When
    await review(service);

    // Then
    expect(mocks.lockDocument).toHaveBeenCalledWith(syntheticDocumentId);
  });

  it('제출은 (서류, 신청) 짝으로 찾는다 — 경로의 신청 id를 그대로 쓴다', async () => {
    // Given
    const { mocks, repository } = buildRepository();
    const service = new MilestoneDocumentReviewsService(repository);

    // When
    await review(service);

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
    const { mocks, repository } = buildRepository();
    const service = new MilestoneDocumentReviewsService(repository);

    // When
    const result = await review(service);

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
    const { mocks, repository } = buildRepository();
    const service = new MilestoneDocumentReviewsService(repository);

    // When
    await review(service, ReviewDecision.APPROVED, null);

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
    const { mocks, repository } = buildRepository();
    const service = new MilestoneDocumentReviewsService(repository);

    // When
    await review(service, decision, '사유');

    // Then
    expect(mocks.updateSubmissionStatus).toHaveBeenCalledWith(
      syntheticSubmissionId,
      status,
    );
  });
});
