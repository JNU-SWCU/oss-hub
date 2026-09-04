import {
  AccountStatus,
  ApplicationStatus,
  MilestoneDocumentKind,
  MilestoneDocumentSubmissionHistoryEvent,
  Prisma,
  ReviewDecision,
  SubmissionFileLifecycle,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  MilestoneDocumentDeadlineClosedError,
  MilestoneDocumentMissingError,
  MilestoneDocumentPendingFileMissingError,
  MilestoneDocumentReviewChangedError,
  MilestoneDocumentsRepository,
} from './milestone-documents.repository';

// 합성 데이터만 사용한다 (docs/rules/security.md)
const syntheticMilestoneId = 'cuid-synthetic-milestone';
const syntheticDocumentId = 'cuid-synthetic-document';
const syntheticApplicationId = 'cuid-synthetic-application';
const syntheticUserId = 'cuid-synthetic-user';

describe('MilestoneDocumentsRepository.withCollectionSnapshot', () => {
  it('REPEATABLE READ transaction store로 좌표와 상세를 같은 DB snapshot에서 읽는다', async () => {
    // Given
    const transaction = {
      milestone: {
        findUnique: jest.fn().mockResolvedValue({
          id: syntheticMilestoneId,
          programId: 'cuid-synthetic-program',
          name: '프로젝트 계획서 제출',
          dueAt: new Date('2026-09-19T09:00:00.000Z'),
        }),
      },
      milestoneDocument: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: syntheticDocumentId,
            milestoneId: syntheticMilestoneId,
            name: '개인정보 수집·이용 동의서',
            required: true,
            sortOrder: 1,
            templateFile: null,
          },
        ]),
      },
      application: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: syntheticApplicationId,
            applicant: { profile: { name: '합성 신청자' } },
            team: { name: '가나다팀', members: [] },
          },
        ]),
      },
      milestoneDocumentSubmission: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              milestoneDocumentId: syntheticDocumentId,
              applicationId: syntheticApplicationId,
            },
          ])
          .mockResolvedValueOnce([
            {
              milestoneDocumentId: syntheticDocumentId,
              applicationId: syntheticApplicationId,
              submittedAt: new Date('2026-09-16T14:22:00.000Z'),
              revision: 1,
              status: SubmissionStatus.SUBMITTED,
              content: null,
              files: [],
              reviewHistories: [],
            },
          ]),
      },
    };
    const $transaction = jest.fn(
      (operation: (store: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    );
    const outsideSubmissionFindMany = jest.fn();
    const prisma = {
      $transaction,
      milestoneDocumentSubmission: { findMany: outsideSubmissionFindMany },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.withCollectionSnapshot(async (store) => {
      const milestone = await store.findMilestone(syntheticMilestoneId);
      const documents = await store.findByMilestoneId(syntheticMilestoneId);
      const applications = await store.findApprovedApplicationsForCollection(
        milestone?.programId ?? '',
      );
      const coordinates = await store.findSubmissionCoordinatesForCollection(
        documents.map((document) => document.id),
      );
      const submissions = await store.findSubmissionsForCollection(
        documents.map((document) => document.id),
        new Date('2026-09-20T00:00:00.000Z'),
        applications.map((application) => application.applicationId),
      );
      return { coordinates, submissions };
    });

    // Then
    expect($transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    expect(
      transaction.milestoneDocumentSubmission.findMany,
    ).toHaveBeenCalledTimes(2);
    expect(outsideSubmissionFindMany).not.toHaveBeenCalled();
    expect(result).toEqual({
      coordinates: [
        {
          milestoneDocumentId: syntheticDocumentId,
          applicationId: syntheticApplicationId,
        },
      ],
      submissions: [
        expect.objectContaining({
          milestoneDocumentId: syntheticDocumentId,
          applicationId: syntheticApplicationId,
          revision: 1,
        }),
      ],
    });
  });
});

describe('MilestoneDocumentsRepository.findByMilestoneId', () => {
  it('sortOrder 오름차순으로 조회하고 templateFile 유무를 templateFileId로 평탄화한다', async () => {
    // Given
    const findMany = jest.fn().mockResolvedValue([
      {
        id: syntheticDocumentId,
        milestoneId: syntheticMilestoneId,
        name: '개인정보 수집·이용 동의서',
        required: true,
        sortOrder: 1,
        templateFile: {
          id: 'cuid-synthetic-template',
          originalFileName: '운영결과보고서_2026.docx',
        },
      },
      {
        id: 'cuid-synthetic-document-2',
        milestoneId: syntheticMilestoneId,
        name: '팀 구성 확인서',
        required: false,
        sortOrder: 2,
        templateFile: null,
      },
    ]);
    const prisma = {
      milestoneDocument: { findMany },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.findByMilestoneId(syntheticMilestoneId);

    // Then
    expect(findMany).toHaveBeenCalledWith({
      where: {
        milestoneId: syntheticMilestoneId,
        kind: MilestoneDocumentKind.DOCUMENT,
      },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        milestoneId: true,
        name: true,
        required: true,
        sortOrder: true,
        templateFile: { select: { id: true, originalFileName: true } },
      },
    });
    expect(result[0]?.templateFileId).toBe('cuid-synthetic-template');
    expect(result[0]?.templateFileName).toBe('운영결과보고서_2026.docx');
    expect(result[1]?.templateFileId).toBeNull();
    expect(result[1]?.templateFileName).toBeNull();
  });
});

describe('MilestoneDocumentsRepository.findActiveUser', () => {
  it('githubId + ACTIVE 조건으로 id/role만 select한다', async () => {
    // Given
    const findFirst = jest
      .fn()
      .mockResolvedValue({ id: syntheticUserId, role: 'STUDENT' });
    const prisma = { user: { findFirst } } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    await repository.findActiveUser(9001n);

    // Then
    expect(findFirst).toHaveBeenCalledWith({
      where: { githubId: 9001n, accountStatus: AccountStatus.ACTIVE },
      select: { id: true, hasStaffAccess: true, hasAdminAccess: true },
    });
  });
});

describe('MilestoneDocumentsRepository.countApprovedApplications / countSubmissionsByDocument', () => {
  it('승인된 신청 수를 센다', async () => {
    // Given
    const count = jest.fn().mockResolvedValue(8);
    const prisma = { application: { count } } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.countApprovedApplications('cuid-program');

    // Then
    expect(count).toHaveBeenCalledWith({
      where: { programId: 'cuid-program', status: ApplicationStatus.APPROVED },
    });
    expect(result).toBe(8);
  });

  it('documentIds가 비어 있으면 groupBy를 호출하지 않고 빈 맵을 돌려준다', async () => {
    // Given
    const groupBy = jest.fn();
    const prisma = {
      milestoneDocumentSubmission: { groupBy },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.countSubmissionsByDocument(
      'cuid-program',
      [],
    );

    // Then
    expect(groupBy).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  it('서류별 제출 신청 수를 Map으로 돌려준다', async () => {
    // Given
    const groupBy = jest
      .fn()
      .mockResolvedValue([
        { milestoneDocumentId: syntheticDocumentId, _count: { _all: 6 } },
      ]);
    const prisma = {
      milestoneDocumentSubmission: { groupBy },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.countSubmissionsByDocument('cuid-program', [
      syntheticDocumentId,
    ]);

    // Then
    expect(result.get(syntheticDocumentId)).toBe(6);
  });

  /**
   * #1100 — 분자도 분모와 같은 모집단(같은 프로그램의 승인된 신청)을 세는지 본다. 이 조건이
   * 빠지면 승인을 되돌린 팀의 제출이 분자에만 남아 「1 / 0팀 제출」이 나온다.
   */
  it('분자는 분모와 같은 모집단 — 같은 프로그램의 승인된 신청 제출만 센다', async () => {
    // Given
    const groupBy = jest.fn().mockResolvedValue([]);
    const prisma = {
      milestoneDocumentSubmission: { groupBy },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    await repository.countSubmissionsByDocument('cuid-program', [
      syntheticDocumentId,
    ]);

    // Then
    expect(groupBy).toHaveBeenCalledWith({
      by: ['milestoneDocumentId'],
      where: {
        milestoneDocumentId: { in: [syntheticDocumentId] },
        application: {
          programId: 'cuid-program',
          status: ApplicationStatus.APPROVED,
        },
      },
      _count: { _all: true },
    });
  });
});

describe('MilestoneDocumentsRepository 교직원 CRUD (store)', () => {
  /**
   * 교직원 쓰기 경로는 전부 `withTransaction`의 store를 지난다. 트랜잭션 밖 클라이언트에도 같은
   * 이름의 메서드를 달아 두고 **그쪽이 호출되면 실패**하게 한다 — 잠금 없는 단발 경로가
   * 되살아나는 것을 이 목이 잡는다.
   */
  function buildStorePrisma() {
    const create = jest.fn().mockResolvedValue({
      id: syntheticDocumentId,
      milestoneId: syntheticMilestoneId,
      name: '새 서류',
      required: true,
      sortOrder: 3,
    });
    const templateDeleteMany = jest.fn();
    const documentDelete = jest.fn();
    const count = jest.fn().mockResolvedValue(2);
    // 생성은 잠금 아래에서 max+1을 계산한다 — 지금 마지막 항목이 2번이라는 뜻.
    const aggregate = jest.fn().mockResolvedValue({ _max: { sortOrder: 2 } });
    const direct = {
      create: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    };
    const prisma = {
      milestoneDocument: { create: direct.create, delete: direct.delete },
      milestoneDocumentTemplateFile: { deleteMany: direct.deleteMany },
      milestoneDocumentSubmission: { count: direct.count },
      $transaction: jest.fn((callback: (transaction: unknown) => unknown) =>
        callback({
          milestoneDocument: { create, delete: documentDelete, aggregate },
          milestoneDocumentTemplateFile: { deleteMany: templateDeleteMany },
          milestoneDocumentSubmission: { count },
        }),
      ),
    } as unknown as PrismaService;
    return {
      prisma,
      create,
      aggregate,
      templateDeleteMany,
      documentDelete,
      count,
      direct,
    };
  }

  it('createDocument는 sortOrder를 잠금 아래에서 max+1로 정해 맨 뒤에 붙인다', async () => {
    // Given: 순서는 서버가 정한다 — 요청 값을 믿으면 두 교직원이 동시에 추가할 때 겹친다.
    const { prisma, create, aggregate, direct } = buildStorePrisma();
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.withTransaction((store) =>
      store.createDocument(syntheticMilestoneId, {
        name: '새 서류',
        required: true,
      }),
    );

    // Then
    expect(aggregate).toHaveBeenCalledWith({
      where: {
        milestoneId: syntheticMilestoneId,
        kind: MilestoneDocumentKind.DOCUMENT,
      },
      _max: { sortOrder: true },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          milestoneId: syntheticMilestoneId,
          name: '새 서류',
          required: true,
          sortOrder: 3,
          kind: MilestoneDocumentKind.DOCUMENT,
        },
      }),
    );
    expect(direct.create).not.toHaveBeenCalled();
    expect(result.templateFileId).toBeNull();
  });

  it('createDocument는 첫 항목이면 sortOrder를 1로 정한다', async () => {
    // Given: 아직 아무 항목도 없어 max가 null이다.
    const { prisma, create, aggregate } = buildStorePrisma();
    aggregate.mockResolvedValue({ _max: { sortOrder: null } });
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    await repository.withTransaction((store) =>
      store.createDocument(syntheticMilestoneId, {
        name: '첫 서류',
        required: false,
      }),
    );

    // Then
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          milestoneId: syntheticMilestoneId,
          name: '첫 서류',
          required: false,
          sortOrder: 1,
          kind: MilestoneDocumentKind.DOCUMENT,
        },
      }),
    );
  });

  it('deleteDocument는 같은 트랜잭션에서 양식 파일을 먼저 지우고 서류 항목을 지운다', async () => {
    // Given
    const { prisma, templateDeleteMany, documentDelete, direct } =
      buildStorePrisma();
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    await repository.withTransaction((store) =>
      store.deleteDocument(syntheticDocumentId),
    );

    // Then
    expect(templateDeleteMany).toHaveBeenCalledWith({
      where: { milestoneDocumentId: syntheticDocumentId },
    });
    expect(documentDelete).toHaveBeenCalledWith({
      where: {
        id: syntheticDocumentId,
        kind: MilestoneDocumentKind.DOCUMENT,
      },
    });
    expect(direct.deleteMany).not.toHaveBeenCalled();
    expect(direct.delete).not.toHaveBeenCalled();
  });

  it('countSubmissionsForDocument는 해당 서류의 제출 수를 트랜잭션 안에서 센다', async () => {
    // Given
    const { prisma, count, direct } = buildStorePrisma();
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.withTransaction((store) =>
      store.countSubmissionsForDocument(syntheticDocumentId),
    );

    // Then
    expect(count).toHaveBeenCalledWith({
      where: { milestoneDocumentId: syntheticDocumentId },
    });
    expect(direct.count).not.toHaveBeenCalled();
    expect(result).toBe(2);
  });
});

