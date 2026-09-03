import {
  MilestoneDocumentSubmissionHistoryEvent,
  MilestoneSubmissionType,
  Prisma,
  ReviewDecision,
  SubmissionStatus,
} from '@prisma/client';
import type { MilestoneDocumentCollectionQuery } from './domain/milestone-document-collection-query';
import { MilestoneDocumentsErrorCode } from './milestone-documents-error-code.enum';
import {
  MilestoneDocumentDeadlineClosedError,
  MilestoneDocumentMissingError,
  MilestoneDocumentPendingFileMissingError,
  MilestoneDocumentReviewChangedError,
  MilestoneDocumentsRepository,
} from './milestone-documents.repository';
import { MilestoneDocumentsService } from './milestone-documents.service';

// 합성 데이터만 사용한다 (docs/rules/security.md)
const syntheticMilestoneId = 'cuid-synthetic-milestone';
const syntheticProgramId = 'cuid-synthetic-program';
const syntheticDocumentId = 'cuid-synthetic-document-1';
const syntheticUserId = 'cuid-synthetic-user';
const syntheticApplicationId = 'cuid-synthetic-application';

function baseDocument(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: syntheticDocumentId,
    milestoneId: syntheticMilestoneId,
    name: '개인정보 수집·이용 동의서',
    required: true,
    sortOrder: 1,
    templateFileId: null,
    ...overrides,
  };
}

/** 수합 조회 기본 쿼리 — 전체 필터, 1페이지, 기본 크기 20. */
function collectionQuery(
  overrides: Partial<MilestoneDocumentCollectionQuery> = {},
): MilestoneDocumentCollectionQuery {
  return { page: 1, pageSize: 20, filter: 'ALL', ...overrides };
}

function buildRepository(overrides: Partial<Record<string, jest.Mock>> = {}) {
  const mocks = {
    findMilestone: jest.fn().mockResolvedValue({
      id: syntheticMilestoneId,
      programId: syntheticProgramId,
      name: '프로젝트 계획서 제출',
      dueAt: new Date('2026-09-19T09:00:00.000Z'),
    }),
    findByMilestoneId: jest.fn().mockResolvedValue([baseDocument()]),
    findActiveUser: jest.fn().mockResolvedValue(null),
    countApprovedApplications: jest.fn().mockResolvedValue(0),
    countSubmissionsByDocument: jest.fn().mockResolvedValue(new Map()),
    findStudentApplication: jest.fn().mockResolvedValue(null),
    findSubmittedSummaries: jest.fn().mockResolvedValue([]),
    findApplicationProgramId: jest.fn().mockResolvedValue(null),
    findSubmissionHistoryPage: jest.fn().mockResolvedValue(null),
    // 기본은 「아직 아무도 판정하지 않았다」 — 그러면 재제출은 지금처럼 허용된다.
    findLatestReview: jest.fn().mockResolvedValue(null),
    findMySubmission: jest.fn().mockResolvedValue(null),
    findDocumentContext: jest.fn().mockResolvedValue({
      id: syntheticDocumentId,
      milestoneId: syntheticMilestoneId,
      programId: syntheticProgramId,
      name: '개인정보 수집·이용 동의서',
      dueAt: new Date('2026-09-19T09:00:00.000Z'),
      required: true,
    }),
    createDocument: jest.fn(),
    updateDocument: jest.fn(),
    lockMilestone: jest.fn().mockResolvedValue({ id: syntheticMilestoneId }),
    lockDocument: jest.fn().mockResolvedValue({
      id: syntheticDocumentId,
      milestoneId: syntheticMilestoneId,
    }),
    lockDocumentIdsOfMilestone: jest
      .fn()
      .mockResolvedValue([syntheticDocumentId]),
    applyDocumentOrder: jest.fn(),
    deleteDocument: jest.fn(),
    countSubmissionsForDocument: jest.fn().mockResolvedValue(0),
    upsertSubmission: jest.fn(),
    findApprovedApplicationsForCollection: jest.fn().mockResolvedValue([]),
    findSubmissionCoordinatesForCollection: jest.fn().mockResolvedValue([]),
    findSubmissionsForCollection: jest.fn().mockResolvedValue([]),
    ...overrides,
  };

  /**
   * store를 거쳐 나간 문장만 순서대로 쌓는다. 같은 jest 목을 리포지토리 직접 호출 경로와
   * 공유하므로, 「트랜잭션 밖에서 세고 안에서 갱신」 같은 변형은 호출 횟수가 아니라 이 순서
   * 기록이 비어 있는 것으로 드러난다.
   */
  const transactionCalls: string[] = [];
  const withTransaction = jest.fn(
    (operation: (store: unknown) => Promise<unknown>) =>
      operation({
        lockMilestone: (milestoneId: string): Promise<unknown> => {
          transactionCalls.push('lockMilestone');
          return mocks.lockMilestone(milestoneId) as Promise<unknown>;
        },
        lockDocument: (documentId: string): Promise<unknown> => {
          transactionCalls.push('lockDocument');
          return mocks.lockDocument(documentId) as Promise<unknown>;
        },
        lockDocumentIdsOfMilestone: (
          milestoneId: string,
        ): Promise<readonly string[]> => {
          transactionCalls.push('lockDocumentIdsOfMilestone');
          return mocks.lockDocumentIdsOfMilestone(milestoneId) as Promise<
            readonly string[]
          >;
        },
        countSubmissionsForDocument: (documentId: string): Promise<number> => {
          transactionCalls.push('countSubmissionsForDocument');
          return mocks.countSubmissionsForDocument(
            documentId,
          ) as Promise<number>;
        },
        createDocument: (
          milestoneId: string,
          input: unknown,
        ): Promise<unknown> => {
          transactionCalls.push('createDocument');
          return mocks.createDocument(milestoneId, input) as Promise<unknown>;
        },
        updateDocument: (
          documentId: string,
          input: unknown,
        ): Promise<unknown> => {
          transactionCalls.push('updateDocument');
          return mocks.updateDocument(documentId, input) as Promise<unknown>;
        },
        applyDocumentOrder: (
          milestoneId: string,
          documentIds: readonly string[],
        ): Promise<unknown> => {
          transactionCalls.push('applyDocumentOrder');
          return mocks.applyDocumentOrder(
            milestoneId,
            documentIds,
          ) as Promise<unknown>;
        },
        deleteDocument: (documentId: string): Promise<unknown> => {
          transactionCalls.push('deleteDocument');
          return mocks.deleteDocument(documentId) as Promise<unknown>;
        },
      }),
  );
  const withCollectionSnapshot = jest.fn(
    (operation: (store: unknown) => Promise<unknown>) =>
      operation({
        findMilestone: mocks.findMilestone,
        findByMilestoneId: mocks.findByMilestoneId,
        findApprovedApplicationsForCollection:
          mocks.findApprovedApplicationsForCollection,
        findSubmissionCoordinatesForCollection:
          mocks.findSubmissionCoordinatesForCollection,
        findSubmissionsForCollection: mocks.findSubmissionsForCollection,
      }),
  );

  return {
    mocks,
    transactionCalls,
    withTransaction,
    withCollectionSnapshot,
    repository: {
      ...mocks,
      withTransaction,
      withCollectionSnapshot,
    } as unknown as MilestoneDocumentsRepository,
  };
}

describe('MilestoneDocumentsService.listByMilestone', () => {
  it('milestoneId로 리포지토리를 조회해 그대로 반환한다', async () => {
    // Given
    const documents = [baseDocument()];
    const findByMilestoneId = jest.fn().mockResolvedValue(documents);
    const repository = {
      findByMilestoneId,
    } as unknown as MilestoneDocumentsRepository;
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.listByMilestone(syntheticMilestoneId);

    // Then
    expect(findByMilestoneId).toHaveBeenCalledWith(syntheticMilestoneId);
    expect(result).toBe(documents);
  });
});