describe('MilestoneDocumentsRepository.upsertSubmission', () => {
  function transactionPrisma(
    overrides: Record<string, unknown>,
    /** 잠금 뒤 다시 읽은 최신 판정. 기본은 「아직 판정 없음」이다. */
    lockedLatestReview: { readonly id: string } | null = null,
  ) {
    const submissionUpsert = jest.fn().mockResolvedValue({
      id: 'cuid-synthetic-submission',
      status: SubmissionStatus.SUBMITTED,
      content: Prisma.JsonNull,
      submittedAt: new Date('2026-09-16T14:22:00.000Z'),
      revision: 2,
    });
    const historyCreate = jest.fn().mockResolvedValue({
      id: 'cuid-synthetic-history',
    });
    const historyFindFirst = jest.fn().mockResolvedValue(null);
    const fileUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    const fileFindMany = jest.fn().mockResolvedValue([]);
    const reviewFindFirst = jest.fn().mockResolvedValue(lockedLatestReview);
    const queryRaw = jest.fn().mockResolvedValue([{ id: syntheticDocumentId }]);
    const tx = {
      $queryRaw: queryRaw,
      milestoneDocumentSubmission: { upsert: submissionUpsert },
      milestoneDocumentReviewHistory: { findFirst: reviewFindFirst },
      milestoneDocumentSubmissionHistory: {
        create: historyCreate,
        findFirst: historyFindFirst,
      },
      submissionFile: { updateMany: fileUpdateMany, findMany: fileFindMany },
      ...overrides,
    };
    const prisma = {
      $transaction: jest.fn((callback: (transaction: unknown) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    return {
      prisma,
      submissionUpsert,
      fileUpdateMany,
      fileFindMany,
      queryRaw,
      reviewFindFirst,
      historyCreate,
      historyFindFirst,
    };
  }

  it('attachFile이 없으면(TEXT) 파일 붙이기를 건너뛴다', async () => {
    // Given
    const { prisma, fileUpdateMany } = transactionPrisma({});
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    await repository.upsertSubmission({
      milestoneDocumentId: syntheticDocumentId,
      applicationId: syntheticApplicationId,
      submittedById: syntheticUserId,
      submittedAt: new Date('2026-09-16T14:22:00.000Z'),
      content: { type: 'TEXT', text: '본문' },
      attachFile: null,
      expectedLatestReviewId: null,
    });

    // Then
    expect(fileUpdateMany).not.toHaveBeenCalled();
  });

  it('쓰기 직전 최신 마감 시각이 지났으면 제출을 저장하지 않는다', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ dueAt: new Date('2026-09-19T09:00:00.000Z') }]);
    const { prisma, submissionUpsert } = transactionPrisma({
      $queryRaw: queryRaw,
    });
    const repository = new MilestoneDocumentsRepository(prisma);

    await expect(
      repository.upsertSubmission({
        milestoneDocumentId: syntheticDocumentId,
        applicationId: syntheticApplicationId,
        submittedById: syntheticUserId,
        submittedAt: new Date('2026-09-19T09:00:00.001Z'),
        deadline: {
          milestoneId: syntheticMilestoneId,
          allowAfterDeadline: false,
        },
        content: { type: 'TEXT', text: '본문' },
        attachFile: null,
        expectedLatestReviewId: null,
      }),
    ).rejects.toBeInstanceOf(MilestoneDocumentDeadlineClosedError);
    expect(submissionUpsert).not.toHaveBeenCalled();
    expect(
      String(firstCallArgument<{ strings: string[] }>(queryRaw).strings),
    ).toContain('FOR SHARE');
  });

  it('보완 요청 예외는 마감 후에도 쓰기 직전 검사를 통과한다', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ dueAt: new Date('2026-09-19T09:00:00.000Z') }])
      .mockResolvedValueOnce([{ id: syntheticDocumentId }]);
    const { prisma, submissionUpsert } = transactionPrisma({
      $queryRaw: queryRaw,
    });
    const repository = new MilestoneDocumentsRepository(prisma);

    await repository.upsertSubmission({
      milestoneDocumentId: syntheticDocumentId,
      applicationId: syntheticApplicationId,
      submittedById: syntheticUserId,
      submittedAt: new Date('2026-09-20T00:00:00.000Z'),
      deadline: {
        milestoneId: syntheticMilestoneId,
        allowAfterDeadline: true,
      },
      content: { type: 'TEXT', text: '고친 본문' },
      attachFile: null,
      expectedLatestReviewId: null,
    });

    expect(submissionUpsert).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it('서류 행 존재를 FOR UPDATE로 잠근 다음에야 제출을 쓴다 — 삭제·판정·제출을 직렬화한다', async () => {
    // Given: 이 잠금이 없으면 삭제가 제출 upsert와 교차해 끊어진 관계를 만들 수 있다.
    const order: string[] = [];
    const queryRaw = jest.fn(() => {
      order.push('lock');
      return Promise.resolve([{ id: syntheticDocumentId }]);
    });
    const submissionUpsert = jest.fn(() => {
      order.push('upsert');
      return Promise.resolve({
        id: 'cuid-synthetic-submission',
        status: SubmissionStatus.SUBMITTED,
        content: Prisma.JsonNull,
        submittedAt: new Date('2026-09-16T14:22:00.000Z'),
      });
    });
    const { prisma } = transactionPrisma({
      $queryRaw: queryRaw,
      milestoneDocumentSubmission: { upsert: submissionUpsert },
    });
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    await repository.upsertSubmission({
      milestoneDocumentId: syntheticDocumentId,
      applicationId: syntheticApplicationId,
      submittedById: syntheticUserId,
      submittedAt: new Date('2026-09-16T14:22:00.000Z'),
      content: { type: 'TEXT', text: '본문' },
      attachFile: null,
      expectedLatestReviewId: null,
    });

    // Then
    expect(order).toEqual(['lock', 'upsert']);
    expect(
      String(firstCallArgument<{ strings: string[] }>(queryRaw).strings),
    ).toContain('FOR UPDATE');
    expect(
      String(firstCallArgument<{ strings: string[] }>(queryRaw).strings),
    ).toContain('"MilestoneDocument"');
  });

  it('잠금 시점에 서류가 사라졌으면 FK 오류 전에 좁은 not-found 오류를 낸다', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const { prisma, submissionUpsert } = transactionPrisma({
      $queryRaw: queryRaw,
    });
    const repository = new MilestoneDocumentsRepository(prisma);

    await expect(
      repository.upsertSubmission({
        milestoneDocumentId: syntheticDocumentId,
        applicationId: syntheticApplicationId,
        submittedById: syntheticUserId,
        submittedAt: new Date('2026-09-16T14:22:00.000Z'),
        content: { type: 'TEXT', text: '본문' },
        attachFile: null,
        expectedLatestReviewId: null,
      }),
    ).rejects.toBeInstanceOf(MilestoneDocumentMissingError);
    expect(submissionUpsert).not.toHaveBeenCalled();
  });

  it('직전 사건과 같은 시각의 재제출은 1ms 뒤로 저장한다', async () => {
    const latest = new Date('2026-09-16T14:22:00.000Z');
    const { prisma, submissionUpsert, historyCreate, historyFindFirst } =
      transactionPrisma({});
    historyFindFirst.mockResolvedValue({ createdAt: latest });
    const repository = new MilestoneDocumentsRepository(prisma);

    await repository.upsertSubmission({
      milestoneDocumentId: syntheticDocumentId,
      applicationId: syntheticApplicationId,
      submittedById: syntheticUserId,
      submittedAt: latest,
      content: { type: 'TEXT', text: '본문' },
      attachFile: null,
      expectedLatestReviewId: null,
    });

    const expected = new Date('2026-09-16T14:22:00.001Z');
    const upsertCall = firstCallArgument<{
      update: { submittedAt: Date };
      create: { submittedAt: Date };
    }>(submissionUpsert);
    const historyCall = firstCallArgument<{ data: { createdAt: Date } }>(
      historyCreate,
    );
    expect(upsertCall.update.submittedAt).toEqual(expected);
    expect(upsertCall.create.submittedAt).toEqual(expected);
    expect(historyCall.data.createdAt).toEqual(expected);
  });

  it('재제출 파일은 이전 파일을 지우지 않고 새 이력에 붙인다', async () => {
    // Given
    const fileUpdateMany = jest.fn().mockResolvedValueOnce({ count: 1 });
    const { prisma } = transactionPrisma({
      submissionFile: {
        updateMany: fileUpdateMany,
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'cuid-synthetic-file',
            originalFileName: '계획서.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
          },
        ]),
      },
    });
    const repository = new MilestoneDocumentsRepository(prisma);
    const submittedAt = new Date('2026-09-16T14:22:00.000Z');

    // When
    const result = await repository.upsertSubmission({
      milestoneDocumentId: syntheticDocumentId,
      applicationId: syntheticApplicationId,
      submittedById: syntheticUserId,
      submittedAt,
      content: Prisma.JsonNull,
      attachFile: {
        fileId: 'cuid-synthetic-file',
        uploaderId: syntheticUserId,
        milestoneId: syntheticMilestoneId,
      },
      expectedLatestReviewId: null,
    });

    // Then
    expect(fileUpdateMany).toHaveBeenCalledTimes(1);
    expect(fileUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'cuid-synthetic-file',
        uploaderId: syntheticUserId,
        applicationId: syntheticApplicationId,
        milestoneId: syntheticMilestoneId,
        lifecycle: SubmissionFileLifecycle.PENDING,
        pendingExpiresAt: { gt: submittedAt },
      },
      data: {
        milestoneDocumentSubmissionId: 'cuid-synthetic-submission',
        milestoneDocumentSubmissionHistoryId: 'cuid-synthetic-history',
        lifecycle: SubmissionFileLifecycle.ATTACHED,
        pendingExpiresAt: null,
      },
    });
    expect(result.files).toHaveLength(1);
  });

  it('pending 파일이 만료·소유자 불일치로 1건 붙지 않으면 MilestoneDocumentPendingFileMissingError를 던진다', async () => {
    // Given: pending → ATTACHED 갱신이 0건이다(만료됐거나 이미 다른 신청에 붙음).
    const fileUpdateMany = jest.fn().mockResolvedValueOnce({ count: 0 });
    const { prisma } = transactionPrisma({
      submissionFile: { updateMany: fileUpdateMany, findMany: jest.fn() },
    });
    const repository = new MilestoneDocumentsRepository(prisma);

    // When / Then
    await expect(
      repository.upsertSubmission({
        milestoneDocumentId: syntheticDocumentId,
        applicationId: syntheticApplicationId,
        submittedById: syntheticUserId,
        submittedAt: new Date('2026-09-16T14:22:00.000Z'),
        content: Prisma.JsonNull,
        attachFile: {
          fileId: 'cuid-expired-file',
          uploaderId: syntheticUserId,
          milestoneId: syntheticMilestoneId,
        },
        expectedLatestReviewId: null,
      }),
    ).rejects.toBeInstanceOf(MilestoneDocumentPendingFileMissingError);
  });

  it('잠근 뒤 다시 읽은 최신 판정이 기대와 다르면 제출을 쓰지 않는다', async () => {
    // Given: 서비스가 「판정 없음」을 보고 허용했는데, 그 사이 교직원이 판정을 등록했다.
    const { prisma, submissionUpsert } = transactionPrisma(
      {},
      { id: 'cuid-synthetic-review' },
    );
    const repository = new MilestoneDocumentsRepository(prisma);

    // When / Then
    await expect(
      repository.upsertSubmission({
        milestoneDocumentId: syntheticDocumentId,
        applicationId: syntheticApplicationId,
        submittedById: syntheticUserId,
        submittedAt: new Date('2026-09-16T14:22:00.000Z'),
        content: { type: 'TEXT', text: '본문' },
        attachFile: null,
        expectedLatestReviewId: null,
      }),
    ).rejects.toBeInstanceOf(MilestoneDocumentReviewChangedError);
    expect(submissionUpsert).not.toHaveBeenCalled();
  });

  it('판정이 그대로면(기대값과 같은 id) 제출을 쓴다', async () => {
    // Given: 보완 요청을 받고 다시 내는 정상 경로다.
    const { prisma, submissionUpsert } = transactionPrisma(
      {},
      { id: 'cuid-synthetic-review' },
    );
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    await repository.upsertSubmission({
      milestoneDocumentId: syntheticDocumentId,
      applicationId: syntheticApplicationId,
      submittedById: syntheticUserId,
      submittedAt: new Date('2026-09-16T14:22:00.000Z'),
      content: { type: 'TEXT', text: '본문' },
      attachFile: null,
      expectedLatestReviewId: 'cuid-synthetic-review',
    });

    // Then
    expect(submissionUpsert).toHaveBeenCalled();
  });

  it('재제출은 리비전을 DB에서 1 올린다 — 교직원이 본 버전과 갈라지는 유일한 표식이다', async () => {
    // Given: 리비전을 올리지 않으면 같은 밀리초에 겹친 재제출이 submittedAt·행 id·리비전
    // 어느 것도 바꾸지 않아, 판정 요청의 기대 버전 대조가 그대로 통과한다 — 교직원이 본 적
    // 없는 내용이 승인된다.
    const { prisma, submissionUpsert } = transactionPrisma({});
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    await repository.upsertSubmission({
      milestoneDocumentId: syntheticDocumentId,
      applicationId: syntheticApplicationId,
      submittedById: syntheticUserId,
      submittedAt: new Date('2026-09-16T14:22:00.000Z'),
      content: { type: 'TEXT', text: '본문' },
      attachFile: null,
      expectedLatestReviewId: null,
    });

    // Then: `{ increment: 1 }`이어야 한다. 값을 읽어 와 더한 뒤 쓰면(예: `revision: 4`)
    // 두 재제출이 같은 값을 읽어 같은 값을 써서 리비전이 한 번만 올라간다.
    const { update } = firstCallArgument<{
      update: Record<string, unknown>;
    }>(submissionUpsert);
    expect(update.revision).toEqual({ increment: 1 });
  });

  it('재제출은 현재 헤더와 별도로 RESUBMITTED 이력을 append한다', async () => {
    const { prisma, historyCreate } = transactionPrisma({});
    const repository = new MilestoneDocumentsRepository(prisma);
    const submittedAt = new Date('2026-09-16T14:22:00.000Z');

    await repository.upsertSubmission({
      milestoneDocumentId: syntheticDocumentId,
      applicationId: syntheticApplicationId,
      submittedById: syntheticUserId,
      submittedAt,
      content: { type: 'TEXT', text: '수정한 본문' },
      attachFile: null,
      expectedLatestReviewId: null,
    });

    expect(historyCreate).toHaveBeenCalledWith({
      data: {
        milestoneDocumentSubmissionId: 'cuid-synthetic-submission',
        event: MilestoneDocumentSubmissionHistoryEvent.RESUBMITTED,
        revision: 2,
        actorId: syntheticUserId,
        content: { type: 'TEXT', text: '수정한 본문' },
        createdAt: submittedAt,
      },
      select: { id: true },
    });
  });

  it('첫 제출은 리비전을 직접 쓰지 않는다 — 시작값 1은 스키마 기본값이 준다', async () => {
    // Given: create가 값을 들고 있으면 시작값이 스키마와 코드 두 곳에 생겨 언젠가 갈린다.
    const { prisma, submissionUpsert } = transactionPrisma({});
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    await repository.upsertSubmission({
      milestoneDocumentId: syntheticDocumentId,
      applicationId: syntheticApplicationId,
      submittedById: syntheticUserId,
      submittedAt: new Date('2026-09-16T14:22:00.000Z'),
      content: { type: 'TEXT', text: '본문' },
      attachFile: null,
      expectedLatestReviewId: null,
    });

    // Then
    const { create } = firstCallArgument<{
      create: Record<string, unknown>;
    }>(submissionUpsert);
    expect(create).not.toHaveProperty('revision');
  });

  it('판정 재확인은 서류 행을 FOR SHARE로 잠근 뒤에 한다 — 잠금 전에 읽으면 재확인이 아니다', async () => {
    // Given
    const order: string[] = [];
    const queryRaw = jest.fn(() => {
      order.push('lock');
      return Promise.resolve([{ id: syntheticDocumentId }]);
    });
    const reviewFindFirst = jest.fn(() => {
      order.push('readLatestReview');
      return Promise.resolve(null);
    });
    const { prisma } = transactionPrisma({
      $queryRaw: queryRaw,
      milestoneDocumentReviewHistory: { findFirst: reviewFindFirst },
    });
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    await repository.upsertSubmission({
      milestoneDocumentId: syntheticDocumentId,
      applicationId: syntheticApplicationId,
      submittedById: syntheticUserId,
      submittedAt: new Date('2026-09-16T14:22:00.000Z'),
      content: { type: 'TEXT', text: '본문' },
      attachFile: null,
      expectedLatestReviewId: null,
    });

    // Then
    expect(order).toEqual(['lock', 'readLatestReview']);
  });
});