describe('MilestoneDocumentsService.listForViewer', () => {
  it('마일스톤이 없으면 MILESTONE_NOT_FOUND를 던진다', async () => {
    // Given
    const { repository } = buildRepository({
      findMilestone: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.listForViewer(1n, syntheticMilestoneId),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND },
    });
  });

  it('교직원 viewer는 서류별 팀 제출 집계(teamSubmissionCount)를 채운다', async () => {
    // Given: 승인된 신청 8건 중 이 서류를 6건이 제출했다.
    const { repository, mocks } = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue({
        id: 'staff-1',
        hasStaffAccess: true,
        hasAdminAccess: false,
      }),
      countApprovedApplications: jest.fn().mockResolvedValue(8),
      countSubmissionsByDocument: jest
        .fn()
        .mockResolvedValue(new Map([[syntheticDocumentId, 6]])),
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.listForViewer(1n, syntheticMilestoneId);

    // Then
    expect(result).toEqual([
      expect.objectContaining({
        id: syntheticDocumentId,
        teamSubmissionCount: { submitted: 6, total: 8 },
      }),
    ]);
    expect(result[0]?.viewerSubmission).toBeUndefined();
    // 앞 수와 뒤 수는 같은 프로그램의 승인 신청 하나를 모집단으로 센다 — 두 조회가 같은
    // programId를 받는 것이 그 계약이다(#1100).
    expect(mocks.countApprovedApplications).toHaveBeenCalledWith(
      syntheticProgramId,
    );
    expect(mocks.countSubmissionsByDocument).toHaveBeenCalledWith(
      syntheticProgramId,
      [syntheticDocumentId],
    );
  });

  it('학생 viewer는 자기 신청의 제출 여부(viewerSubmission)를 채운다', async () => {
    // Given: 학생이 이 프로그램에 신청했고 서류를 이미 냈다.
    const submittedAt = new Date('2026-09-16T14:22:00.000Z');
    const { repository } = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue({
        id: syntheticUserId,
        hasStaffAccess: false,
        hasAdminAccess: false,
      }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: true,
        programEndAt: new Date('2026-12-31T00:00:00.000Z'),
      }),
      findSubmittedSummaries: jest.fn().mockResolvedValue([
        {
          milestoneDocumentId: syntheticDocumentId,
          submittedAt,
          revision: 2,
          status: SubmissionStatus.SUBMITTED,
          hasCurrentFile: true,
          currentFileName: '합성_제출본.pdf',
          historyComplete: false,
          review: null,
        },
      ]),
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.listForViewer(1n, syntheticMilestoneId);

    // Then
    expect(result).toEqual([
      expect.objectContaining({
        id: syntheticDocumentId,
        viewerSubmission: {
          submitted: true,
          submittedAt: submittedAt.toISOString(),
          revision: 2,
          status: SubmissionStatus.SUBMITTED,
          hasCurrentFile: true,
          currentFileName: '합성_제출본.pdf',
          review: null,
          history: { hasHistory: true, isComplete: false },
        },
      }),
    ]);
  });

  it('학생 viewer는 지금 붙어 있는 첨부의 이름을 함께 받는다 — 재제출 폼의 경고 재료다', async () => {
    // Given: 파일을 붙여 낸 뒤 아직 교직원이 판정하지 않은 제출.
    const { repository } = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue({
        id: syntheticUserId,
        hasStaffAccess: false,
        hasAdminAccess: false,
      }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: true,
        programEndAt: new Date('2026-12-31T00:00:00.000Z'),
      }),
      findSubmittedSummaries: jest.fn().mockResolvedValue([
        {
          milestoneDocumentId: syntheticDocumentId,
          submittedAt: new Date('2026-09-16T14:22:00.000Z'),
          revision: 1,
          status: SubmissionStatus.SUBMITTED,
          hasCurrentFile: true,
          currentFileName: '1차_계획서.pdf',
          historyComplete: true,
          review: null,
        },
      ]),
    });

    // When
    const result = await new MilestoneDocumentsService(repository).listForViewer(
      1n,
      syntheticMilestoneId,
    );

    // Then: 이름이 없으면 화면은 「무엇이 빠지는지」를 말할 수 없다.
    expect(result[0]?.viewerSubmission).toEqual(
      expect.objectContaining({
        hasCurrentFile: true,
        currentFileName: '1차_계획서.pdf',
      }),
    );
  });

  it('학생 viewer는 되돌아온 이유를 알도록 최신 판정의 사유·시각을 함께 받는다', async () => {
    // Given: 보완 요청을 받아 상태가 CHANGES_REQUESTED로 돌아온 서류.
    const submittedAt = new Date('2026-09-16T14:22:00.000Z');
    const reviewedAt = new Date('2026-09-18T09:00:00.000Z');
    const { repository } = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue({
        id: syntheticUserId,
        hasStaffAccess: false,
        hasAdminAccess: false,
      }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: true,
        programEndAt: new Date('2026-12-31T00:00:00.000Z'),
      }),
      findSubmittedSummaries: jest.fn().mockResolvedValue([
        {
          milestoneDocumentId: syntheticDocumentId,
          submittedAt,
          revision: 1,
          status: SubmissionStatus.CHANGES_REQUESTED,
          hasCurrentFile: false,
          currentFileName: null,
          historyComplete: true,
          review: {
            decision: ReviewDecision.CHANGES_REQUESTED,
            comment: '2쪽 서명이 빠졌습니다.',
            reviewedAt,
          },
        },
      ]),
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.listForViewer(1n, syntheticMilestoneId);

    // Then: 상태만으로는 무엇을 고쳐야 하는지 알 수 없다.
    expect(result[0]?.viewerSubmission).toEqual({
      submitted: true,
      submittedAt: submittedAt.toISOString(),
      revision: 1,
      status: SubmissionStatus.CHANGES_REQUESTED,
      hasCurrentFile: false,
      currentFileName: null,
      review: {
        comment: '2쪽 서명이 빠졌습니다.',
        reviewedAt: reviewedAt.toISOString(),
      },
      history: { hasHistory: true, isComplete: true },
    });
  });

  it('학생 viewer가 아직 신청하지 않았으면 미제출(submitted:false)로 채운다', async () => {
    // Given: 학생 계정이지만 이 프로그램에 신청한 이력이 없다.
    const { repository } = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue({
        id: syntheticUserId,
        hasStaffAccess: false,
        hasAdminAccess: false,
      }),
      findStudentApplication: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.listForViewer(1n, syntheticMilestoneId);

    // Then: 에러가 아니라 viewer 필드 없는 기본 목록만 돌려준다.
    expect(result).toEqual([
      expect.objectContaining({ id: syntheticDocumentId }),
    ]);
    expect(result[0]?.viewerSubmission).toBeUndefined();
    expect(result[0]?.teamSubmissionCount).toBeUndefined();
  });

  it('세션 계정을 찾지 못하면 viewer 필드 없이 기본 목록만 돌려준다', async () => {
    // Given: findActiveUser가 null(비활성/미존재 계정)을 돌려준다.
    const { repository } = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.listForViewer(1n, syntheticMilestoneId);

    // Then
    expect(result).toEqual([
      expect.objectContaining({ id: syntheticDocumentId }),
    ]);
    expect(result[0]?.viewerSubmission).toBeUndefined();
    expect(result[0]?.teamSubmissionCount).toBeUndefined();
  });
});

describe('MilestoneDocumentsService CRUD (교직원)', () => {
  it('createDocument는 마일스톤을 잠근 뒤 추가하고 sortOrder를 그대로 넘긴다', async () => {
    // Given: 생성은 순서를 처음 정하는 쪽이라 요청 값을 그대로 쓴다.
    const created = baseDocument({ id: 'cuid-synthetic-document-new' });
    const { mocks, transactionCalls, repository } = buildRepository({
      createDocument: jest.fn().mockResolvedValue(created),
    });
    const service = new MilestoneDocumentsService(repository);
    const input = {
      name: '새 서류',
      required: true,
      sortOrder: 2,
    };

    // When
    const result = await service.createDocument(syntheticMilestoneId, input);

    // Then: 삽입은 부모 잠금 뒤에만 일어난다 — 순서 재부여가 재번호를 매기는 사이에
    // 새 항목이 끼어들면 그 항목만 빠져 sortOrder가 겹친다.
    expect(transactionCalls).toEqual(['lockMilestone', 'createDocument']);
    expect(mocks.createDocument).toHaveBeenCalledWith(syntheticMilestoneId, {
      name: '새 서류',
      required: true,
    });
    expect(result.id).toBe('cuid-synthetic-document-new');
  });

  it('createDocument는 마일스톤이 없으면 MILESTONE_NOT_FOUND를 던진다', async () => {
    // Given: 잠금 조회가 아무 행도 못 잡았다.
    const { repository } = buildRepository({
      lockMilestone: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.createDocument(syntheticMilestoneId, {
        name: '새 서류',
        required: true,
        sortOrder: 2,
      }),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND },
    });
  });

  it('updateDocument는 서류가 그 마일스톤 소속이 아니면 DOCUMENT_NOT_FOUND를 던진다', async () => {
    // Given: 잠그고 다시 읽은 행의 milestoneId가 요청 경로의 milestoneId와 다르다.
    const { mocks, repository } = buildRepository({
      lockDocument: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: 'cuid-other-milestone',
      }),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.updateDocument(syntheticMilestoneId, syntheticDocumentId, {
        name: '수정된 이름',
        required: false,
        sortOrder: 1,
      }),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
    expect(mocks.updateDocument).not.toHaveBeenCalled();
  });

  it('updateDocument는 잠금 대기 중 서류가 삭제되면 갱신하지 않고 DOCUMENT_NOT_FOUND를 던진다', async () => {
    // Given: 대상 행 잠금은 삭제와 직렬화된다. 삭제가 먼저 커밋하면 잠금 조회는 행을 돌려주지 않는다.
    const { mocks, transactionCalls, repository } = buildRepository({
      lockDocument: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.updateDocument(syntheticMilestoneId, syntheticDocumentId, {
        name: '수정된 이름',
        required: false,
        sortOrder: 1,
      }),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
    expect(transactionCalls).toEqual(['lockDocument']);
    expect(mocks.updateDocument).not.toHaveBeenCalled();
  });

  it('updateDocument는 잠금과 갱신을 한 트랜잭션 안에서 이 순서로 한다', async () => {
    const { transactionCalls, withTransaction, repository } = buildRepository({
      updateDocument: jest.fn().mockResolvedValue(baseDocument()),
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    await service.updateDocument(syntheticMilestoneId, syntheticDocumentId, {
      name: '개인정보 수집·이용 동의서',
      required: true,
      sortOrder: 1,
    });

    // Then
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(transactionCalls).toEqual(['lockDocument', 'updateDocument']);
  });

  it('updateDocument는 제출이 있어도 이름·필수여부 변경은 그대로 허용한다', async () => {
    // Given: 제출이 2건 있다.
    const { mocks, repository } = buildRepository({
      countSubmissionsForDocument: jest.fn().mockResolvedValue(2),
      updateDocument: jest
        .fn()
        .mockResolvedValue(
          baseDocument({ name: '수정된 이름', required: false }),
        ),
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.updateDocument(
      syntheticMilestoneId,
      syntheticDocumentId,
      {
        name: '수정된 이름',
        required: false,
        sortOrder: 3,
      },
    );

    // Then: 제출 방식이 그대로면 제출 수를 셀 필요조차 없다.
    expect(mocks.countSubmissionsForDocument).not.toHaveBeenCalled();
    expect(mocks.updateDocument).toHaveBeenCalledWith(syntheticDocumentId, {
      name: '수정된 이름',
      required: false,
    });
    expect(result.name).toBe('수정된 이름');
  });

  it('updateDocument는 요청에 실려 온 sortOrder를 저장하지 않는다 — 순서는 order endpoint가 소유한다', async () => {
    // Given: 교직원 A가 편집 화면을 열어 둔 사이 B가 순서를 바꿨다. A는 화면에 박혀 있던
    // 낡은 sortOrder(1)를 그대로 실어 보내지만 지금 그 항목의 실제 순서는 3이다.
    // 이 값을 저장하면 B의 새 순서를 덮어 sortOrder가 겹치고, 겹치면 다음 「위로」가
    // 조용히 아무 일도 하지 않는다.
    const { mocks, repository } = buildRepository({
      updateDocument: jest
        .fn()
        .mockResolvedValue(baseDocument({ name: '수정된 이름', sortOrder: 3 })),
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.updateDocument(
      syntheticMilestoneId,
      syntheticDocumentId,
      {
        name: '수정된 이름',
        required: true,
        sortOrder: 1,
      },
    );

    // Then: 저장 대상에 sortOrder가 아예 없다.
    const [, savedInput] = mocks.updateDocument.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(savedInput).not.toHaveProperty('sortOrder');
    expect(savedInput).toEqual({
      name: '수정된 이름',
      required: true,
    });
    // Then: 응답도 기존 행의 순서를 그대로 되돌려준다(요청 값 1이 아니다).
    expect(result.sortOrder).toBe(3);
  });

  it('deleteDocument는 제출이 있으면 DOCUMENT_HAS_SUBMISSIONS로 거부한다', async () => {
    // Given
    const { mocks, repository } = buildRepository({
      lockDocumentIdsOfMilestone: jest
        .fn()
        .mockResolvedValue([syntheticDocumentId, 'cuid-synthetic-document-2']),
      countSubmissionsForDocument: jest.fn().mockResolvedValue(1),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.deleteDocument(syntheticMilestoneId, syntheticDocumentId),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_HAS_SUBMISSIONS },
    });
    expect(mocks.deleteDocument).not.toHaveBeenCalled();
  });

  it('deleteDocument는 마지막 제출 항목을 지우지 않는다', async () => {
    const { mocks, repository } = buildRepository();
    const service = new MilestoneDocumentsService(repository);

    await expect(
      service.deleteDocument(syntheticMilestoneId, syntheticDocumentId),
    ).rejects.toMatchObject({
      errorCode: {
        code: MilestoneDocumentsErrorCode.LAST_DOCUMENT_REQUIRED,
      },
    });
    expect(mocks.countSubmissionsForDocument).not.toHaveBeenCalled();
    expect(mocks.deleteDocument).not.toHaveBeenCalled();
  });

  it('deleteDocument는 마일스톤·서류를 이 순서로 잠근 뒤 세고 지운다', async () => {
    // Given: 삭제도 추가와 같은 관문(마일스톤 행)을 먼저 지나야 순서 재부여가 잠근 집합에서
    // 행이 사라지는 일을 막는다. 잠금 순서는 Milestone → MilestoneDocument 고정이다.
    const secondDocumentId = 'cuid-synthetic-document-2';
    const { mocks, transactionCalls, repository } = buildRepository({
      lockDocumentIdsOfMilestone: jest
        .fn()
        .mockResolvedValue([syntheticDocumentId, secondDocumentId]),
      countSubmissionsForDocument: jest.fn().mockResolvedValue(0),
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    await service.deleteDocument(syntheticMilestoneId, syntheticDocumentId);

    // Then
    expect(transactionCalls).toEqual([
      'lockMilestone',
      'lockDocumentIdsOfMilestone',
      'lockDocument',
      'countSubmissionsForDocument',
      'deleteDocument',
    ]);
    expect(mocks.deleteDocument).toHaveBeenCalledWith(syntheticDocumentId);
  });

  it('deleteDocument는 서류가 그 마일스톤 소속이 아니면 잠금 뒤에 DOCUMENT_NOT_FOUND로 막는다', async () => {
    // Given: 잠그고 다시 읽은 행의 milestoneId가 요청 경로와 다르다.
    const { mocks, repository } = buildRepository({
      lockDocumentIdsOfMilestone: jest
        .fn()
        .mockResolvedValue([syntheticDocumentId, 'cuid-synthetic-document-2']),
      lockDocument: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: 'cuid-other-milestone',
      }),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.deleteDocument(syntheticMilestoneId, syntheticDocumentId),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
    expect(mocks.deleteDocument).not.toHaveBeenCalled();
  });

  it('deleteDocument는 마일스톤이 사라졌으면 DOCUMENT_NOT_FOUND를 던진다', async () => {
    // Given: 마일스톤이 없으면 그 안의 서류도 없다 — 호출자에게는 그것이 사실이다.
    const { mocks, repository } = buildRepository({
      lockMilestone: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.deleteDocument(syntheticMilestoneId, syntheticDocumentId),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
    expect(mocks.lockDocument).not.toHaveBeenCalled();
    expect(mocks.deleteDocument).not.toHaveBeenCalled();
  });
});

describe('MilestoneDocumentsService.reorderDocuments (교직원)', () => {
  const secondDocumentId = 'cuid-synthetic-document-2';
  const thirdDocumentId = 'cuid-synthetic-document-3';

  /** 잠금 뒤 다시 읽은 집합 — 순서 재부여의 판단 근거는 오직 이 값이다. */
  const lockedIds = [syntheticDocumentId, secondDocumentId, thirdDocumentId];

  function reorderRepository(
    overrides: Partial<Record<string, jest.Mock>> = {},
  ) {
    return buildRepository({
      lockDocumentIdsOfMilestone: jest.fn().mockResolvedValue(lockedIds),
      // 트랜잭션 밖 목록 조회는 같은 집합을 돌려준다 — 두 값이 갈리는 상황은 아래 전용
      // 테스트에서만 만든다.
      findByMilestoneId: jest.fn().mockResolvedValue([
        baseDocument({ sortOrder: 1 }),
        baseDocument({
          id: secondDocumentId,
          name: '팀 활동 보고',
          sortOrder: 2,
        }),
        baseDocument({
          id: thirdDocumentId,
          name: '결과 보고서',
          sortOrder: 3,
        }),
      ]),
      ...overrides,
    });
  }

  it('마일스톤이 없으면 MILESTONE_NOT_FOUND를 던진다', async () => {
    // Given: 잠금 조회가 아무 행도 못 잡았다.
    const { mocks, repository } = reorderRepository({
      lockMilestone: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.reorderDocuments(syntheticMilestoneId, [syntheticDocumentId]),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND },
    });
    expect(mocks.applyDocumentOrder).not.toHaveBeenCalled();
  });

  it('전체 집합이 일치하면 요청 순서 그대로 리포지토리에 넘기고 새 순서를 돌려준다', async () => {
    // Given: 3개를 역순으로 보낸다.
    const requested = [thirdDocumentId, secondDocumentId, syntheticDocumentId];
    const { mocks, repository } = reorderRepository({
      applyDocumentOrder: jest.fn().mockResolvedValue([
        baseDocument({
          id: thirdDocumentId,
          name: '결과 보고서',
          sortOrder: 1,
        }),
        baseDocument({
          id: secondDocumentId,
          name: '팀 활동 보고',
          sortOrder: 2,
        }),
        baseDocument({ sortOrder: 3 }),
      ]),
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.reorderDocuments(
      syntheticMilestoneId,
      requested,
    );

    // Then: sortOrder는 1부터 구멍 없이 다시 매겨진다.
    expect(mocks.applyDocumentOrder).toHaveBeenCalledWith(
      syntheticMilestoneId,
      requested,
    );
    expect(result.map((document) => document.id)).toEqual(requested);
    expect(result.map((document) => document.sortOrder)).toEqual([1, 2, 3]);
  });

  it('마일스톤·서류 행을 이 순서로 잠근 뒤에 집합을 대조하고 갱신한다', async () => {
    // Given: 대조가 잠금보다 먼저면 대조와 갱신 사이가 열려 있다 — 그 틈에 삭제가 커밋되면
    // 이어지는 update가 행을 못 찾아 500이 되고, 추가가 커밋되면 그 항목만 재번호에서 빠진다.
    const { transactionCalls, withTransaction, repository } = reorderRepository(
      {
        applyDocumentOrder: jest.fn().mockResolvedValue([]),
      },
    );
    const service = new MilestoneDocumentsService(repository);

    // When
    await service.reorderDocuments(syntheticMilestoneId, lockedIds);

    // Then
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(transactionCalls).toEqual([
      'lockMilestone',
      'lockDocumentIdsOfMilestone',
      'applyDocumentOrder',
    ]);
  });

  it('잠그기 전 목록과 요청이 같아도, 잠근 뒤 집합이 달라졌으면 INVALID_REQUEST로 거절한다', async () => {
    // Given: 요청은 트랜잭션 밖 목록(3개)과 정확히 일치한다. 그런데 잠금을 기다리는 사이
    // 다른 교직원이 항목 하나를 더 추가해 실제 집합은 4개가 됐다. 낡은 목록으로 판단하면
    // 그대로 통과해 새 항목만 재번호에서 빠지고 sortOrder가 겹친다.
    const { mocks, repository } = reorderRepository({
      lockDocumentIdsOfMilestone: jest
        .fn()
        .mockResolvedValue([...lockedIds, 'cuid-synthetic-document-4']),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.reorderDocuments(syntheticMilestoneId, lockedIds),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.INVALID_REQUEST },
    });
    expect(mocks.applyDocumentOrder).not.toHaveBeenCalled();
  });

  it('요청에 있던 항목이 잠근 뒤 집합에서 사라졌으면 500이 아니라 INVALID_REQUEST가 된다', async () => {
    // Given: 그 사이 다른 교직원이 항목 하나를 지웠다. 그대로 진행하면 그 id의 update가
    // Prisma P2025로 터져 교직원 화면에는 아무 뜻 없는 500이 뜬다.
    const { mocks, repository } = reorderRepository({
      lockDocumentIdsOfMilestone: jest
        .fn()
        .mockResolvedValue([syntheticDocumentId, secondDocumentId]),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.reorderDocuments(syntheticMilestoneId, lockedIds),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.INVALID_REQUEST },
    });
    expect(mocks.applyDocumentOrder).not.toHaveBeenCalled();
  });

  it('일부만 나열하면 INVALID_REQUEST로 거부한다 — 부분 갱신 자체를 불가능하게 만든다', async () => {
    // Given: 3개 중 2개만 보냈다(맞바꾸기를 각각 PATCH하던 옛 방식의 흔적).
    const { mocks, repository } = reorderRepository();
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.reorderDocuments(syntheticMilestoneId, [
        secondDocumentId,
        syntheticDocumentId,
      ]),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.INVALID_REQUEST },
    });
    expect(mocks.applyDocumentOrder).not.toHaveBeenCalled();
  });

  it('개수는 맞아도 중복이 섞이면 INVALID_REQUEST로 거부한다', async () => {
    // Given: 하나가 빠지고 다른 하나가 두 번 들어와 길이만 3이다.
    const { mocks, repository } = reorderRepository();
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.reorderDocuments(syntheticMilestoneId, [
        syntheticDocumentId,
        secondDocumentId,
        secondDocumentId,
      ]),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.INVALID_REQUEST },
    });
    expect(mocks.applyDocumentOrder).not.toHaveBeenCalled();
  });

  it('다른 마일스톤의 서류 id가 섞이면 INVALID_REQUEST로 거부한다', async () => {
    // Given
    const { mocks, repository } = reorderRepository();
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.reorderDocuments(syntheticMilestoneId, [
        syntheticDocumentId,
        secondDocumentId,
        'cuid-synthetic-document-other-milestone',
      ]),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.INVALID_REQUEST },
    });
    expect(mocks.applyDocumentOrder).not.toHaveBeenCalled();
  });
});