describe('MilestoneDocumentsRepository.findMySubmission', () => {
  it('현재 revision과 연결된 파일만 학생의 현재 제출에 돌려준다', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 'cuid-synthetic-submission',
      status: SubmissionStatus.SUBMITTED,
      content: null,
      submittedAt: new Date('2026-09-16T14:22:00.000Z'),
      revision: 2,
      files: [
        {
          id: 'cuid-current-file',
          originalFileName: 'revision-2.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048,
          submissionHistory: { revision: 2 },
        },
      ],
    });
    const repository = new MilestoneDocumentsRepository({
      milestoneDocumentSubmission: { findUnique },
    } as unknown as PrismaService);

    const result = await repository.findMySubmission(
      syntheticDocumentId,
      syntheticApplicationId,
    );

    const call = firstCallArgument<{
      select: { files: { orderBy: unknown; take: number } };
    }>(findUnique);
    expect(call.select.files.orderBy).toEqual([
      {
        submissionHistory: {
          revision: { sort: 'desc', nulls: 'last' },
        },
      },
      { createdAt: 'desc' },
    ]);
    expect(call.select.files.take).toBe(1);
    expect(result?.files).toEqual([
      {
        id: 'cuid-current-file',
        originalFileName: 'revision-2.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
      },
    ]);
  });

  it('현재 revision과 다른 이력의 파일이면 학생의 현재 제출에 노출하지 않는다', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 'cuid-synthetic-submission',
      status: SubmissionStatus.SUBMITTED,
      content: null,
      submittedAt: new Date('2026-09-16T14:22:00.000Z'),
      revision: 2,
      files: [
        {
          id: 'cuid-older-file',
          originalFileName: 'revision-1.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          submissionHistory: { revision: 1 },
        },
      ],
    });
    const repository = new MilestoneDocumentsRepository({
      milestoneDocumentSubmission: { findUnique },
    } as unknown as PrismaService);

    const result = await repository.findMySubmission(
      syntheticDocumentId,
      syntheticApplicationId,
    );

    expect(result?.files).toEqual([]);
  });
});