describe('MilestoneDocumentsService.submit (학생)', () => {
  const now = new Date('2026-09-16T14:22:00.000Z');

  it('학생이 아니면 STUDENT_ONLY로 거부한다', async () => {
    // Given
    const { repository } = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue({
        id: 'staff-1',
        hasStaffAccess: true,
        hasAdminAccess: false,
      }),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.submit(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        { text: '본문', fileId: null },
        now,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.STUDENT_ONLY },
    });
  });

  it('마감 후 첫 제출은 MILESTONE_CLOSED로 거부한다', async () => {
    const { mocks, repository } = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue({
        id: syntheticUserId,
        hasStaffAccess: false,
        hasAdminAccess: false,
      }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: true,
        programEndAt: new Date('2026-12-31T00:00:00.000Z'),
      }),
    });
    const service = new MilestoneDocumentsService(repository);

    await expect(
      service.submit(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        { text: '늦은 제출', fileId: null },
        new Date('2026-09-19T09:00:00.001Z'),
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.MILESTONE_CLOSED },
    });
    expect(mocks.upsertSubmission).not.toHaveBeenCalled();
  });

  it('마감 후 검토 전 교체는 SUBMISSION_REPLACEMENT_CLOSED로 거부한다', async () => {
    const { mocks, repository } = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue({
        id: syntheticUserId,
        hasStaffAccess: false,
        hasAdminAccess: false,
      }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: true,
        programEndAt: new Date('2026-12-31T00:00:00.000Z'),
      }),
      findMySubmission: jest.fn().mockResolvedValue({
        id: 'cuid-synthetic-submission',
      }),
    });
    const service = new MilestoneDocumentsService(repository);

    await expect(
      service.submit(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        { text: '늦은 교체', fileId: null },
        new Date('2026-09-19T09:00:00.001Z'),
      ),
    ).rejects.toMatchObject({
      errorCode: {
        code: MilestoneDocumentsErrorCode.SUBMISSION_REPLACEMENT_CLOSED,
      },
    });
    expect(mocks.upsertSubmission).not.toHaveBeenCalled();
  });

  it('검증 뒤 마감이 앞당겨졌으면 실제 쓰기 직전에도 막는다', async () => {
    const { repository } = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue({
        id: syntheticUserId,
        hasStaffAccess: false,
        hasAdminAccess: false,
      }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: true,
        programEndAt: new Date('2026-12-31T00:00:00.000Z'),
      }),
      upsertSubmission: jest
        .fn()
        .mockRejectedValue(new MilestoneDocumentDeadlineClosedError()),
    });
    const service = new MilestoneDocumentsService(repository);

    await expect(
      service.submit(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        { text: '본문', fileId: null },
        now,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.MILESTONE_CLOSED },
    });
  });

  it('내용만 제출할 수 있다', async () => {
    const { mocks, repository } = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue({
        id: syntheticUserId,
        hasStaffAccess: false,
        hasAdminAccess: false,
      }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: true,
        programEndAt: new Date('2026-12-31T00:00:00.000Z'),
      }),
      upsertSubmission: jest.fn().mockResolvedValue({
        id: 'cuid-synthetic-submission',
        status: SubmissionStatus.SUBMITTED,
        content: { type: MilestoneSubmissionType.TEXT, text: '본문' },
        submittedAt: now,
        files: [],
      }),
    });
    const service = new MilestoneDocumentsService(repository);

    await service.submit(
      1n,
      syntheticMilestoneId,
      syntheticDocumentId,
      { text: '본문', fileId: null },
      now,
    );

    expect(mocks.upsertSubmission).toHaveBeenCalledWith({
      milestoneDocumentId: syntheticDocumentId,
      applicationId: syntheticApplicationId,
      submittedById: syntheticUserId,
      submittedAt: now,
      deadline: {
        milestoneId: syntheticMilestoneId,
        allowAfterDeadline: false,
      },
      content: { type: MilestoneSubmissionType.TEXT, text: '본문' },
      attachFile: null,
      expectedLatestReviewId: null,
    });
  });

  it('이 프로그램 신청이 없으면 NOT_APPLICATION_MEMBER로 거부한다', async () => {
    // Given
    const { repository } = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue({
        id: syntheticUserId,
        hasStaffAccess: false,
        hasAdminAccess: false,
      }),
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: syntheticMilestoneId,
        programId: syntheticProgramId,
        dueAt: now,
        required: true,
      }),
      findStudentApplication: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.submit(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        { text: '본문', fileId: null },
        now,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.NOT_APPLICATION_MEMBER },
    });
  });

  it('신청이 아직 승인 전이면 APPLICATION_APPROVAL_REQUIRED로 거부한다', async () => {
    // Given
    const { repository } = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue({
        id: syntheticUserId,
        hasStaffAccess: false,
        hasAdminAccess: false,
      }),
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: syntheticMilestoneId,
        programId: syntheticProgramId,
        dueAt: now,
        required: true,
      }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: false,
        programEndAt: new Date('2026-12-31T00:00:00.000Z'),
      }),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.submit(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        { text: '본문', fileId: null },
        now,
      ),
    ).rejects.toMatchObject({
      errorCode: {
        code: MilestoneDocumentsErrorCode.APPLICATION_APPROVAL_REQUIRED,
      },
    });
  });

  it('TEXT 제출은 content를 JSON으로 저장하고 응답 DTO로 감싼다', async () => {
    // Given
    const { mocks, repository } = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue({
        id: syntheticUserId,
        hasStaffAccess: false,
        hasAdminAccess: false,
      }),
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: syntheticMilestoneId,
        programId: syntheticProgramId,
        dueAt: now,
        required: true,
      }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: true,
        programEndAt: new Date('2026-12-31T00:00:00.000Z'),
      }),
      upsertSubmission: jest.fn().mockResolvedValue({
        id: 'cuid-synthetic-submission',
        status: SubmissionStatus.SUBMITTED,
        content: { type: MilestoneSubmissionType.TEXT, text: '본문' },
        submittedAt: now,
        files: [],
      }),
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.submit(
      1n,
      syntheticMilestoneId,
      syntheticDocumentId,
      { text: '본문', fileId: null },
      now,
    );

    // Then
    expect(mocks.upsertSubmission).toHaveBeenCalledWith({
      milestoneDocumentId: syntheticDocumentId,
      applicationId: syntheticApplicationId,
      submittedById: syntheticUserId,
      submittedAt: now,
      deadline: {
        milestoneId: syntheticMilestoneId,
        allowAfterDeadline: false,
      },
      content: { type: MilestoneSubmissionType.TEXT, text: '본문' },
      attachFile: null,
      expectedLatestReviewId: null,
    });
    expect(result.id).toBe('cuid-synthetic-submission');
    expect(result.submittedAt).toBe(now.toISOString());
  });

  it('파일 제출은 attachFile을 채우고 content는 Prisma.JsonNull이다', async () => {
    // Given
    const { mocks, repository } = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue({
        id: syntheticUserId,
        hasStaffAccess: false,
        hasAdminAccess: false,
      }),
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: syntheticMilestoneId,
        programId: syntheticProgramId,
        dueAt: now,
        required: true,
      }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: true,
        programEndAt: new Date('2026-12-31T00:00:00.000Z'),
      }),
      upsertSubmission: jest.fn().mockResolvedValue({
        id: 'cuid-synthetic-submission',
        status: SubmissionStatus.SUBMITTED,
        content: null,
        submittedAt: now,
        files: [
          {
            id: 'cuid-synthetic-file',
            originalFileName: '계획서.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
          },
        ],
      }),
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.submit(
      1n,
      syntheticMilestoneId,
      syntheticDocumentId,
      { text: null, fileId: 'cuid-synthetic-file' },
      now,
    );

    // Then
    expect(mocks.upsertSubmission).toHaveBeenCalledWith({
      milestoneDocumentId: syntheticDocumentId,
      applicationId: syntheticApplicationId,
      submittedById: syntheticUserId,
      submittedAt: now,
      deadline: {
        milestoneId: syntheticMilestoneId,
        allowAfterDeadline: false,
      },
      content: Prisma.JsonNull,
      attachFile: {
        fileId: 'cuid-synthetic-file',
        uploaderId: syntheticUserId,
        milestoneId: syntheticMilestoneId,
      },
      expectedLatestReviewId: null,
    });
    expect(result.files).toEqual([
      expect.objectContaining({ id: 'cuid-synthetic-file' }),
    ]);
  });

  it('내용과 파일을 함께 같은 제출 이력에 저장한다', async () => {
    const { mocks, repository } = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue({
        id: syntheticUserId,
        hasStaffAccess: false,
        hasAdminAccess: false,
      }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: true,
        programEndAt: new Date('2026-12-31T00:00:00.000Z'),
      }),
      upsertSubmission: jest.fn().mockResolvedValue({
        id: 'cuid-synthetic-submission',
        status: SubmissionStatus.SUBMITTED,
        content: { type: MilestoneSubmissionType.TEXT, text: '설명' },
        submittedAt: now,
        files: [],
      }),
    });
    const service = new MilestoneDocumentsService(repository);

    await service.submit(
      1n,
      syntheticMilestoneId,
      syntheticDocumentId,
      { text: '설명', fileId: 'cuid-synthetic-file' },
      now,
    );

    expect(mocks.upsertSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        content: { type: MilestoneSubmissionType.TEXT, text: '설명' },
        attachFile: {
          fileId: 'cuid-synthetic-file',
          uploaderId: syntheticUserId,
          milestoneId: syntheticMilestoneId,
        },
      }),
    );
  });

  it('pending 파일이 만료·소유자 불일치로 붙지 않으면 PENDING_FILE_NOT_FOUND로 변환한다', async () => {
    // Given
    const { repository } = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue({
        id: syntheticUserId,
        hasStaffAccess: false,
        hasAdminAccess: false,
      }),
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: syntheticMilestoneId,
        programId: syntheticProgramId,
        dueAt: now,
        required: true,
      }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: true,
        programEndAt: new Date('2026-12-31T00:00:00.000Z'),
      }),
      upsertSubmission: jest
        .fn()
        .mockRejectedValue(new MilestoneDocumentPendingFileMissingError()),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.submit(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        { text: null, fileId: 'cuid-expired-file' },
        now,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.PENDING_FILE_NOT_FOUND },
    });
  });

  it('검증 뒤 서류가 삭제되면 FK 오류 대신 DOCUMENT_NOT_FOUND로 변환한다', async () => {
    const { repository } = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue({
        id: syntheticUserId,
        hasStaffAccess: false,
        hasAdminAccess: false,
      }),
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: syntheticMilestoneId,
        programId: syntheticProgramId,
        dueAt: now,
        required: true,
      }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: true,
        programEndAt: new Date('2026-12-31T00:00:00.000Z'),
      }),
      upsertSubmission: jest
        .fn()
        .mockRejectedValue(new MilestoneDocumentMissingError()),
    });
    const service = new MilestoneDocumentsService(repository);

    await expect(
      service.submit(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        { text: '본문', fileId: null },
        now,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
  });
});

describe('MilestoneDocumentsService.submit — 판정 뒤 재제출', () => {
  const now = new Date('2026-09-16T14:22:00.000Z');

  /** 승인된 신청의 학생이 TEXT 서류를 다시 내는 상황. 최신 판정만 갈아 끼운다. */
  function resubmitRepository(
    latestReview: { id: string; decision: ReviewDecision } | null,
  ) {
    return buildRepository({
      findActiveUser: jest.fn().mockResolvedValue({
        id: syntheticUserId,
        hasStaffAccess: false,
        hasAdminAccess: false,
      }),
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: syntheticMilestoneId,
        programId: syntheticProgramId,
        dueAt: now,
        required: true,
      }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: true,
        programEndAt: new Date('2026-12-31T00:00:00.000Z'),
      }),
      findLatestReview: jest.fn().mockResolvedValue(latestReview),
      upsertSubmission: jest.fn().mockResolvedValue({
        id: 'cuid-synthetic-submission',
        status: SubmissionStatus.SUBMITTED,
        content: { type: MilestoneSubmissionType.TEXT, text: '고친 본문' },
        submittedAt: now,
        files: [],
      }),
    });
  }

  function resubmit(service: MilestoneDocumentsService) {
    return service.submit(
      1n,
      syntheticMilestoneId,
      syntheticDocumentId,
      { text: '고친 본문', fileId: null },
      now,
    );
  }

  it('승인된 서류는 다시 낼 수 없다 — RESUBMISSION_NOT_ALLOWED로 막는다', async () => {
    // Given: 막지 않으면 교직원이 승인한 내용이 조용히 다른 내용으로 바뀐다.
    const { mocks, repository } = resubmitRepository({
      id: 'cuid-synthetic-review',
      decision: ReviewDecision.APPROVED,
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(resubmit(service)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.RESUBMISSION_NOT_ALLOWED },
    });
    expect(mocks.upsertSubmission).not.toHaveBeenCalled();
  });

  it('반려된 서류는 다시 낼 수 없다 — 끝난 판정이다', async () => {
    // Given
    const { mocks, repository } = resubmitRepository({
      id: 'cuid-synthetic-review',
      decision: ReviewDecision.REJECTED,
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(resubmit(service)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.RESUBMISSION_NOT_ALLOWED },
    });
    expect(mocks.upsertSubmission).not.toHaveBeenCalled();
  });

  it('보완 요청을 받은 서류는 다시 낼 수 있다 — 그것이 보완 요청의 뜻이다', async () => {
    // Given
    const { mocks, repository } = resubmitRepository({
      id: 'cuid-synthetic-review',
      decision: ReviewDecision.CHANGES_REQUESTED,
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    await resubmit(service);

    // Then: 판단 근거였던 판정 id를 기대값으로 함께 넘긴다.
    expect(mocks.upsertSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedLatestReviewId: 'cuid-synthetic-review',
      }),
    );
  });

  it('아직 판정이 없으면 지금처럼 허용한다', async () => {
    // Given
    const { mocks, repository } = resubmitRepository(null);
    const service = new MilestoneDocumentsService(repository);

    // When
    await resubmit(service);

    // Then
    expect(mocks.upsertSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ expectedLatestReviewId: null }),
    );
  });

  it('최신 판정은 (서류, 신청) 짝으로 찾는다', async () => {
    // Given
    const { mocks, repository } = resubmitRepository(null);
    const service = new MilestoneDocumentsService(repository);

    // When
    await resubmit(service);

    // Then
    expect(mocks.findLatestReview).toHaveBeenCalledWith(
      syntheticDocumentId,
      syntheticApplicationId,
    );
  });

  it('제출을 쓰는 사이에 판정이 들어왔으면 REVIEW_CHANGED로 변환한다', async () => {
    // Given: 서비스는 「판정 없음」을 보고 허용했지만, 잠금 아래 재확인에서 어긋났다.
    const { repository } = resubmitRepository(null);
    (
      repository as unknown as { upsertSubmission: jest.Mock }
    ).upsertSubmission = jest
      .fn()
      .mockRejectedValue(new MilestoneDocumentReviewChangedError());
    const service = new MilestoneDocumentsService(repository);

    // When / Then: 「막혔다」가 아니라 「다시 확인하라」로 알린다 — 새 판정이 보완 요청이면
    // 다시 시도했을 때 통과해야 하기 때문이다.
    await expect(resubmit(service)).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.REVIEW_CHANGED },
    });
  });
});