describe('MilestoneDocumentsRepository 판정 쓰기 (store)', () => {
  /** 판정 경로도 트랜잭션 밖 클라이언트를 따로 세어, 잠금 없는 단발 경로로 새면 잡는다. */
  function buildReviewStorePrisma(
    options: { latestReview?: { id: string } | null } = {},
  ) {
    const submissionFindUnique = jest.fn().mockResolvedValue({
      id: 'cuid-synthetic-submission',
      revision: 3,
      histories: [{ id: 'cuid-synthetic-submission-history', revision: 3 }],
    });
    const reviewFindFirst = jest
      .fn()
      .mockResolvedValue(
        options.latestReview === undefined
          ? { id: 'cuid-synthetic-review' }
          : options.latestReview,
      );
    const submissionUpdate = jest.fn().mockResolvedValue({
      id: 'cuid-synthetic-submission',
    });
    const reviewCreate = jest.fn().mockResolvedValue({
      id: 'cuid-synthetic-review',
      decision: ReviewDecision.CHANGES_REQUESTED,
      comment: '2쪽 서명이 빠졌습니다.',
      reviewedAt: new Date('2026-09-18T09:00:00.000Z'),
      resubmissionDueAt: new Date('2026-09-25T09:00:00.000Z'),
      reviewer: { nickname: 'synthetic-staff' },
    });
    const historyCreate = jest.fn().mockResolvedValue({
      id: 'cuid-synthetic-decision-history',
    });
    const historyFindFirst = jest.fn().mockResolvedValue({
      createdAt: new Date('2026-09-17T09:00:00.000Z'),
    });
    const direct = { create: jest.fn(), update: jest.fn() };
    const prisma = {
      milestoneDocumentReviewHistory: { create: direct.create },
      milestoneDocumentSubmission: { update: direct.update },
      $transaction: jest.fn((callback: (transaction: unknown) => unknown) =>
        callback({
          milestoneDocumentSubmission: {
            findUnique: submissionFindUnique,
            update: submissionUpdate,
          },
          milestoneDocumentReviewHistory: {
            create: reviewCreate,
            findFirst: reviewFindFirst,
          },
          milestoneDocumentSubmissionHistory: {
            create: historyCreate,
            findFirst: historyFindFirst,
          },
        }),
      ),
    } as unknown as PrismaService;
    return {
      prisma,
      submissionFindUnique,
      submissionUpdate,
      reviewCreate,
      reviewFindFirst,
      historyCreate,
      direct,
    };
  }

  it('findSubmissionForReview는 (서류, 신청) 복합 키로 제출 한 건을 찾는다', async () => {
    // Given
    const { prisma, submissionFindUnique } = buildReviewStorePrisma();
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.withTransaction((store) =>
      store.findSubmissionForReview(
        syntheticDocumentId,
        syntheticApplicationId,
      ),
    );

    // Then
    expect(submissionFindUnique).toHaveBeenCalledWith({
      where: {
        milestoneDocumentId_applicationId: {
          milestoneDocumentId: syntheticDocumentId,
          applicationId: syntheticApplicationId,
        },
      },
      // revision까지 읽는 것이 요점이다 — 서비스가 「검토자가 본 그 버전인가」를 이 값으로
      // 대조한다. id만 읽으면 재제출로 내용이 바뀐 제출에 그대로 판정이 붙는다.
      // submittedAt이 아닌 이유는 같은 밀리초의 재제출이 같은 시각을 갖기 때문이다.
      select: {
        id: true,
        revision: true,
        histories: {
          where: {
            event: {
              in: [
                MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
                MilestoneDocumentSubmissionHistoryEvent.RESUBMITTED,
              ],
            },
          },
          orderBy: [{ revision: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          select: { id: true, revision: true },
        },
      },
    });
    expect(result).toEqual({
      id: 'cuid-synthetic-submission',
      revision: 3,
      submissionHistoryId: 'cuid-synthetic-submission-history',
      latestHistoryCreatedAt: new Date('2026-09-17T09:00:00.000Z'),
    });
  });

  it('findSubmissionForReview는 헤더와 최신 제출 이력 revision이 다르면 판정 대상을 만들지 않는다', async () => {
    const { prisma, submissionFindUnique } = buildReviewStorePrisma();
    submissionFindUnique.mockResolvedValue({
      id: 'cuid-synthetic-submission',
      revision: 3,
      histories: [{ id: 'cuid-synthetic-submission-history', revision: 2 }],
    });
    const repository = new MilestoneDocumentsRepository(prisma);

    const result = await repository.withTransaction((store) =>
      store.findSubmissionForReview(
        syntheticDocumentId,
        syntheticApplicationId,
      ),
    );

    expect(result).toBeNull();
  });

  it('findLatestReviewIdForSubmission은 수합 표와 같은 정렬로 최신 한 건의 id만 읽는다', async () => {
    // Given: 정렬이 갈라지면 화면이 본 「최신 판정」과 서버가 비교하는 「최신 판정」이 서로
    // 다른 행을 가리켜, 대조가 통과해도 덮어쓰기가 그대로 일어난다.
    const { prisma, reviewFindFirst } = buildReviewStorePrisma();
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.withTransaction((store) =>
      store.findLatestReviewIdForSubmission('cuid-synthetic-submission'),
    );

    // Then
    expect(reviewFindFirst).toHaveBeenCalledWith({
      where: { milestoneDocumentSubmissionId: 'cuid-synthetic-submission' },
      orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    expect(result).toBe('cuid-synthetic-review');
  });

  it('판정이 없으면 findLatestReviewIdForSubmission은 null이다', async () => {
    // Given: 「아직 아무도 보지 않았다」를 요청의 기대값 null과 맞출 수 있어야 한다.
    //  undefined가 새어 나가면 null 기대값과 어긋나 첫 판정이 전부 409가 된다.
    const { prisma } = buildReviewStorePrisma({ latestReview: null });
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.withTransaction((store) =>
      store.findLatestReviewIdForSubmission('cuid-synthetic-submission'),
    );

    // Then
    expect(result).toBeNull();
  });

  it('createReview는 create로 판정을 쌓는다 — upsert/update로 덮어쓰지 않는다', async () => {
    // Given: 덮어쓰면 지난 지적이 사라진다. 교직원이 바뀌어도 남아야 한다는 것이 요구다.
    const { prisma, reviewCreate, historyCreate, direct } =
      buildReviewStorePrisma();
    const repository = new MilestoneDocumentsRepository(prisma);
    const reviewedAt = new Date('2026-09-18T09:00:00.000Z');
    const resubmissionDueAt = new Date('2026-09-25T09:00:00.000Z');

    // When
    const result = await repository.withTransaction((store) =>
      store.createReview({
        milestoneDocumentSubmissionId: 'cuid-synthetic-submission',
        submissionHistoryId: 'cuid-synthetic-submission-history',
        revision: 3,
        reviewerId: 'cuid-synthetic-staff',
        decision: ReviewDecision.CHANGES_REQUESTED,
        comment: '2쪽 서명이 빠졌습니다.',
        resubmissionDueAt,
        reviewedAt,
      }),
    );

    // Then
    expect(reviewCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          milestoneDocumentSubmissionId: 'cuid-synthetic-submission',
          submissionHistoryId: 'cuid-synthetic-submission-history',
          reviewerId: 'cuid-synthetic-staff',
          decision: ReviewDecision.CHANGES_REQUESTED,
          comment: '2쪽 서명이 빠졌습니다.',
          resubmissionDueAt,
          reviewedAt,
        },
      }),
    );
    expect(direct.create).not.toHaveBeenCalled();
    expect(historyCreate).toHaveBeenCalledWith({
      data: {
        milestoneDocumentSubmissionId: 'cuid-synthetic-submission',
        event: MilestoneDocumentSubmissionHistoryEvent.CHANGES_REQUESTED,
        revision: 3,
        actorId: 'cuid-synthetic-staff',
        comment: '2쪽 서명이 빠졌습니다.',
        createdAt: reviewedAt,
      },
      select: { id: true },
    });
    // 응답이 쓸 표시 이름은 관계에서 평탄화해 내보낸다(내부 reviewerId는 내보내지 않는다).
    expect(result).toEqual({
      id: 'cuid-synthetic-review',
      decision: ReviewDecision.CHANGES_REQUESTED,
      comment: '2쪽 서명이 빠졌습니다.',
      reviewedAt,
      // 기한도 응답에 그대로 실린다 — 방금 저장한 보완 요청이 언제까지인지 화면이 바로 안다.
      resubmissionDueAt,
      reviewerNickname: 'synthetic-staff',
    });
  });

  it('updateSubmissionStatus는 트랜잭션 안에서 제출 상태만 갱신한다', async () => {
    // Given
    const { prisma, submissionUpdate, direct } = buildReviewStorePrisma();
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    await repository.withTransaction((store) =>
      store.updateSubmissionStatus(
        'cuid-synthetic-submission',
        SubmissionStatus.CHANGES_REQUESTED,
      ),
    );

    // Then
    expect(submissionUpdate).toHaveBeenCalledWith({
      where: { id: 'cuid-synthetic-submission' },
      data: { status: SubmissionStatus.CHANGES_REQUESTED },
      select: { id: true },
    });
    expect(direct.update).not.toHaveBeenCalled();
  });
});

describe('MilestoneDocumentsRepository.withTransaction', () => {
  /**
   * 트랜잭션 클라이언트와 트랜잭션 밖 클라이언트를 따로 세는 가짜 Prisma. store의 문장이
   * 트랜잭션 밖으로 새면(= 개별 연산으로 되돌아가면) direct 쪽이 호출된다.
   */
  function buildTransactionPrisma() {
    const transactionQueryRaw = jest.fn().mockResolvedValue([
      {
        id: syntheticDocumentId,
        milestoneId: syntheticMilestoneId,
      },
    ]);
    const transactionCount = jest.fn().mockResolvedValue(0);
    const transactionUpdate = jest.fn().mockResolvedValue({
      id: syntheticDocumentId,
      milestoneId: syntheticMilestoneId,
      name: '개인정보 수집·이용 동의서',
      required: true,
      sortOrder: 1,
      templateFile: null,
    });
    const directCount = jest.fn().mockResolvedValue(0);
    const directUpdate = jest.fn();
    const prisma = {
      milestoneDocument: { update: directUpdate },
      milestoneDocumentSubmission: { count: directCount },
      $transaction: jest.fn((callback: (transaction: unknown) => unknown) =>
        callback({
          $queryRaw: transactionQueryRaw,
          milestoneDocument: { update: transactionUpdate },
          milestoneDocumentSubmission: { count: transactionCount },
        }),
      ),
    } as unknown as PrismaService;
    return {
      prisma,
      transactionQueryRaw,
      transactionCount,
      transactionUpdate,
      directCount,
      directUpdate,
    };
  }

  it('store의 잠금·세기·갱신이 모두 같은 트랜잭션 클라이언트로 나간다', async () => {
    // Given
    const {
      prisma,
      transactionQueryRaw,
      transactionCount,
      transactionUpdate,
      directCount,
      directUpdate,
    } = buildTransactionPrisma();
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    await repository.withTransaction(async (store) => {
      await store.lockDocument(syntheticDocumentId);
      await store.countSubmissionsForDocument(syntheticDocumentId);
      return store.updateDocument(syntheticDocumentId, {
        name: '개인정보 수집·이용 동의서',
        required: true,
      });
    });

    // Then: 트랜잭션 밖 경로로는 한 문장도 나가지 않는다.
    expect(transactionQueryRaw).toHaveBeenCalledTimes(1);
    expect(transactionCount).toHaveBeenCalledTimes(1);
    expect(transactionUpdate).toHaveBeenCalledTimes(1);
    expect(directCount).not.toHaveBeenCalled();
    expect(directUpdate).not.toHaveBeenCalled();
  });

  it('lockDocument는 대상 행을 FOR UPDATE로 잠그고 다시 읽는다', async () => {
    // Given
    const { prisma, transactionQueryRaw } = buildTransactionPrisma();
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const locked = await repository.withTransaction((store) =>
      store.lockDocument(syntheticDocumentId),
    );

    // Then
    const sql = firstCallArgument<{ strings: string[]; values: unknown[] }>(
      transactionQueryRaw,
    );
    expect(String(sql.strings)).toContain('FOR UPDATE');
    expect(sql.values).toEqual([syntheticDocumentId]);
    expect(locked).toEqual({
      id: syntheticDocumentId,
      milestoneId: syntheticMilestoneId,
    });
  });

  it('lockDocument는 행이 없으면 null을 돌려준다', async () => {
    // Given
    const { prisma, transactionQueryRaw } = buildTransactionPrisma();
    transactionQueryRaw.mockResolvedValue([]);
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const locked = await repository.withTransaction((store) =>
      store.lockDocument(syntheticDocumentId),
    );

    // Then
    expect(locked).toBeNull();
  });

  it('updateDocument가 쓰는 data에는 sortOrder가 없다 — 순서는 order endpoint가 소유한다', async () => {
    // Given: 수정이 순서를 함께 저장하면 편집 화면에 박혀 있던 낡은 sortOrder가 그 사이 바뀐
    // 순서를 덮어 sortOrder가 겹친다.
    const { prisma, transactionUpdate } = buildTransactionPrisma();
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    await repository.withTransaction((store) =>
      store.updateDocument(syntheticDocumentId, {
        name: '개인정보 수집·이용 동의서',
        required: true,
      }),
    );

    // Then
    const args = firstCallArgument<{ data: Record<string, unknown> }>(
      transactionUpdate,
    );
    expect(args.data).toEqual({
      name: '개인정보 수집·이용 동의서',
      required: true,
    });
    expect(args.data).not.toHaveProperty('sortOrder');
  });

  it('lockMilestone은 마일스톤 행을 FOR UPDATE로 잠그고, 없으면 null을 돌려준다', async () => {
    // Given: 서류 항목 집합을 바꾸는 경로(추가·삭제·순서 재부여)의 공통 관문이다.
    const { prisma, transactionQueryRaw } = buildTransactionPrisma();
    transactionQueryRaw.mockResolvedValueOnce([{ id: syntheticMilestoneId }]);
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const locked = await repository.withTransaction((store) =>
      store.lockMilestone(syntheticMilestoneId),
    );

    // Then
    const sql = firstCallArgument<{ strings: string[]; values: unknown[] }>(
      transactionQueryRaw,
    );
    expect(String(sql.strings)).toContain('FROM "Milestone"');
    expect(String(sql.strings)).toContain('FOR UPDATE');
    expect(sql.values).toEqual([syntheticMilestoneId]);
    expect(locked?.id).toBe(syntheticMilestoneId);

    // Given / When: 행이 없으면
    transactionQueryRaw.mockResolvedValueOnce([]);
    const missing = await repository.withTransaction((store) =>
      store.lockMilestone(syntheticMilestoneId),
    );

    // Then
    expect(missing).toBeNull();
  });

  it('lockDocumentIdsOfMilestone은 이 마일스톤의 서류 행 전체를 id 오름차순으로 잠그고 그 id를 돌려준다', async () => {
    // Given: 순서 재부여는 트랜잭션 밖에서 읽어 둔 집합이 아니라 **이 값**과 요청을 대조한다.
    const { prisma, transactionQueryRaw } = buildTransactionPrisma();
    transactionQueryRaw.mockResolvedValueOnce([
      { id: 'cuid-synthetic-document-1' },
      { id: 'cuid-synthetic-document-2' },
    ]);
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const ids = await repository.withTransaction((store) =>
      store.lockDocumentIdsOfMilestone(syntheticMilestoneId),
    );

    // Then
    const sql = firstCallArgument<{ strings: string[]; values: unknown[] }>(
      transactionQueryRaw,
    );
    expect(String(sql.strings)).toContain('FROM "MilestoneDocument"');
    expect(String(sql.strings)).toContain('ORDER BY "id"');
    expect(String(sql.strings)).toContain('"kind"');
    expect(String(sql.strings)).toContain('FOR UPDATE');
    expect(sql.values).toEqual([
      syntheticMilestoneId,
      MilestoneDocumentKind.DOCUMENT,
    ]);
    expect(ids).toEqual([
      'cuid-synthetic-document-1',
      'cuid-synthetic-document-2',
    ]);
  });
});

/** jest 목의 첫 호출 인자를 명시 타입으로 읽는다 — `any` 전파 없이 select/where를 검사하려는 것이다. */
function firstCallArgument<T>(mock: jest.Mock): T {
  const calls = mock.mock.calls as readonly (readonly unknown[])[];
  return calls[0]?.[0] as T;
}

describe('MilestoneDocumentsRepository.findApprovedApplicationsForCollection', () => {
  it('승인된 신청만 팀 이름 오름차순으로 조회하고 표시 이름 관례를 그대로 쓴다', async () => {
    // Given
    const findMany = jest.fn().mockResolvedValue([
      {
        id: syntheticApplicationId,
        applicant: { profile: { name: '합성 신청자' } },
        team: {
          name: '가나다팀',
          members: [
            { user: { nickname: 'synthetic-leader' } },
            { user: { nickname: 'synthetic-member' } },
          ],
        },
      },
    ]);
    const prisma = { application: { findMany } } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result =
      await repository.findApprovedApplicationsForCollection('cuid-program');

    // Then
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          programId: 'cuid-program',
          status: ApplicationStatus.APPROVED,
        },
        orderBy: [{ team: { name: 'asc' } }, { id: 'asc' }],
      }),
    );
    expect(result).toEqual([
      {
        applicationId: syntheticApplicationId,
        teamName: '가나다팀',
        applicantName: '합성 신청자',
        memberNicknames: ['synthetic-leader', 'synthetic-member'],
      },
    ]);
  });

  it('팀원은 TeamMember createdAt 오름차순으로 조회한다', async () => {
    // Given
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { application: { findMany } } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    await repository.findApprovedApplicationsForCollection('cuid-program');

    // Then
    const call = firstCallArgument<{
      select: { team: { select: { members: { orderBy: unknown } } } };
    }>(findMany);
    expect(call.select.team.select.members.orderBy).toEqual({
      createdAt: 'asc',
    });
  });

  it('프로필이 있으면 프로필 이름을 신청자 이름으로 쓴다', async () => {
    // Given: User.name과 Profile.name이 다르다.
    const findMany = jest.fn().mockResolvedValue([
      {
        id: syntheticApplicationId,
        applicant: { name: '옛 이름', profile: { name: '프로필 이름' } },
        team: { name: '가나다팀', members: [] },
      },
    ]);
    const prisma = { application: { findMany } } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result =
      await repository.findApprovedApplicationsForCollection('cuid-program');

    // Then
    expect(result[0]?.applicantName).toBe('프로필 이름');
  });
});

describe('MilestoneDocumentsRepository.findSubmissionsForCollection', () => {
  const now = new Date('2026-09-20T00:00:00.000Z');

  it('documentIds가 비어 있으면 조회하지 않는다', async () => {
    // Given
    const findMany = jest.fn();
    const prisma = {
      milestoneDocumentSubmission: { findMany },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.findSubmissionsForCollection([], now);

    // Then
    expect(findMany).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('ATTACHED이고 아직 만료되지 않은 첨부만 붙인다', async () => {
    // Given
    const findMany = jest.fn().mockResolvedValue([
      {
        milestoneDocumentId: syntheticDocumentId,
        applicationId: syntheticApplicationId,
        submittedAt: new Date('2026-09-16T14:22:00.000Z'),
        revision: 2,
        status: SubmissionStatus.SUBMITTED,
        files: [
          {
            originalFileName: '최종_진짜최종.hwp',
            sizeBytes: 2048,
            submissionHistory: { revision: 2 },
          },
        ],
        histories: [],
        reviewHistories: [],
      },
    ]);
    const prisma = {
      milestoneDocumentSubmission: { findMany },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.findSubmissionsForCollection(
      [syntheticDocumentId],
      now,
    );

    // Then: 만료 필터가 빠지면 「목록엔 보이는데 받으면 실패」가 생긴다.
    const call = firstCallArgument<{
      select: {
        files: { where: unknown; orderBy: unknown; take: number };
      };
    }>(findMany);
    expect(call.select.files.where).toEqual({
      lifecycle: SubmissionFileLifecycle.ATTACHED,
      expiresAt: { gt: now },
    });
    expect(call.select.files.take).toBe(1);
    expect(call.select.files.orderBy).toEqual([
      {
        submissionHistory: {
          revision: { sort: 'desc', nulls: 'last' },
        },
      },
      { createdAt: 'desc' },
    ]);
    expect(result[0]?.file).toEqual({
      originalFileName: '최종_진짜최종.hwp',
      sizeBytes: 2048,
    });
  });

  it('현재 revision과 다른 이력의 파일은 수합 표에 현재 파일로 붙이지 않는다', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        milestoneDocumentId: syntheticDocumentId,
        applicationId: syntheticApplicationId,
        submittedAt: new Date('2026-09-16T14:22:00.000Z'),
        revision: 2,
        status: SubmissionStatus.SUBMITTED,
        content: null,
        files: [
          {
            originalFileName: 'revision-1.pdf',
            sizeBytes: 1024,
            submissionHistory: { revision: 1 },
          },
        ],
        histories: [],
        reviewHistories: [],
      },
    ]);
    const repository = new MilestoneDocumentsRepository({
      milestoneDocumentSubmission: { findMany },
    } as unknown as PrismaService);

    const result = await repository.findSubmissionsForCollection(
      [syntheticDocumentId],
      now,
    );

    expect(result[0]?.file).toBeNull();
  });

  it('붙은 첨부가 없으면 file은 null이다', async () => {
    // Given
    const findMany = jest.fn().mockResolvedValue([
      {
        milestoneDocumentId: syntheticDocumentId,
        applicationId: syntheticApplicationId,
        submittedAt: new Date('2026-09-16T14:22:00.000Z'),
        status: SubmissionStatus.SUBMITTED,
        files: [],
        reviewHistories: [],
      },
    ]);
    const prisma = {
      milestoneDocumentSubmission: { findMany },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.findSubmissionsForCollection(
      [syntheticDocumentId],
      now,
    );

    // Then
    expect(result[0]?.file).toBeNull();
    expect(result[0]?.review).toBeNull();
  });

  it('칸에 리비전을 함께 싣는다 — 프런트가 판정 요청에 되돌려 보낼 값이다', async () => {
    // Given: 이 값이 응답에 없으면 교직원 화면은 expectedRevision에 보낼 것이 없어 판정을
    // 아예 못 하거나, 추측한 값으로 보내 늘 409를 받는다.
    const findMany = jest.fn().mockResolvedValue([
      {
        milestoneDocumentId: syntheticDocumentId,
        applicationId: syntheticApplicationId,
        submittedAt: new Date('2026-09-19T08:00:00.000Z'),
        revision: 2,
        status: SubmissionStatus.SUBMITTED,
        content: null,
        files: [],
        reviewHistories: [],
      },
    ]);
    const prisma = {
      milestoneDocumentSubmission: { findMany },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.findSubmissionsForCollection(
      [syntheticDocumentId],
      now,
    );

    // Then
    const call = firstCallArgument<{ select: { revision: unknown } }>(findMany);
    expect(call.select.revision).toBe(true);
    expect(result[0]?.revision).toBe(2);
  });

  it('제출 상태를 판정과 함께 싣는다 — 재제출로 되돌아온 칸을 표가 알아야 한다', async () => {
    // Given: 보완 요청에 응해 다시 낸 제출이다. 상태는 SUBMITTED로 되돌아왔지만 최신 판정은
    // CHANGES_REQUESTED로 남아 있다. 상태를 싣지 않으면 표가 옛 판정으로만 칸을 그린다.
    const reviewedAt = new Date('2026-09-18T09:00:00.000Z');
    const findMany = jest.fn().mockResolvedValue([
      {
        milestoneDocumentId: syntheticDocumentId,
        applicationId: syntheticApplicationId,
        submittedAt: new Date('2026-09-19T08:00:00.000Z'),
        status: SubmissionStatus.SUBMITTED,
        files: [],
        reviewHistories: [
          {
            decision: ReviewDecision.CHANGES_REQUESTED,
            comment: '2쪽 서명이 빠졌습니다.',
            reviewedAt,
          },
        ],
      },
    ]);
    const prisma = {
      milestoneDocumentSubmission: { findMany },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.findSubmissionsForCollection(
      [syntheticDocumentId],
      now,
    );

    // Then: 같은 조회에서 함께 읽는다(칸마다 다시 묻지 않는다).
    const call = firstCallArgument<{ select: { status: unknown } }>(findMany);
    expect(call.select.status).toBe(true);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(result[0]?.status).toBe(SubmissionStatus.SUBMITTED);
    expect(result[0]?.review?.decision).toBe(ReviewDecision.CHANGES_REQUESTED);
  });

  it('수합 표는 이력을 싣지 않고 최신 판정 한 건만 붙인다', async () => {
    // Given: 판정은 쌓이므로 정렬 없이 읽으면 어느 판정이 「지금 판정」인지 정해지지 않는다.
    const firstReviewedAt = new Date('2026-09-17T09:00:00.000Z');
    const reviewedAt = new Date('2026-09-18T09:00:00.000Z');
    const findMany = jest.fn().mockResolvedValue([
      {
        milestoneDocumentId: syntheticDocumentId,
        applicationId: syntheticApplicationId,
        submittedAt: new Date('2026-09-16T14:22:00.000Z'),
        status: SubmissionStatus.CHANGES_REQUESTED,
        files: [],
        histories: [
          {
            event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
            revision: 1,
            comment: null,
            createdAt: new Date('2026-09-16T14:22:00.000Z'),
            actor: { nickname: 'synthetic-student' },
            files: [{ originalFileName: '계획서-v1.pdf' }],
          },
        ],
        reviewHistories: [
          {
            id: 'cuid-synthetic-review-2',
            decision: ReviewDecision.CHANGES_REQUESTED,
            comment: '2쪽 서명이 빠졌습니다.',
            reviewedAt,
            resubmissionDueAt: new Date('2026-09-25T09:00:00.000Z'),
            reviewer: { nickname: 'synthetic-staff-2' },
            submissionHistory: { revision: 1 },
          },
          {
            id: 'cuid-synthetic-review-1',
            decision: ReviewDecision.APPROVED,
            comment: null,
            reviewedAt: firstReviewedAt,
            resubmissionDueAt: null,
            reviewer: { nickname: 'synthetic-staff-1' },
            submissionHistory: { revision: 1 },
          },
        ],
      },
    ]);
    const prisma = {
      milestoneDocumentSubmission: { findMany },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.findSubmissionsForCollection(
      [syntheticDocumentId],
      now,
    );

    // Then: 최신 한 건만 읽고, 전체 이력은 단건 cursor endpoint에 맡긴다.
    const call = firstCallArgument<{
      select: {
        reviewHistories: { orderBy: unknown; select: unknown };
      };
    }>(findMany);
    expect(call.select.reviewHistories.orderBy).toEqual([
      { reviewedAt: 'desc' },
      { id: 'desc' },
    ]);
    expect(call.select.reviewHistories.select).toEqual({
      id: true,
      decision: true,
      comment: true,
      reviewedAt: true,
      // 기한을 함께 읽지 않으면 표는 「언제까지」를 모른 채 배지만 그린다.
      resubmissionDueAt: true,
      reviewer: { select: { nickname: true } },
      submissionHistory: { select: { revision: true } },
    });
    expect(result[0]?.review).toEqual({
      id: 'cuid-synthetic-review-2',
      decision: ReviewDecision.CHANGES_REQUESTED,
      comment: '2쪽 서명이 빠졌습니다.',
      reviewedAt,
      resubmissionDueAt: new Date('2026-09-25T09:00:00.000Z'),
    });
  });

  it('글 제출의 본문을 칸 재료에 함께 싣는다', async () => {
    // Given: TEXT 서류는 첨부가 없다. content를 읽지 않으면 교직원이
    // 제출 내용을 한 글자도 보지 못한 채 승인·반려하게 된다.
    const findMany = jest.fn().mockResolvedValue([
      {
        milestoneDocumentId: syntheticDocumentId,
        applicationId: syntheticApplicationId,
        submittedAt: new Date('2026-09-16T14:22:00.000Z'),
        status: SubmissionStatus.SUBMITTED,
        content: { type: 'TEXT', text: '3주차까지 인터뷰 8건을 마쳤습니다.' },
        files: [],
        reviewHistories: [],
      },
    ]);
    const prisma = {
      milestoneDocumentSubmission: { findMany },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.findSubmissionsForCollection(
      [syntheticDocumentId],
      now,
    );

    // Then
    const call = firstCallArgument<{ select: { content?: boolean } }>(findMany);
    expect(call.select.content).toBe(true);
    expect(result[0]?.content).toEqual({
      type: 'TEXT',
      text: '3주차까지 인터뷰 8건을 마쳤습니다.',
    });
  });

  it('표 조회의 select에는 storageKey가 없다 — 스토리지 열쇠가 응답 DTO로 샐 길을 구조적으로 막는다', async () => {
    // Given: 이 조회의 결과는 브라우저로 나가는 응답 본문이 된다. 여기에 열쇠가 실려 있으면
    // 매핑을 한 번만 잘못해도 객체 키가 그대로 화면에 노출된다. ZIP 조회
    // (findSubmissionsForArchive)를 따로 둔 이유가 그것이다.
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      milestoneDocumentSubmission: { findMany },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    await repository.findSubmissionsForCollection([syntheticDocumentId], now);

    // Then
    const call = firstCallArgument<{
      select: { files: { select: Record<string, unknown> } };
    }>(findMany);
    expect(call.select.files.select).toEqual({
      originalFileName: true,
      sizeBytes: true,
      submissionHistory: { select: { revision: true } },
    });
    expect(call.select.files.select).not.toHaveProperty('storageKey');
  });
});

describe('MilestoneDocumentsRepository.findSubmissionsForArchive', () => {
  const now = new Date('2026-09-20T00:00:00.000Z');

  it('documentIds가 비어 있으면 조회하지 않는다', async () => {
    // Given
    const findMany = jest.fn();
    const prisma = {
      milestoneDocumentSubmission: { findMany },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.findSubmissionsForArchive([], now);

    // Then: 서류 항목이 하나도 없는 마일스톤도 ZIP을 만들 수 있어야 한다(현황표만 담긴다).
    expect(findMany).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('첨부의 storageKey를 함께 뽑는다 — 표 조회와 갈라 둔 이유가 이 열쇠다', async () => {
    // Given
    const findMany = jest.fn().mockResolvedValue([
      {
        milestoneDocumentId: syntheticDocumentId,
        applicationId: syntheticApplicationId,
        submittedAt: new Date('2026-09-16T14:22:00.000Z'),
        revision: 2,
        status: SubmissionStatus.SUBMITTED,
        content: null,
        files: [
          {
            storageKey: 'synthetic/milestone-documents/synthetic-object',
            originalFileName: '최종_진짜최종.hwp',
            sizeBytes: 2048,
            lifecycle: SubmissionFileLifecycle.ATTACHED,
            expiresAt: new Date('2026-10-01T00:00:00.000Z'),
            submissionHistory: { revision: 2 },
          },
        ],
      },
    ]);
    const prisma = {
      milestoneDocumentSubmission: { findMany },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.findSubmissionsForArchive(
      [syntheticDocumentId],
      now,
    );

    // Then: 열쇠가 없으면 압축이 스토리지에서 파일을 꺼내 올 방법이 없다.
    const call = firstCallArgument<{
      select: { files: { select: Record<string, unknown> } };
    }>(findMany);
    expect(call.select.files.select).toEqual({
      storageKey: true,
      originalFileName: true,
      sizeBytes: true,
      lifecycle: true,
      expiresAt: true,
      submissionHistory: { select: { revision: true } },
    });
    expect(result[0]?.file).toEqual({
      storageKey: 'synthetic/milestone-documents/synthetic-object',
      originalFileName: '최종_진짜최종.hwp',
      sizeBytes: 2048,
    });
    expect(result[0]?.hasCurrentFileEvidence).toBe(true);
  });

  it('현재 revision과 다른 이력의 파일은 ZIP에 넣지 않는다', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        milestoneDocumentId: syntheticDocumentId,
        applicationId: syntheticApplicationId,
        submittedAt: new Date('2026-09-16T14:22:00.000Z'),
        revision: 2,
        status: SubmissionStatus.SUBMITTED,
        content: null,
        files: [
          {
            storageKey: 'objects/revision-1',
            originalFileName: 'revision-1.pdf',
            sizeBytes: 1024,
            lifecycle: SubmissionFileLifecycle.ATTACHED,
            expiresAt: new Date('2026-10-01T00:00:00.000Z'),
            submissionHistory: { revision: 1 },
          },
        ],
      },
    ]);
    const repository = new MilestoneDocumentsRepository({
      milestoneDocumentSubmission: { findMany },
    } as unknown as PrismaService);

    const result = await repository.findSubmissionsForArchive(
      [syntheticDocumentId],
      now,
    );

    expect(result[0]?.file).toBeNull();
    expect(result[0]?.hasCurrentFileEvidence).toBe(false);
  });

  it('현재 revision 증거를 판정하도록 최신 첨부 1건을 읽는다', async () => {
    // Given
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      milestoneDocumentSubmission: { findMany },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    await repository.findSubmissionsForArchive([syntheticDocumentId], now);

    // Then: 조건이 빠지면 이미 지워졌거나 아직 붙지 않은 파일을 열러 가 압축이 통째로 끊긴다.
    const call = firstCallArgument<{
      where: unknown;
      select: { files: { where?: unknown; orderBy: unknown; take: number } };
    }>(findMany);
    expect(call.where).toEqual({
      milestoneDocumentId: { in: [syntheticDocumentId] },
    });
    expect(call.select.files.where).toBeUndefined();
    expect(call.select.files.orderBy).toEqual([
      {
        submissionHistory: {
          revision: { sort: 'desc', nulls: 'last' },
        },
      },
      { createdAt: 'desc' },
    ]);
    expect(call.select.files.take).toBe(1);
  });

  it('현재 revision 파일이 만료됐으면 증거는 남기고 ZIP 파일만 제외한다', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        milestoneDocumentId: syntheticDocumentId,
        applicationId: syntheticApplicationId,
        submittedAt: new Date('2026-09-16T14:22:00.000Z'),
        revision: 2,
        status: SubmissionStatus.SUBMITTED,
        content: { type: 'TEXT', text: '보존된 본문' },
        files: [
          {
            storageKey: 'objects/expired',
            originalFileName: 'expired.pdf',
            sizeBytes: 1024,
            lifecycle: SubmissionFileLifecycle.ATTACHED,
            expiresAt: new Date('2026-09-19T00:00:00.000Z'),
            submissionHistory: { revision: 2 },
          },
        ],
      },
    ]);
    const repository = new MilestoneDocumentsRepository({
      milestoneDocumentSubmission: { findMany },
    } as unknown as PrismaService);

    const [result] = await repository.findSubmissionsForArchive(
      [syntheticDocumentId],
      now,
    );

    expect(result).toMatchObject({
      hasCurrentFileEvidence: true,
      file: null,
    });
  });

  it('붙은 첨부가 없으면 file은 null이다 — 글 제출은 본문으로 담는다', async () => {
    // Given: TEXT 제출은 첨부가 없고 content만 있다.
    const findMany = jest.fn().mockResolvedValue([
      {
        milestoneDocumentId: syntheticDocumentId,
        applicationId: syntheticApplicationId,
        submittedAt: new Date('2026-09-16T14:22:00.000Z'),
        status: SubmissionStatus.SUBMITTED,
        content: { type: 'TEXT', text: '3주차까지 인터뷰 8건을 마쳤습니다.' },
        files: [],
      },
    ]);
    const prisma = {
      milestoneDocumentSubmission: { findMany },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.findSubmissionsForArchive(
      [syntheticDocumentId],
      now,
    );

    // Then
    expect(result[0]?.file).toBeNull();
    expect(result[0]?.hasCurrentFileEvidence).toBe(false);
    expect(result[0]?.content).toEqual({
      type: 'TEXT',
      text: '3주차까지 인터뷰 8건을 마쳤습니다.',
    });
  });

  it('ZIP이 쓰지 않는 판정 이력은 빼고, 현재 파일 대조용 revision만 뽑는다', async () => {
    // Given: 압축 스트림은 그 값을 한 번도 쓰지 않는다. 조회에 남겨 두면 언젠가 쓰인다.
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      milestoneDocumentSubmission: { findMany },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    await repository.findSubmissionsForArchive([syntheticDocumentId], now);

    // Then
    const call = firstCallArgument<{ select: Record<string, unknown> }>(
      findMany,
    );
    expect(call.select).not.toHaveProperty('reviewHistories');
    expect(call.select.revision).toBe(true);
    expect(call.select).toMatchObject({
      milestoneDocumentId: true,
      applicationId: true,
      submittedAt: true,
      status: true,
      content: true,
    });
  });
});

describe('MilestoneDocumentsRepository.findSubmittedSummaries', () => {
  it('제출 상태와 최신 판정을 한 번의 조회로 함께 싣는다 — 칸마다 다시 묻지 않는다', async () => {
    // Given
    const submittedAt = new Date('2026-09-16T14:22:00.000Z');
    const reviewedAt = new Date('2026-09-18T09:00:00.000Z');
    const findMany = jest.fn().mockResolvedValue([
      {
        milestoneDocumentId: syntheticDocumentId,
        submittedAt,
        revision: 2,
        status: SubmissionStatus.CHANGES_REQUESTED,
        _count: { histories: 2 },
        files: [{ submissionHistory: { revision: 2 } }],
        reviewHistories: [
          {
            id: 'cuid-synthetic-review',
            decision: ReviewDecision.CHANGES_REQUESTED,
            comment: '2쪽 서명이 빠졌습니다.',
            reviewedAt,
            reviewer: { nickname: 'synthetic-staff' },
            submissionHistory: { revision: 1 },
          },
        ],
      },
    ]);
    const prisma = {
      milestoneDocumentSubmission: { findMany },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.findSubmittedSummaries(
      syntheticApplicationId,
      [syntheticDocumentId],
    );

    // Then
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(result[0]).toEqual({
      milestoneDocumentId: syntheticDocumentId,
      submittedAt,
      revision: 2,
      status: SubmissionStatus.CHANGES_REQUESTED,
      hasCurrentFile: true,
      historyComplete: true,
      review: {
        id: 'cuid-synthetic-review',
        decision: ReviewDecision.CHANGES_REQUESTED,
        comment: '2쪽 서명이 빠졌습니다.',
        reviewedAt,
      },
    });
  });

  it('아직 아무도 판정하지 않았으면 review는 null이다', async () => {
    // Given
    const findMany = jest.fn().mockResolvedValue([
      {
        milestoneDocumentId: syntheticDocumentId,
        submittedAt: new Date('2026-09-16T14:22:00.000Z'),
        revision: 1,
        status: SubmissionStatus.SUBMITTED,
        _count: { histories: 1 },
        files: [],
        reviewHistories: [],
      },
    ]);
    const prisma = {
      milestoneDocumentSubmission: { findMany },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.findSubmittedSummaries(
      syntheticApplicationId,
      [syntheticDocumentId],
    );

    // Then
    expect(result[0]?.review).toBeNull();
    expect(result[0]?.historyComplete).toBe(true);
  });

  it('이전 revision 원장이 빠진 마이그레이션 제출은 불완전하다고 표시한다', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        milestoneDocumentId: syntheticDocumentId,
        submittedAt: new Date('2026-09-16T14:22:00.000Z'),
        revision: 3,
        status: SubmissionStatus.SUBMITTED,
        _count: { histories: 1 },
        files: [],
        reviewHistories: [],
      },
    ]);
    const repository = new MilestoneDocumentsRepository({
      milestoneDocumentSubmission: { findMany },
    } as unknown as PrismaService);

    await expect(
      repository.findSubmittedSummaries(syntheticApplicationId, [
        syntheticDocumentId,
      ]),
    ).resolves.toEqual([expect.objectContaining({ historyComplete: false })]);
  });

  it('documentIds가 비어 있으면 조회하지 않는다', async () => {
    // Given
    const findMany = jest.fn();
    const prisma = {
      milestoneDocumentSubmission: { findMany },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.findSubmittedSummaries(
      syntheticApplicationId,
      [],
    );

    // Then
    expect(findMany).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});

describe('MilestoneDocumentsRepository.findLatestReview', () => {
  it('(서류, 신청) 제출의 최신 판정을 id·decision·재제출 기한만 뽑아 돌려준다', async () => {
    // Given
    const findFirst = jest.fn().mockResolvedValue({
      id: 'cuid-synthetic-review',
      decision: ReviewDecision.APPROVED,
      resubmissionDueAt: null,
    });
    const prisma = {
      milestoneDocumentReviewHistory: { findFirst },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.findLatestReview(
      syntheticDocumentId,
      syntheticApplicationId,
    );

    // Then: 재제출 가부 판단의 근거이자, 잠금 아래 재확인에 쓸 기대값(id)이다.
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        milestoneDocumentSubmission: {
          milestoneDocumentId: syntheticDocumentId,
          applicationId: syntheticApplicationId,
        },
      },
      orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
      /*
       * 기한도 함께 읽는다. 이 값이 빠지면 제출·업로드 관문이 「보완 요청이면 언제든」으로
       * 되돌아가 새 정책이 조용히 꺼진다 — 두 관문 모두 이 조회 하나를 근거로 삼는다.
       */
      select: { id: true, decision: true, resubmissionDueAt: true },
    });
    expect(result).toEqual({
      id: 'cuid-synthetic-review',
      decision: ReviewDecision.APPROVED,
      resubmissionDueAt: null,
    });
  });

  it('판정이 없으면 null이다', async () => {
    // Given
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = {
      milestoneDocumentReviewHistory: { findFirst },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When / Then
    await expect(
      repository.findLatestReview(syntheticDocumentId, syntheticApplicationId),
    ).resolves.toBeNull();
  });
});

describe('MilestoneDocumentsRepository.findApplicationProgramId', () => {
  it('신청의 programId만 select해 돌려준다', async () => {
    // Given
    const findUnique = jest
      .fn()
      .mockResolvedValue({ programId: 'cuid-program' });
    const prisma = { application: { findUnique } } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.findApplicationProgramId(
      syntheticApplicationId,
    );

    // Then
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: syntheticApplicationId },
      select: { programId: true },
    });
    expect(result).toBe('cuid-program');
  });

  it('신청이 없으면 null이다', async () => {
    // Given
    const findUnique = jest.fn().mockResolvedValue(null);
    const prisma = { application: { findUnique } } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.findApplicationProgramId('cuid-none');

    // Then
    expect(result).toBeNull();
  });
});