describe('MilestoneDocumentsService.collectForStaff', () => {
  const now = new Date('2026-09-20T00:00:00.000Z');
  const secondDocumentId = 'cuid-synthetic-document-2';
  const secondApplicationId = 'cuid-synthetic-application-2';

  function collectionRepository(
    overrides: Partial<Record<string, jest.Mock>> = {},
  ) {
    return buildRepository({
      findByMilestoneId: jest.fn().mockResolvedValue([
        baseDocument(),
        baseDocument({
          id: secondDocumentId,
          name: '팀 활동 보고',
          required: false,
          sortOrder: 2,
        }),
      ]),
      findApprovedApplicationsForCollection: jest.fn().mockResolvedValue([
        {
          applicationId: syntheticApplicationId,
          teamName: '가나다팀',
          applicantName: '합성 신청자',
          memberNicknames: ['synthetic-leader', 'synthetic-member'],
        },
        {
          applicationId: secondApplicationId,
          teamName: '라마바팀',
          applicantName: null,
          memberNicknames: ['synthetic-solo'],
        },
      ]),
      ...overrides,
    });
  }

  it('마일스톤이 없으면 MILESTONE_NOT_FOUND를 던진다', async () => {
    // Given
    const { repository } = buildRepository({
      findMilestone: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.collectForStaff(syntheticMilestoneId, collectionQuery(), now),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND },
    });
  });

  it('마일스톤 요약과 서류 목록을 sortOrder 순 그대로 싣는다', async () => {
    // Given
    const { repository } = collectionRepository();
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.collectForStaff(
      syntheticMilestoneId,
      collectionQuery(),
      now,
    );

    // Then
    expect(result.milestone).toEqual({
      id: syntheticMilestoneId,
      // 경로의 programId와 대조할 근거 — 이 값이 빠지면 다른 프로그램의 표인지 알 수 없다.
      programId: syntheticProgramId,
      name: '프로젝트 계획서 제출',
      dueAt: '2026-09-19T09:00:00.000Z',
    });
    // 열의 필수 여부는 isRequired다 — ADR-004의 boolean `is` 접두사. 이미 발행된 목록 조회
    // 응답(MilestoneDocumentResponseDto.required)은 그대로 두고 이 신규 응답만 규칙을 따른다.
    expect(result.documents).toEqual([
      {
        id: syntheticDocumentId,
        name: '개인정보 수집·이용 동의서',
        isRequired: true,
        sortOrder: 1,
      },
      {
        id: secondDocumentId,
        name: '팀 활동 보고',
        isRequired: false,
        sortOrder: 2,
      },
    ]);
  });

  it('행은 승인된 신청 목록 순서(팀 이름 오름차순) 그대로다', async () => {
    // Given
    const { mocks, repository } = collectionRepository();
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.collectForStaff(
      syntheticMilestoneId,
      collectionQuery(),
      now,
    );

    // Then
    expect(mocks.findApprovedApplicationsForCollection).toHaveBeenCalledWith(
      syntheticProgramId,
    );
    expect(result.rows.map((row) => row.teamName)).toEqual([
      '가나다팀',
      '라마바팀',
    ]);
    expect(result.rows[0]?.applicantName).toBe('합성 신청자');
    expect(result.rows[0]?.memberNicknames).toEqual([
      'synthetic-leader',
      'synthetic-member',
    ]);
  });

  it('제출이 없는 서류도 칸을 비우지 않고 isSubmitted:false로 채운다', async () => {
    // Given: 제출이 하나도 없다.
    const { repository } = collectionRepository();
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.collectForStaff(
      syntheticMilestoneId,
      collectionQuery(),
      now,
    );

    // Then: 프런트가 빈칸을 추측하지 않도록 모든 서류에 한 칸씩 채운다.
    // 제출이 없으면 상태도 없다 — status는 「제출 행의 상태」이지 판정 결과가 아니다.
    for (const row of result.rows) {
      expect(row.cells).toEqual([
        {
          documentId: syntheticDocumentId,
          isSubmitted: false,
          submittedAt: null,
          // 제출이 없으면 되돌려 보낼 버전도 없다 — 판정 자체가 SUBMISSION_NOT_FOUND로 막힌다.
          revision: null,
          file: null,
          content: null,
          status: null,
          review: null,
        },
        {
          documentId: secondDocumentId,
          isSubmitted: false,
          submittedAt: null,
          revision: null,
          file: null,
          content: null,
          status: null,
          review: null,
        },
      ]);
    }
  });

  it('제출한 칸만 isSubmitted:true가 되고 FILE 유형이면 파일 정보를 싣는다', async () => {
    // Given
    const { repository } = collectionRepository({
      findSubmissionsForCollection: jest.fn().mockResolvedValue([
        {
          milestoneDocumentId: syntheticDocumentId,
          applicationId: syntheticApplicationId,
          submittedAt: new Date('2026-09-16T14:22:00.000Z'),
          revision: 1,
          status: SubmissionStatus.SUBMITTED,
          content: null,
          file: { originalFileName: '최종_진짜최종.hwp', sizeBytes: 2048 },
          review: null,
        },
        {
          milestoneDocumentId: secondDocumentId,
          applicationId: syntheticApplicationId,
          submittedAt: new Date('2026-09-17T10:00:00.000Z'),
          // 두 번 낸 칸 — 프런트는 이 값을 판정 요청의 expectedRevision으로 되돌려 보낸다.
          revision: 2,
          status: SubmissionStatus.SUBMITTED,
          content: { type: 'TEXT', text: '3주차까지 인터뷰 8건을 마쳤습니다.' },
          file: null,
          review: null,
        },
      ]),
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.collectForStaff(
      syntheticMilestoneId,
      collectionQuery(),
      now,
    );

    // Then
    expect(result.rows[0]?.cells).toEqual([
      {
        documentId: syntheticDocumentId,
        isSubmitted: true,
        submittedAt: '2026-09-16T14:22:00.000Z',
        // 칸이 리비전을 싣지 않으면 프런트가 되돌려 보낼 값이 없어 판정 자체가 불가능하다.
        revision: 1,
        file: { name: '최종_진짜최종.hwp', sizeBytes: 2048 },
        // FILE 제출은 본문이 없다 — 내용은 위 file이 가리킨다.
        content: null,
        status: SubmissionStatus.SUBMITTED,
        review: null,
      },
      {
        documentId: secondDocumentId,
        isSubmitted: true,
        submittedAt: '2026-09-17T10:00:00.000Z',
        revision: 2,
        file: null,
        // 글 제출은 본문을 그대로 싣는다 — 이게 없으면 교직원이 내용을 못 보고 판정한다.
        content: {
          type: MilestoneSubmissionType.TEXT,
          text: '3주차까지 인터뷰 8건을 마쳤습니다.',
        },
        status: SubmissionStatus.SUBMITTED,
        review: null,
      },
    ]);
    // 다른 팀의 칸이 섞이지 않는다.
    expect(result.rows[1]?.cells.every((cell) => !cell.isSubmitted)).toBe(true);
  });

  it('첨부가 만료돼 리포지토리가 file:null을 주면 목록에도 파일을 싣지 않는다', async () => {
    // Given: 만료 필터가 걸러 낸 상태다 — 「목록엔 보이는데 받으면 실패」를 만들지 않는다.
    const { mocks, repository } = collectionRepository({
      findSubmissionsForCollection: jest.fn().mockResolvedValue([
        {
          milestoneDocumentId: syntheticDocumentId,
          applicationId: syntheticApplicationId,
          submittedAt: new Date('2026-09-16T14:22:00.000Z'),
          status: SubmissionStatus.SUBMITTED,
          content: null,
          file: null,
          review: null,
        },
      ]),
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.collectForStaff(
      syntheticMilestoneId,
      collectionQuery(),
      now,
    );

    // Then
    expect(mocks.findSubmissionsForCollection).toHaveBeenCalledWith(
      [syntheticDocumentId, secondDocumentId],
      now,
      expect.any(Array),
    );
    expect(result.rows[0]?.cells[0]).toEqual({
      documentId: syntheticDocumentId,
      isSubmitted: true,
      submittedAt: '2026-09-16T14:22:00.000Z',
      file: null,
      content: null,
      status: SubmissionStatus.SUBMITTED,
      review: null,
    });
  });

  it('본문이 길어도 자르지 않는다 — 일부만 보고 판정하는 것은 못 보고 판정하는 것과 같다', async () => {
    // Given: 제출 요청이 이미 10,000자로 막고 있어 칸 하나의 크기는 유계다. 여기서 다시
    // 잘라 버리면 잘린 뒤를 읽을 방법이 없다(교직원용 단건 조회 endpoint가 없다).
    const longText = '가'.repeat(10_000);
    const { repository } = collectionRepository({
      findSubmissionsForCollection: jest.fn().mockResolvedValue([
        {
          milestoneDocumentId: secondDocumentId,
          applicationId: syntheticApplicationId,
          submittedAt: new Date('2026-09-17T10:00:00.000Z'),
          status: SubmissionStatus.SUBMITTED,
          content: { type: 'TEXT', text: longText },
          file: null,
          review: null,
        },
      ]),
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.collectForStaff(
      syntheticMilestoneId,
      collectionQuery(),
      now,
    );

    // Then
    expect(result.rows[0]?.cells[1]?.content).toEqual({
      type: MilestoneSubmissionType.TEXT,
      text: longText,
    });
  });

  it('저장된 본문 모양이 깨져 있으면 content만 null이 된다 — 표 전체를 500으로 만들지 않는다', async () => {
    // Given: 한 팀의 Json 하나 때문에 수합 표 전체가 떨어지면 안 된다.
    const { repository } = collectionRepository({
      findSubmissionsForCollection: jest.fn().mockResolvedValue([
        {
          milestoneDocumentId: secondDocumentId,
          applicationId: syntheticApplicationId,
          submittedAt: new Date('2026-09-17T10:00:00.000Z'),
          status: SubmissionStatus.SUBMITTED,
          content: { type: 'TEXT' },
          file: null,
          review: null,
        },
      ]),
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.collectForStaff(
      syntheticMilestoneId,
      collectionQuery(),
      now,
    );

    // Then: 칸은 제출로 남되 본문만 비운다.
    expect(result.rows[0]?.cells[1]?.isSubmitted).toBe(true);
    expect(result.rows[0]?.cells[1]?.content).toBeNull();
  });

  it('재제출로 되돌아온 칸은 status가 SUBMITTED이고 최신 판정은 그대로 남는다', async () => {
    // Given: 학생이 보완 요청에 응해 다시 냈다. 제출 상태는 SUBMITTED로 되돌아왔지만 판정
    // 이력은 되돌아가지 않는다. status를 싣지 않으면 화면이 옛 「보완 요청」 배지를 계속
    // 보여 주고, 교직원이 다시 검토해야 할 건을 놓친다.
    const reviewedAt = new Date('2026-09-18T09:00:00.000Z');
    const { repository } = collectionRepository({
      findSubmissionsForCollection: jest.fn().mockResolvedValue([
        {
          milestoneDocumentId: syntheticDocumentId,
          applicationId: syntheticApplicationId,
          submittedAt: new Date('2026-09-19T08:00:00.000Z'),
          status: SubmissionStatus.SUBMITTED,
          content: null,
          file: null,
          review: {
            id: 'cuid-synthetic-review',
            decision: ReviewDecision.CHANGES_REQUESTED,
            comment: '2쪽 서명이 빠졌습니다.',
            reviewedAt,
          },
        },
      ]),
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.collectForStaff(
      syntheticMilestoneId,
      collectionQuery(),
      now,
    );

    // Then: 배지는 status로, 지난 지적은 review로 갈린다 — 둘을 한 값으로 합치지 않는다.
    expect(result.rows[0]?.cells[0]).toEqual({
      documentId: syntheticDocumentId,
      isSubmitted: true,
      submittedAt: '2026-09-19T08:00:00.000Z',
      file: null,
      content: null,
      status: SubmissionStatus.SUBMITTED,
      review: {
        // 프런트가 판정 요청에 되돌려 보낼 기대 버전이다 — 빠지면 「남의 판정을 덮었다」를
        // 서버가 알아챌 근거가 사라진다.
        id: 'cuid-synthetic-review',
        decision: ReviewDecision.CHANGES_REQUESTED,
        comment: '2쪽 서명이 빠졌습니다.',
        reviewedAt: reviewedAt.toISOString(),
      },
    });
  });

  it('판정이 끝난 칸은 그 판정 상태를 그대로 싣는다', async () => {
    // Given: 승인·반려·보완 요청이 각각 제출 상태로 옮겨져 있다.
    const reviewedAt = new Date('2026-09-18T09:00:00.000Z');
    const { repository } = collectionRepository({
      findSubmissionsForCollection: jest.fn().mockResolvedValue([
        {
          milestoneDocumentId: syntheticDocumentId,
          applicationId: syntheticApplicationId,
          submittedAt: new Date('2026-09-16T14:22:00.000Z'),
          status: SubmissionStatus.APPROVED,
          content: null,
          file: null,
          review: {
            id: 'cuid-synthetic-review-1',
            decision: ReviewDecision.APPROVED,
            comment: null,
            reviewedAt,
          },
        },
        {
          milestoneDocumentId: secondDocumentId,
          applicationId: syntheticApplicationId,
          submittedAt: new Date('2026-09-16T14:22:00.000Z'),
          status: SubmissionStatus.REJECTED,
          content: null,
          file: null,
          review: {
            id: 'cuid-synthetic-review-2',
            decision: ReviewDecision.REJECTED,
            comment: '양식이 다릅니다.',
            reviewedAt,
          },
        },
      ]),
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.collectForStaff(
      syntheticMilestoneId,
      collectionQuery(),
      now,
    );

    // Then
    expect(result.rows[0]?.cells.map((cell) => cell.status)).toEqual([
      SubmissionStatus.APPROVED,
      SubmissionStatus.REJECTED,
    ]);
  });

  it('N+1을 만들지 않는다 — 서류·신청·제출을 각각 한 번씩만 조회한다', async () => {
    // Given
    const { mocks, repository } = collectionRepository();
    const service = new MilestoneDocumentsService(repository);

    // When
    await service.collectForStaff(syntheticMilestoneId, collectionQuery(), now);

    // Then
    expect(mocks.findByMilestoneId).toHaveBeenCalledTimes(1);
    expect(mocks.findApprovedApplicationsForCollection).toHaveBeenCalledTimes(
      1,
    );
    expect(mocks.findSubmissionCoordinatesForCollection).toHaveBeenCalledTimes(
      1,
    );
    expect(mocks.findSubmissionsForCollection).toHaveBeenCalledTimes(1);
  });

  it('좌표를 읽은 뒤 제출이 들어와도 같은 snapshot의 count·행·cell을 함께 반환한다', async () => {
    // Given: 좌표 뒤에 새 제출이 커밋되는 창을 흉내 낸다. snapshot 밖 메서드는 새 값을
    // 보지만, 수합 응답은 callback에 준 고정 store만 읽어야 한다.
    const oldCoordinates: readonly {
      applicationId: string;
      milestoneDocumentId: string;
    }[] = [];
    const snapshotStore = {
      findMilestone: jest.fn().mockResolvedValue({
        id: syntheticMilestoneId,
        programId: syntheticProgramId,
        name: '프로젝트 계획서 제출',
        dueAt: new Date('2026-09-19T09:00:00.000Z'),
      }),
      findByMilestoneId: jest.fn().mockResolvedValue([baseDocument()]),
      findApprovedApplicationsForCollection: jest.fn().mockResolvedValue([
        {
          applicationId: syntheticApplicationId,
          teamName: '가나다팀',
          applicantName: '합성 신청자',
          memberNicknames: [],
        },
      ]),
      findSubmissionCoordinatesForCollection: jest
        .fn()
        .mockImplementation(() => {
          outsideSubmissionQuery.mockResolvedValue([
            {
              milestoneDocumentId: syntheticDocumentId,
              applicationId: syntheticApplicationId,
            },
          ]);
          return Promise.resolve(oldCoordinates);
        }),
      findSubmissionsForCollection: jest.fn().mockResolvedValue([]),
    };
    const outsideSubmissionQuery = jest.fn().mockResolvedValue([]);
    const withCollectionSnapshot = jest.fn(
      (operation: (store: typeof snapshotStore) => Promise<unknown>) =>
        operation(snapshotStore),
    );
    const repository = {
      withCollectionSnapshot,
      findSubmissionsForCollection: outsideSubmissionQuery,
    } as unknown as MilestoneDocumentsRepository;
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.collectForStaff(
      syntheticMilestoneId,
      collectionQuery(),
      now,
    );

    // Then: 새 제출의 detail만 끼어드는 mixed response가 아니라, 이전 snapshot 전체다.
    expect(result.total).toBe(1);
    expect(result.documentTotals).toEqual([
      { documentId: syntheticDocumentId, submitted: 0, total: 1 },
    ]);
    expect(result.rows[0]?.cells[0]?.isSubmitted).toBe(false);
    expect(snapshotStore.findSubmissionsForCollection).toHaveBeenCalledWith(
      [syntheticDocumentId],
      now,
      [syntheticApplicationId],
    );
    expect(outsideSubmissionQuery).not.toHaveBeenCalled();
  });
});

describe('MilestoneDocumentsService.historyForParticipant', () => {
  const query = { cursor: null, limit: 20 };

  it('승인된 참여자에게 자기 이력을 주되 교직원 이름은 가린다', async () => {
    const { repository, mocks } = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue({
        id: syntheticUserId,
        hasStaffAccess: false,
        hasAdminAccess: false,
      }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: true,
        programEndAt: new Date('2026-10-01T00:00:00.000Z'),
      }),
      findSubmissionHistoryPage: jest.fn().mockResolvedValue({
        items: [
          {
            id: 'history-1',
            event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
            revision: 1,
            actorNickname: '합성학생',
            comment: null,
            createdAt: new Date('2026-09-16T00:00:00.000Z'),
            fileName: null,
            content: { type: 'TEXT', text: '첫 제출' },
          },
          {
            id: 'history-2',
            event: MilestoneDocumentSubmissionHistoryEvent.CHANGES_REQUESTED,
            revision: 1,
            actorNickname: '내부 교직원 이름',
            comment: '보완해 주세요.',
            createdAt: new Date('2026-09-17T00:00:00.000Z'),
            fileName: null,
            content: null,
          },
        ],
        nextCursor: 'history-cursor',
        isComplete: false,
      }),
    });
    const service = new MilestoneDocumentsService(repository);

    const result = await service.historyForParticipant(
      8_100_002n,
      syntheticMilestoneId,
      syntheticDocumentId,
      query,
    );

    expect(result.nextCursor).toBe('history-cursor');
    expect(result.isComplete).toBe(false);
    expect(result.items.map((item) => item.actorNickname)).toEqual([
      '합성학생',
      '담당 교직원',
    ]);
    expect(mocks.findSubmissionHistoryPage).toHaveBeenCalledWith(
      syntheticDocumentId,
      syntheticApplicationId,
      null,
      20,
    );
  });

  /**
   * 옛 계약은 「승인되지 않은 신청의 이력은 공개하지 않는다」였다. 되돌리기가 이력 행을
   * 지우지 않으므로 그 문은 되돌려진 학생만 막았고, 같은 이력을 교직원은 승인 조건 없이
   * 읽는다. 지금 계약은 **소유만 본다**.
   */
  it('승인이 되돌려진 뒤에도 참여자에게 자기 이력을 그대로 준다', async () => {
    // Given: 승인이 되돌려져 지금은 승인 상태가 아니지만, 승인 시절 남긴 이력 행은 그대로다.
    const { repository, mocks } = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue({
        id: syntheticUserId,
        hasStaffAccess: false,
        hasAdminAccess: false,
      }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: false,
        programEndAt: new Date('2026-10-01T00:00:00.000Z'),
      }),
      findSubmissionHistoryPage: jest.fn().mockResolvedValue({
        items: [
          {
            id: 'history-1',
            event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
            revision: 1,
            actorNickname: '합성학생',
            comment: null,
            createdAt: new Date('2026-09-16T00:00:00.000Z'),
            fileName: null,
            content: { type: 'TEXT', text: '첫 제출' },
          },
        ],
        nextCursor: null,
        isComplete: true,
      }),
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.historyForParticipant(
      8_100_002n,
      syntheticMilestoneId,
      syntheticDocumentId,
      query,
    );

    // Then: 조회는 승인이 아니라 소유로 좁힌다 — 자기 신청 범위 그대로다.
    expect(result.items.map((item) => item.revision)).toEqual([1]);
    expect(result.isComplete).toBe(true);
    expect(mocks.findSubmissionHistoryPage).toHaveBeenCalledWith(
      syntheticDocumentId,
      syntheticApplicationId,
      null,
      20,
    );
  });

  /**
   * 목록과 이력은 같은 사실을 두 번 말한다. 목록이 「이력이 있다」고 답한 줄을 열었을 때
   * 이력이 거절되면 학생 화면에는 지울 수 없는 오류 상자가 남는다(#1096). 두 조회가
   * 갈라지지 않도록 한 테스트 안에서 같은 신청을 두 경로로 읽는다.
   */
  it('승인이 아닌 상태에서도 목록의 hasHistory와 이력 조회가 어긋나지 않는다', async () => {
    // Given: 되돌려진 신청 하나 — 제출 행도 이력 행도 남아 있다.
    const submittedAt = new Date('2026-09-16T14:22:00.000Z');
    const { repository } = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue({
        id: syntheticUserId,
        hasStaffAccess: false,
        hasAdminAccess: false,
      }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: false,
        programEndAt: new Date('2026-10-01T00:00:00.000Z'),
      }),
      findSubmittedSummaries: jest.fn().mockResolvedValue([
        {
          milestoneDocumentId: syntheticDocumentId,
          submittedAt,
          revision: 1,
          status: SubmissionStatus.SUBMITTED,
          hasCurrentFile: false,
          historyComplete: true,
          review: null,
        },
      ]),
      findSubmissionHistoryPage: jest.fn().mockResolvedValue({
        items: [
          {
            id: 'history-1',
            event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
            revision: 1,
            actorNickname: '합성학생',
            comment: null,
            createdAt: submittedAt,
            fileName: null,
            content: { type: 'TEXT', text: '첫 제출' },
          },
        ],
        nextCursor: null,
        isComplete: true,
      }),
    });
    const service = new MilestoneDocumentsService(repository);

    // When: 화면이 실제로 쏘는 두 요청을 같은 순서로 부른다.
    const list = await service.listForViewer(8_100_002n, syntheticMilestoneId);
    const history = await service.historyForParticipant(
      8_100_002n,
      syntheticMilestoneId,
      syntheticDocumentId,
      query,
    );

    // Then: 목록이 있다고 한 이력은 열린다.
    expect(list[0]?.viewerSubmission?.history).toEqual({
      hasHistory: true,
      isComplete: true,
    });
    expect(history.items).toHaveLength(1);
  });

  it('다른 마일스톤의 서류 id는 존재 여부와 무관하게 찾지 못한 것으로 답한다', async () => {
    const { repository, mocks } = buildRepository({
      findActiveUser: jest.fn().mockResolvedValue({
        id: syntheticUserId,
        hasStaffAccess: false,
        hasAdminAccess: false,
      }),
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: 'cuid-synthetic-other-milestone',
        programId: syntheticProgramId,
        name: '다른 서류',
        dueAt: new Date('2026-09-19T09:00:00.000Z'),
        required: true,
      }),
    });
    const service = new MilestoneDocumentsService(repository);

    await expect(
      service.historyForParticipant(
        8_100_002n,
        syntheticMilestoneId,
        syntheticDocumentId,
        query,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
    expect(mocks.findStudentApplication).not.toHaveBeenCalled();
  });
});

describe('MilestoneDocumentsService.collectForStaff — 페이지네이션·필터·집계', () => {
  const now = new Date('2026-09-20T00:00:00.000Z');
  const requiredDocumentId = syntheticDocumentId;
  const optionalDocumentId = 'cuid-synthetic-document-2';
  const bothApplicationId = 'cuid-synthetic-application-a';
  const requiredOnlyApplicationId = 'cuid-synthetic-application-b';
  const optionalOnlyApplicationId = 'cuid-synthetic-application-c';
  const noneApplicationId = 'cuid-synthetic-application-d';
  const submittedAt = new Date('2026-09-16T14:22:00.000Z');

  function submission(
    applicationId: string,
    milestoneDocumentId: string,
    status: SubmissionStatus = SubmissionStatus.SUBMITTED,
  ) {
    return {
      milestoneDocumentId,
      applicationId,
      submittedAt,
      status,
      content: null,
      file: null,
      review: null,
    };
  }

  /**
   * 네 팀의 상태를 갈라 둔다 — 둘 다 냄 / 필수만 냄(선택 미제출) / 선택만 냄(필수 미제출) /
   * 한 장도 안 냄. 「선택만 빠뜨린 팀」이 독촉 대상에 걸리지 않는지가 이 배치의 핵심이다.
   */
  function filterRepository(
    overrides: Partial<Record<string, jest.Mock>> = {},
  ) {
    return buildRepository({
      findByMilestoneId: jest.fn().mockResolvedValue([
        baseDocument({ required: true, sortOrder: 1 }),
        baseDocument({
          id: optionalDocumentId,
          name: '팀 활동 보고',
          required: false,
          sortOrder: 2,
        }),
      ]),
      findApprovedApplicationsForCollection: jest.fn().mockResolvedValue([
        {
          applicationId: bothApplicationId,
          teamName: '가나다팀',
          applicantName: '합성 신청자',
          memberNicknames: ['synthetic-a'],
        },
        {
          applicationId: requiredOnlyApplicationId,
          teamName: '라마바팀',
          applicantName: null,
          memberNicknames: ['synthetic-b'],
        },
        {
          applicationId: optionalOnlyApplicationId,
          teamName: '사아자팀',
          applicantName: null,
          memberNicknames: ['synthetic-c'],
        },
        {
          applicationId: noneApplicationId,
          teamName: '차카타팀',
          applicantName: null,
          memberNicknames: ['synthetic-d'],
        },
      ]),
      findSubmissionCoordinatesForCollection: jest.fn().mockResolvedValue([
        {
          applicationId: bothApplicationId,
          milestoneDocumentId: requiredDocumentId,
        },
        {
          applicationId: bothApplicationId,
          milestoneDocumentId: optionalDocumentId,
        },
        {
          applicationId: requiredOnlyApplicationId,
          milestoneDocumentId: requiredDocumentId,
        },
        {
          applicationId: optionalOnlyApplicationId,
          milestoneDocumentId: optionalDocumentId,
        },
      ]),
      findSubmissionsForCollection: jest
        .fn()
        .mockResolvedValue([
          submission(bothApplicationId, requiredDocumentId),
          submission(bothApplicationId, optionalDocumentId),
          submission(requiredOnlyApplicationId, requiredDocumentId),
          submission(optionalOnlyApplicationId, optionalDocumentId),
        ]),
      ...overrides,
    });
  }

  it('기본 쿼리는 page/pageSize와 필터 적용 후 행 수(total)를 함께 싣는다', async () => {
    // Given
    const { repository } = filterRepository();
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.collectForStaff(
      syntheticMilestoneId,
      collectionQuery(),
      now,
    );

    // Then
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.total).toBe(4);
    expect(result.rows).toHaveLength(4);
  });

  it('페이지 경계는 팀 이름 asc → id asc 순서를 그대로 자른다', async () => {
    // Given: 한 쪽에 2팀씩 담는다.
    const { repository } = filterRepository();
    const service = new MilestoneDocumentsService(repository);

    // When
    const first = await service.collectForStaff(
      syntheticMilestoneId,
      collectionQuery({ pageSize: 2 }),
      now,
    );
    const second = await service.collectForStaff(
      syntheticMilestoneId,
      collectionQuery({ page: 2, pageSize: 2 }),
      now,
    );

    // Then: 경계가 흔들리면 같은 팀이 두 쪽에 겹치거나 사라진다.
    expect(first.rows.map((row) => row.teamName)).toEqual([
      '가나다팀',
      '라마바팀',
    ]);
    expect(second.rows.map((row) => row.teamName)).toEqual([
      '사아자팀',
      '차카타팀',
    ]);
    expect(second.total).toBe(4);
    // 쪽을 넘겨도 합계 행은 그대로다 — 페이지마다 다른 진척을 보여 주면 안 된다.
    expect(second.documentTotals).toEqual(first.documentTotals);
    expect(first.documentTotals).toEqual([
      { documentId: requiredDocumentId, submitted: 2, total: 4 },
      { documentId: optionalDocumentId, submitted: 2, total: 4 },
    ]);
  });

  it('범위를 벗어난 페이지는 빈 행을 돌려주되 total은 그대로다', async () => {
    // Given
    const { repository } = filterRepository();
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.collectForStaff(
      syntheticMilestoneId,
      collectionQuery({ page: 9, pageSize: 2 }),
      now,
    );

    // Then
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(4);
  });

  it('HAS_MISSING은 필수 서류를 빠뜨린 팀만 고른다 — 선택 서류만 안 낸 팀은 걸리지 않는다', async () => {
    // Given: 라마바팀은 선택 서류만 안 냈다. 독촉 대상에 끼면 안 된다.
    const { repository } = filterRepository();
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.collectForStaff(
      syntheticMilestoneId,
      collectionQuery({ filter: 'HAS_MISSING' }),
      now,
    );

    // Then
    expect(result.rows.map((row) => row.teamName)).toEqual([
      '사아자팀',
      '차카타팀',
    ]);
    expect(result.total).toBe(2);
  });

  it('ZERO_SUBMISSION은 필수·선택을 가리지 않고 한 장도 안 낸 팀만 고른다', async () => {
    // Given
    const { repository } = filterRepository();
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.collectForStaff(
      syntheticMilestoneId,
      collectionQuery({ filter: 'ZERO_SUBMISSION' }),
      now,
    );

    // Then: 선택 서류 한 장만 낸 사아자팀은 「0건」이 아니다.
    expect(result.rows.map((row) => row.teamName)).toEqual(['차카타팀']);
    expect(result.total).toBe(1);
  });

  it('서류 항목이 0개면 ZERO_SUBMISSION에 아무 팀도 걸리지 않는다', async () => {
    // Given: 「낼 것이 없다」를 「0건 제출」로 셈하지 않는다.
    const { repository } = filterRepository({
      findByMilestoneId: jest.fn().mockResolvedValue([]),
      findSubmissionsForCollection: jest.fn().mockResolvedValue([]),
      findSubmissionCoordinatesForCollection: jest.fn().mockResolvedValue([]),
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.collectForStaff(
      syntheticMilestoneId,
      collectionQuery({ filter: 'ZERO_SUBMISSION' }),
      now,
    );

    // Then
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.filterCounts.zeroSubmission).toBe(0);
    expect(result.documentTotals).toEqual([]);
  });

  it('필수 서류가 하나도 없으면 HAS_MISSING에 아무 팀도 걸리지 않는다', async () => {
    // Given: 선택 서류 한 개짜리 마일스톤. 아무도 안 냈어도 독촉 대상은 없다.
    const { repository } = filterRepository({
      findByMilestoneId: jest
        .fn()
        .mockResolvedValue([baseDocument({ required: false, sortOrder: 1 })]),
      findSubmissionsForCollection: jest.fn().mockResolvedValue([]),
      findSubmissionCoordinatesForCollection: jest.fn().mockResolvedValue([]),
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.collectForStaff(
      syntheticMilestoneId,
      collectionQuery({ filter: 'HAS_MISSING' }),
      now,
    );

    // Then
    expect(result.rows).toEqual([]);
    expect(result.filterCounts.hasMissing).toBe(0);
    expect(result.filterCounts.zeroSubmission).toBe(4);
  });

  it('filterCounts는 지금 고른 필터와 무관하게 세 갈래 모두를 전체 기준으로 센다', async () => {
    // Given
    const { repository } = filterRepository();
    const service = new MilestoneDocumentsService(repository);

    // When: ZERO_SUBMISSION으로 좁혀 놓은 상태에서 읽는다.
    const result = await service.collectForStaff(
      syntheticMilestoneId,
      collectionQuery({ filter: 'ZERO_SUBMISSION', pageSize: 1 }),
      now,
    );

    // Then: 필터 칩의 건수는 화면을 좁혀도 흔들리지 않아야 한다.
    expect(result.filterCounts).toEqual({
      all: 4,
      hasMissing: 2,
      zeroSubmission: 1,
    });
  });

  it('반려·보완 요청된 제출도 「제출했다」로 센다 — 필터·집계는 판정 상태를 보지 않는다', async () => {
    // Given: 같은 배치인데 판정만 갈렸다. 라마바팀의 필수 서류는 반려, 사아자팀의 선택 서류는
    // 보완 요청 상태다. 「미제출」 기준이 「제출 행이 없다」에서 「판정이 통과하지 않았다」로
    // 조용히 바뀌면 독촉 대상 집계가 뜻을 잃는다 — 칸에 status를 실은 뒤에도 그 기준은 그대로다.
    const { repository } = filterRepository({
      findSubmissionsForCollection: jest
        .fn()
        .mockResolvedValue([
          submission(bothApplicationId, requiredDocumentId),
          submission(bothApplicationId, optionalDocumentId),
          submission(
            requiredOnlyApplicationId,
            requiredDocumentId,
            SubmissionStatus.REJECTED,
          ),
          submission(
            optionalOnlyApplicationId,
            optionalDocumentId,
            SubmissionStatus.CHANGES_REQUESTED,
          ),
        ]),
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.collectForStaff(
      syntheticMilestoneId,
      collectionQuery(),
      now,
    );

    // Then: 판정이 갈리기 전(위 다른 테스트들)과 같은 수를 센다.
    expect(result.filterCounts).toEqual({
      all: 4,
      hasMissing: 2,
      zeroSubmission: 1,
    });
    expect(result.documentTotals).toEqual([
      { documentId: requiredDocumentId, submitted: 2, total: 4 },
      { documentId: optionalDocumentId, submitted: 2, total: 4 },
    ]);
    // 반려된 필수 서류를 낸 라마바팀은 여전히 독촉 대상이 아니다.
    const hasMissing = await service.collectForStaff(
      syntheticMilestoneId,
      collectionQuery({ filter: 'HAS_MISSING' }),
      now,
    );
    expect(hasMissing.rows.map((row) => row.teamName)).toEqual([
      '사아자팀',
      '차카타팀',
    ]);
    // 보완 요청 상태의 선택 서류 한 장을 낸 사아자팀도 「한 장도 안 낸 팀」이 아니다.
    const zeroSubmission = await service.collectForStaff(
      syntheticMilestoneId,
      collectionQuery({ filter: 'ZERO_SUBMISSION' }),
      now,
    );
    expect(zeroSubmission.rows.map((row) => row.teamName)).toEqual([
      '차카타팀',
    ]);
  });

  it('documentTotals는 필터·페이지가 아니라 전체 승인 신청 기준이다', async () => {
    // Given: 필터를 ZERO_SUBMISSION으로 좁히고 페이지도 1행으로 줄인다.
    const { repository } = filterRepository();
    const service = new MilestoneDocumentsService(repository);

    // When
    const filtered = await service.collectForStaff(
      syntheticMilestoneId,
      collectionQuery({ filter: 'ZERO_SUBMISSION', pageSize: 1 }),
      now,
    );
    const all = await service.collectForStaff(
      syntheticMilestoneId,
      collectionQuery(),
      now,
    );

    // Then: 합계 행이 「지금 걸러 놓은 것」이 아니라 「이 마일스톤 전체 진척」을 말한다.
    // 필터를 따라갔다면 ZERO_SUBMISSION에서 모든 열이 제출 0이 되어 뜻이 없어진다.
    expect(filtered.documentTotals).toEqual([
      { documentId: requiredDocumentId, submitted: 2, total: 4 },
      { documentId: optionalDocumentId, submitted: 2, total: 4 },
    ]);
    expect(filtered.documentTotals).toEqual(all.documentTotals);
    expect(filtered.rows).toHaveLength(1);
  });
});