describe('MilestoneDocumentsRepository.findSubmissionFileForStaffDownload', () => {
  const now = new Date('2026-09-20T00:00:00.000Z');

  it('ATTACHED이고 만료되지 않은 첨부 1개를 팀 이름과 함께 돌려준다', async () => {
    // Given
    const findUnique = jest.fn().mockResolvedValue({
      application: { team: { name: '가나다팀' } },
      revision: 2,
      files: [
        {
          storageKey: 'objects/synthetic',
          originalFileName: '최종_진짜최종.hwp',
          mimeType: 'application/x-hwp',
          sizeBytes: 2048,
          submissionHistory: { revision: 2 },
        },
      ],
    });
    const prisma = {
      milestoneDocumentSubmission: { findUnique },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.findSubmissionFileForStaffDownload(
      syntheticDocumentId,
      syntheticApplicationId,
      now,
    );

    // Then: 만료 필터가 빠지면 이미 만료된 파일까지 내려받힌다.
    const call = firstCallArgument<{
      where: unknown;
      select: { files: { where: unknown; orderBy: unknown; take: number } };
    }>(findUnique);
    expect(call.where).toEqual({
      milestoneDocumentId_applicationId: {
        milestoneDocumentId: syntheticDocumentId,
        applicationId: syntheticApplicationId,
      },
    });
    expect(call.select.files.where).toEqual({
      lifecycle: SubmissionFileLifecycle.ATTACHED,
      expiresAt: { gt: now },
    });
    expect(call.select.files.take).toBe(1);
    expect(call.select.files.orderBy).toEqual([
      {
        submissionHistory: {
          revision: { sort: 'desc', nulls: 'last' },
        },
      },
      { createdAt: 'desc' },
    ]);
    expect(result).toEqual({
      storageKey: 'objects/synthetic',
      originalFileName: '최종_진짜최종.hwp',
      mimeType: 'application/x-hwp',
      sizeBytes: 2048,
      teamName: '가나다팀',
    });
  });

  it('현재 revision과 다른 이력의 파일은 교직원 다운로드에 쓰지 않는다', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      application: { team: { name: '가나다팀' } },
      revision: 2,
      files: [
        {
          storageKey: 'objects/revision-1',
          originalFileName: 'revision-1.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          submissionHistory: { revision: 1 },
        },
      ],
    });
    const repository = new MilestoneDocumentsRepository({
      milestoneDocumentSubmission: { findUnique },
    } as unknown as PrismaService);

    await expect(
      repository.findSubmissionFileForStaffDownload(
        syntheticDocumentId,
        syntheticApplicationId,
        now,
      ),
    ).resolves.toBeNull();
  });

  it('제출은 있으나 살아 있는 첨부가 없으면 null이다', async () => {
    // Given: 만료됐거나 DELETE_PENDING으로 내려간 첨부뿐이다.
    const findUnique = jest.fn().mockResolvedValue({
      application: { team: { name: '가나다팀' } },
      files: [],
    });
    const prisma = {
      milestoneDocumentSubmission: { findUnique },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.findSubmissionFileForStaffDownload(
      syntheticDocumentId,
      syntheticApplicationId,
      now,
    );

    // Then
    expect(result).toBeNull();
  });

  it('제출 자체가 없으면 null이다', async () => {
    // Given
    const findUnique = jest.fn().mockResolvedValue(null);
    const prisma = {
      milestoneDocumentSubmission: { findUnique },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.findSubmissionFileForStaffDownload(
      syntheticDocumentId,
      syntheticApplicationId,
      now,
    );

    // Then
    expect(result).toBeNull();
  });
});

describe('MilestoneDocumentsRepository store.applyDocumentOrder', () => {
  const firstId = 'cuid-synthetic-document-1';
  const secondId = 'cuid-synthetic-document-2';
  const thirdId = 'cuid-synthetic-document-3';

  interface UpdateArgs {
    where: { id: string; milestoneId: string };
    data: { sortOrder: number };
    select?: { id: true };
  }

  /**
   * 트랜잭션을 흉내 내는 가짜 Prisma. 트랜잭션 클라이언트로 온 쓰기는 staged에 모았다가
   * 콜백이 끝날 때만 committed에 반영하고, 트랜잭션 밖(this.prisma) 쓰기는 곧바로 committed에
   * 반영한다 — 「한 트랜잭션인가」와 「중간 실패 시 부분 반영이 남는가」를 구분하기 위해서다.
   */
  function buildReorderPrisma(options: { failOnUpdateCall?: number } = {}) {
    const rows = [
      {
        id: firstId,
        milestoneId: syntheticMilestoneId,
        name: '개인정보 수집·이용 동의서',
        required: true,
        templateFile: null,
      },
      {
        id: secondId,
        milestoneId: syntheticMilestoneId,
        name: '팀 활동 보고',
        required: false,
        templateFile: null,
      },
      {
        id: thirdId,
        milestoneId: syntheticMilestoneId,
        name: '결과 보고서',
        required: true,
        templateFile: null,
      },
    ];
    const committed = new Map<string, number>([
      [firstId, 1],
      [secondId, 2],
      [thirdId, 3],
    ]);
    let updateCalls = 0;
    const transactionUpdateArgs: UpdateArgs[] = [];

    function applyUpdate(store: Map<string, number>, args: UpdateArgs) {
      updateCalls += 1;
      if (options.failOnUpdateCall === updateCalls) {
        throw new Error('synthetic-update-failure');
      }
      store.set(args.where.id, args.data.sortOrder);
      return { id: args.where.id };
    }

    function readAll(store: Map<string, number>) {
      return rows
        .map((row) => ({ ...row, sortOrder: store.get(row.id) ?? 0 }))
        .sort((left, right) => left.sortOrder - right.sortOrder);
    }

    // 트랜잭션 밖 경로 — 여기로 쓰이면 곧바로 커밋된다(= 롤백이 없다).
    const directUpdate = jest.fn((args: UpdateArgs) =>
      Promise.resolve(applyUpdate(committed, args)),
    );
    const directFindMany = jest.fn(() => Promise.resolve(readAll(committed)));
    // 잠금과 갱신이 **어느 순서로** 일어났는지 보려고 한 배열에 함께 기록한다.
    const operations: string[] = [];
    const lockQueries: { strings: string[]; values: unknown[] }[] = [];
    const $transaction = jest.fn(
      async (
        callback: (client: unknown) => Promise<unknown>,
      ): Promise<unknown> => {
        const staged = new Map(committed);
        const result = await callback({
          $queryRaw: (query: { strings: string[]; values: unknown[] }) => {
            operations.push('lock');
            lockQueries.push(query);
            // 잠금 조회는 id 오름차순으로 행을 돌려준다.
            return Promise.resolve(
              [...rows]
                .map((row) => ({ id: row.id }))
                .sort((left, right) => left.id.localeCompare(right.id)),
            );
          },
          milestoneDocument: {
            update: (args: UpdateArgs) => {
              operations.push(`update:${args.where.id}`);
              transactionUpdateArgs.push(args);
              return Promise.resolve(applyUpdate(staged, args));
            },
            findMany: () => Promise.resolve(readAll(staged)),
          },
        });
        for (const [id, sortOrder] of staged) committed.set(id, sortOrder);
        return result;
      },
    );

    const prisma = {
      milestoneDocument: { update: directUpdate, findMany: directFindMany },
      $transaction,
    } as unknown as PrismaService;
    return {
      prisma,
      committed,
      directUpdate,
      transactionUpdateArgs,
      operations,
      lockQueries,
      $transaction,
    };
  }

  it('요청 순서대로 sortOrder를 1부터 다시 매기고 같은 트랜잭션 안에서 새 목록을 읽는다', async () => {
    // Given: 3개를 역순으로 보낸다.
    const { prisma, committed, directUpdate, $transaction } =
      buildReorderPrisma();
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.withTransaction((store) =>
      store.applyDocumentOrder(syntheticMilestoneId, [
        thirdId,
        secondId,
        firstId,
      ]),
    );

    // Then: 구멍·중복 없이 1..N으로 정규화된다.
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(directUpdate).not.toHaveBeenCalled();
    expect(result.map((document) => document.id)).toEqual([
      thirdId,
      secondId,
      firstId,
    ]);
    expect(result.map((document) => document.sortOrder)).toEqual([1, 2, 3]);
    expect([...committed.entries()].sort()).toEqual([
      [firstId, 3],
      [secondId, 2],
      [thirdId, 1],
    ]);
  });

  it('중간 갱신이 실패하면 아무 항목의 순서도 바뀌지 않는다 — 부분 반영을 남기지 않는다', async () => {
    // Given: 두 번째 갱신에서 실패한다. 항목을 하나씩 따로 갱신하면 첫 항목만 바뀐 채로 남고,
    // 그러면 sortOrder가 같은 두 항목이 생겨 다음 「위로」가 조용히 아무 일도 안 하게 된다.
    const { prisma, committed } = buildReorderPrisma({ failOnUpdateCall: 2 });
    const repository = new MilestoneDocumentsRepository(prisma);

    // When / Then
    await expect(
      repository.withTransaction((store) =>
        store.applyDocumentOrder(syntheticMilestoneId, [
          thirdId,
          secondId,
          firstId,
        ]),
      ),
    ).rejects.toThrow('synthetic-update-failure');
    expect([...committed.entries()].sort()).toEqual([
      [firstId, 1],
      [secondId, 2],
      [thirdId, 3],
    ]);
  });

  it('갱신 where에 milestoneId를 함께 걸어 다른 마일스톤 항목이 섞이는 경로를 막는다', async () => {
    // Given
    const { prisma, transactionUpdateArgs } = buildReorderPrisma();
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    await repository.withTransaction((store) =>
      store.applyDocumentOrder(syntheticMilestoneId, [
        firstId,
        secondId,
        thirdId,
      ]),
    );

    // Then
    expect(transactionUpdateArgs).toEqual([
      {
        where: {
          id: firstId,
          milestoneId: syntheticMilestoneId,
          kind: MilestoneDocumentKind.DOCUMENT,
        },
        data: { sortOrder: 1 },
        select: { id: true },
      },
      {
        where: {
          id: secondId,
          milestoneId: syntheticMilestoneId,
          kind: MilestoneDocumentKind.DOCUMENT,
        },
        data: { sortOrder: 2 },
        select: { id: true },
      },
      {
        where: {
          id: thirdId,
          milestoneId: syntheticMilestoneId,
          kind: MilestoneDocumentKind.DOCUMENT,
        },
        data: { sortOrder: 3 },
        select: { id: true },
      },
    ]);
  });

  it('잠금과 갱신이 한 트랜잭션 안에서 이 순서로 나간다 — 잠근 뒤에만 갱신한다', async () => {
    // Given: 같은 목록을 서로 반대 방향으로 재정렬하는 두 교직원이 A→B와 B→A로 엇갈려
    // 잠그면 PostgreSQL이 한쪽을 교착으로 중단시킨다. 요청은 역순으로 보낸다.
    // (서비스가 실제로 이 순서로 부른다는 것은 service.spec의 호출 순서 테스트가 지킨다.)
    const { prisma, operations, lockQueries } = buildReorderPrisma();
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    await repository.withTransaction(async (store) => {
      await store.lockDocumentIdsOfMilestone(syntheticMilestoneId);
      return store.applyDocumentOrder(syntheticMilestoneId, [
        thirdId,
        secondId,
        firstId,
      ]);
    });

    // Then: 갱신은 전부 잠금 뒤에 온다 — 요청 순서로 잠기는 행이 하나도 없어야 한다.
    expect(operations).toEqual([
      'lock',
      `update:${thirdId}`,
      `update:${secondId}`,
      `update:${firstId}`,
    ]);
    // Then: 잠금은 요청 순서가 아니라 id 오름차순으로, 이 마일스톤의 일반 서류 행 전체를 한 번에 잡는다.
    expect(lockQueries).toHaveLength(1);
    const lockSql = String(lockQueries[0]?.strings);
    expect(lockSql).toContain('FROM "MilestoneDocument"');
    expect(lockSql).toContain('ORDER BY "id"');
    expect(lockSql).toContain('FOR UPDATE');
    expect(lockQueries[0]?.values).toEqual([
      syntheticMilestoneId,
      MilestoneDocumentKind.DOCUMENT,
    ]);
  });
});
