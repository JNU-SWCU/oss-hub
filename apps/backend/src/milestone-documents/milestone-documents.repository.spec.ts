import {
  AccountStatus,
  ApplicationStatus,
  MilestoneSubmissionType,
  Prisma,
  ReviewDecision,
  Role,
  SubmissionFileLifecycle,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  MilestoneDocumentFileRetentionUnavailableError,
  MilestoneDocumentPendingFileMissingError,
  MilestoneDocumentReviewChangedError,
  MilestoneDocumentsRepository,
  MilestoneDocumentSubmissionTypeChangedError,
} from './milestone-documents.repository';

// 합성 데이터만 사용한다 (docs/rules/security.md)
const syntheticMilestoneId = 'cuid-synthetic-milestone';
const syntheticDocumentId = 'cuid-synthetic-document';
const syntheticApplicationId = 'cuid-synthetic-application';
const syntheticUserId = 'cuid-synthetic-user';

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
        submissionType: MilestoneSubmissionType.FILE,
        templateFile: { id: 'cuid-synthetic-template' },
      },
      {
        id: 'cuid-synthetic-document-2',
        milestoneId: syntheticMilestoneId,
        name: '팀 구성 확인서',
        required: false,
        sortOrder: 2,
        submissionType: MilestoneSubmissionType.FILE,
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
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { milestoneId: syntheticMilestoneId },
        orderBy: { sortOrder: 'asc' },
      }),
    );
    expect(result[0]?.templateFileId).toBe('cuid-synthetic-template');
    expect(result[1]?.templateFileId).toBeNull();
  });
});

describe('MilestoneDocumentsRepository.findActiveUser', () => {
  it('githubId + ACTIVE 조건으로 id/role만 select한다', async () => {
    // Given
    const findFirst = jest
      .fn()
      .mockResolvedValue({ id: syntheticUserId, role: Role.STUDENT });
    const prisma = { user: { findFirst } } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    await repository.findActiveUser(9001n);

    // Then
    expect(findFirst).toHaveBeenCalledWith({
      where: { githubId: 9001n, accountStatus: AccountStatus.ACTIVE },
      select: { id: true, role: true },
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
    const result = await repository.countSubmissionsByDocument([]);

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
    const result = await repository.countSubmissionsByDocument([
      syntheticDocumentId,
    ]);

    // Then
    expect(result.get(syntheticDocumentId)).toBe(6);
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
      submissionType: MilestoneSubmissionType.TEXT,
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
        submissionType: MilestoneSubmissionType.TEXT,
      }),
    );

    // Then
    expect(aggregate).toHaveBeenCalledWith({
      where: { milestoneId: syntheticMilestoneId },
      _max: { sortOrder: true },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          milestoneId: syntheticMilestoneId,
          name: '새 서류',
          required: true,
          sortOrder: 3,
          submissionType: MilestoneSubmissionType.TEXT,
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
        submissionType: MilestoneSubmissionType.FILE,
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
          submissionType: MilestoneSubmissionType.FILE,
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
      where: { id: syntheticDocumentId },
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

describe('MilestoneDocumentsRepository.createPendingFile', () => {
  it('프로그램 종료일이 없으면 MilestoneDocumentFileRetentionUnavailableError를 던진다', async () => {
    // Given: FOR UPDATE 조회 결과에 endAt이 없다(연결된 Program이 없거나 미설정).
    const queryRaw = jest.fn().mockResolvedValue([{ endAt: null }]);
    const create = jest.fn();
    const prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback({ $queryRaw: queryRaw, submissionFile: { create } }),
      ),
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When / Then
    await expect(
      repository.createPendingFile({
        uploaderId: syntheticUserId,
        applicationId: syntheticApplicationId,
        milestoneId: syntheticMilestoneId,
        storageKey: 'objects/synthetic',
        originalFileName: '계획서.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        pendingExpiresAt: new Date('2026-09-17T14:22:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(MilestoneDocumentFileRetentionUnavailableError);
    expect(create).not.toHaveBeenCalled();
  });

  it('프로그램 종료일이 있으면 만료일을 종료일+1년으로 계산해 PENDING 파일을 만든다', async () => {
    // Given
    const programEndAt = new Date('2026-12-19T00:00:00.000Z');
    const queryRaw = jest.fn().mockResolvedValue([{ endAt: programEndAt }]);
    const create = jest.fn().mockResolvedValue({
      id: 'cuid-synthetic-file',
      originalFileName: '계획서.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      expiresAt: new Date('2027-12-19T00:00:00.000Z'),
    });
    const prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback({ $queryRaw: queryRaw, submissionFile: { create } }),
      ),
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    await repository.createPendingFile({
      uploaderId: syntheticUserId,
      applicationId: syntheticApplicationId,
      milestoneId: syntheticMilestoneId,
      storageKey: 'objects/synthetic',
      originalFileName: '계획서.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      pendingExpiresAt: new Date('2026-09-17T14:22:00.000Z'),
    });

    // Then
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          uploaderId: syntheticUserId,
          applicationId: syntheticApplicationId,
          milestoneId: syntheticMilestoneId,
          storageKey: 'objects/synthetic',
          originalFileName: '계획서.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          lifecycle: SubmissionFileLifecycle.PENDING,
          pendingExpiresAt: new Date('2026-09-17T14:22:00.000Z'),
          expiresAt: new Date('2027-12-19T00:00:00.000Z'),
        },
      }),
    );
  });
});

describe('MilestoneDocumentsRepository.upsertSubmission', () => {
  function transactionPrisma(
    overrides: Record<string, unknown>,
    lockedSubmissionType: MilestoneSubmissionType | null = MilestoneSubmissionType.TEXT,
    /** 잠금 뒤 다시 읽은 최신 판정. 기본은 「아직 판정 없음」이다. */
    lockedLatestReview: { readonly id: string } | null = null,
  ) {
    const submissionUpsert = jest.fn().mockResolvedValue({
      id: 'cuid-synthetic-submission',
      status: SubmissionStatus.SUBMITTED,
      content: Prisma.JsonNull,
      submittedAt: new Date('2026-09-16T14:22:00.000Z'),
    });
    const fileUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    const fileFindMany = jest.fn().mockResolvedValue([]);
    const reviewFindFirst = jest.fn().mockResolvedValue(lockedLatestReview);
    // 잠금 조회 결과 — null이면 그 사이 서류 항목이 사라진 경우다.
    const queryRaw = jest
      .fn()
      .mockResolvedValue(
        lockedSubmissionType === null
          ? []
          : [{ submissionType: lockedSubmissionType }],
      );
    const tx = {
      $queryRaw: queryRaw,
      milestoneDocumentSubmission: { upsert: submissionUpsert },
      milestoneDocumentReview: { findFirst: reviewFindFirst },
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
    };
  }

  it('attachFile이 없으면(TEXT/REPOSITORY_RELEASE) 파일 붙이기를 건너뛴다', async () => {
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
      expectedSubmissionType: MilestoneSubmissionType.TEXT,
      expectedLatestReviewId: null,
    });

    // Then
    expect(fileUpdateMany).not.toHaveBeenCalled();
  });

  it('서류 행을 FOR SHARE로 잠근 다음에야 제출을 쓴다 — 잠금이 upsert보다 먼저다', async () => {
    // Given: 잠금 없이 쓰면 교직원의 제출 방식 변경과 이 제출이 서로를 못 보고 지나간다.
    const order: string[] = [];
    const queryRaw = jest.fn(() => {
      order.push('lock');
      return Promise.resolve([
        { submissionType: MilestoneSubmissionType.TEXT },
      ]);
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
      expectedSubmissionType: MilestoneSubmissionType.TEXT,
      expectedLatestReviewId: null,
    });

    // Then
    expect(order).toEqual(['lock', 'upsert']);
    expect(
      String(firstCallArgument<{ strings: string[] }>(queryRaw).strings),
    ).toContain('FOR SHARE');
  });

  it('잠근 뒤 다시 읽은 제출 방식이 기대와 다르면 제출을 쓰지 않고 오류를 던진다', async () => {
    // Given: 서비스가 TEXT로 검증했는데 그 사이 교직원이 FILE로 바꿔 놨다.
    const { prisma, submissionUpsert } = transactionPrisma(
      {},
      MilestoneSubmissionType.FILE,
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
        expectedSubmissionType: MilestoneSubmissionType.TEXT,
        expectedLatestReviewId: null,
      }),
    ).rejects.toBeInstanceOf(MilestoneDocumentSubmissionTypeChangedError);
    expect(submissionUpsert).not.toHaveBeenCalled();
  });

  it('잠금 조회에 행이 없으면(그 사이 삭제) 같은 오류로 막는다', async () => {
    // Given
    const { prisma, submissionUpsert } = transactionPrisma({}, null);
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
        expectedSubmissionType: MilestoneSubmissionType.TEXT,
        expectedLatestReviewId: null,
      }),
    ).rejects.toBeInstanceOf(MilestoneDocumentSubmissionTypeChangedError);
    expect(submissionUpsert).not.toHaveBeenCalled();
  });

  it('attachFile이 있으면 이전 ATTACHED 파일을 DELETE_PENDING으로 넘기고 pending 파일을 붙인다', async () => {
    // Given
    const fileUpdateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 }) // 이전 ATTACHED → DELETE_PENDING
      .mockResolvedValueOnce({ count: 1 }); // pending → ATTACHED
    const { prisma } = transactionPrisma(
      {
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
      },
      MilestoneSubmissionType.FILE,
    );
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
      expectedSubmissionType: MilestoneSubmissionType.FILE,
      expectedLatestReviewId: null,
    });

    // Then
    expect(fileUpdateMany).toHaveBeenCalledTimes(2);
    expect(fileUpdateMany).toHaveBeenNthCalledWith(1, {
      where: {
        milestoneDocumentSubmissionId: 'cuid-synthetic-submission',
        lifecycle: SubmissionFileLifecycle.ATTACHED,
      },
      data: {
        lifecycle: SubmissionFileLifecycle.DELETE_PENDING,
        nextDeleteAttemptAt: submittedAt,
      },
    });
    expect(result.files).toHaveLength(1);
  });

  it('pending 파일이 만료·소유자 불일치로 1건 붙지 않으면 MilestoneDocumentPendingFileMissingError를 던진다', async () => {
    // Given: pending → ATTACHED 갱신이 0건이다(만료됐거나 이미 다른 신청에 붙음).
    const fileUpdateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });
    const { prisma } = transactionPrisma(
      { submissionFile: { updateMany: fileUpdateMany, findMany: jest.fn() } },
      MilestoneSubmissionType.FILE,
    );
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
        expectedSubmissionType: MilestoneSubmissionType.FILE,
        expectedLatestReviewId: null,
      }),
    ).rejects.toBeInstanceOf(MilestoneDocumentPendingFileMissingError);
  });

  it('잠근 뒤 다시 읽은 최신 판정이 기대와 다르면 제출을 쓰지 않는다', async () => {
    // Given: 서비스가 「판정 없음」을 보고 허용했는데, 그 사이 교직원이 판정을 등록했다.
    const { prisma, submissionUpsert } = transactionPrisma(
      {},
      MilestoneSubmissionType.TEXT,
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
        expectedSubmissionType: MilestoneSubmissionType.TEXT,
        expectedLatestReviewId: null,
      }),
    ).rejects.toBeInstanceOf(MilestoneDocumentReviewChangedError);
    expect(submissionUpsert).not.toHaveBeenCalled();
  });

  it('판정이 그대로면(기대값과 같은 id) 제출을 쓴다', async () => {
    // Given: 보완 요청을 받고 다시 내는 정상 경로다.
    const { prisma, submissionUpsert } = transactionPrisma(
      {},
      MilestoneSubmissionType.TEXT,
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
      expectedSubmissionType: MilestoneSubmissionType.TEXT,
      expectedLatestReviewId: 'cuid-synthetic-review',
    });

    // Then
    expect(submissionUpsert).toHaveBeenCalled();
  });

  it('판정 재확인은 서류 행을 FOR SHARE로 잠근 뒤에 한다 — 잠금 전에 읽으면 재확인이 아니다', async () => {
    // Given
    const order: string[] = [];
    const queryRaw = jest.fn(() => {
      order.push('lock');
      return Promise.resolve([
        { submissionType: MilestoneSubmissionType.TEXT },
      ]);
    });
    const reviewFindFirst = jest.fn(() => {
      order.push('readLatestReview');
      return Promise.resolve(null);
    });
    const { prisma } = transactionPrisma({
      $queryRaw: queryRaw,
      milestoneDocumentReview: { findFirst: reviewFindFirst },
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
      expectedSubmissionType: MilestoneSubmissionType.TEXT,
      expectedLatestReviewId: null,
    });

    // Then
    expect(order).toEqual(['lock', 'readLatestReview']);
  });
});

describe('MilestoneDocumentsRepository 판정 쓰기 (store)', () => {
  /** 판정 경로도 트랜잭션 밖 클라이언트를 따로 세어, 잠금 없는 단발 경로로 새면 잡는다. */
  function buildReviewStorePrisma() {
    const submissionFindUnique = jest
      .fn()
      .mockResolvedValue({ id: 'cuid-synthetic-submission' });
    const submissionUpdate = jest.fn().mockResolvedValue({
      id: 'cuid-synthetic-submission',
    });
    const reviewCreate = jest.fn().mockResolvedValue({
      id: 'cuid-synthetic-review',
      decision: ReviewDecision.CHANGES_REQUESTED,
      comment: '2쪽 서명이 빠졌습니다.',
      reviewedAt: new Date('2026-09-18T09:00:00.000Z'),
      reviewer: { nickname: 'synthetic-staff' },
    });
    const direct = { create: jest.fn(), update: jest.fn() };
    const prisma = {
      milestoneDocumentReview: { create: direct.create },
      milestoneDocumentSubmission: { update: direct.update },
      $transaction: jest.fn((callback: (transaction: unknown) => unknown) =>
        callback({
          milestoneDocumentSubmission: {
            findUnique: submissionFindUnique,
            update: submissionUpdate,
          },
          milestoneDocumentReview: { create: reviewCreate },
        }),
      ),
    } as unknown as PrismaService;
    return {
      prisma,
      submissionFindUnique,
      submissionUpdate,
      reviewCreate,
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
      select: { id: true },
    });
    expect(result).toEqual({ id: 'cuid-synthetic-submission' });
  });

  it('createReview는 create로 판정을 쌓는다 — upsert/update로 덮어쓰지 않는다', async () => {
    // Given: 덮어쓰면 지난 지적이 사라진다. 교직원이 바뀌어도 남아야 한다는 것이 요구다.
    const { prisma, reviewCreate, direct } = buildReviewStorePrisma();
    const repository = new MilestoneDocumentsRepository(prisma);
    const reviewedAt = new Date('2026-09-18T09:00:00.000Z');

    // When
    const result = await repository.withTransaction((store) =>
      store.createReview({
        milestoneDocumentSubmissionId: 'cuid-synthetic-submission',
        reviewerId: 'cuid-synthetic-staff',
        decision: ReviewDecision.CHANGES_REQUESTED,
        comment: '2쪽 서명이 빠졌습니다.',
        reviewedAt,
      }),
    );

    // Then
    expect(reviewCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          milestoneDocumentSubmissionId: 'cuid-synthetic-submission',
          reviewerId: 'cuid-synthetic-staff',
          decision: ReviewDecision.CHANGES_REQUESTED,
          comment: '2쪽 서명이 빠졌습니다.',
          reviewedAt,
        },
      }),
    );
    expect(direct.create).not.toHaveBeenCalled();
    // 응답이 쓸 표시 이름은 관계에서 평탄화해 내보낸다(내부 reviewerId는 내보내지 않는다).
    expect(result).toEqual({
      id: 'cuid-synthetic-review',
      decision: ReviewDecision.CHANGES_REQUESTED,
      comment: '2쪽 서명이 빠졌습니다.',
      reviewedAt,
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
        submissionType: MilestoneSubmissionType.FILE,
      },
    ]);
    const transactionCount = jest.fn().mockResolvedValue(0);
    const transactionUpdate = jest.fn().mockResolvedValue({
      id: syntheticDocumentId,
      milestoneId: syntheticMilestoneId,
      name: '개인정보 수집·이용 동의서',
      required: true,
      sortOrder: 1,
      submissionType: MilestoneSubmissionType.TEXT,
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
        submissionType: MilestoneSubmissionType.TEXT,
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
    expect(locked?.submissionType).toBe(MilestoneSubmissionType.FILE);
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
        submissionType: MilestoneSubmissionType.TEXT,
      }),
    );

    // Then
    const args = firstCallArgument<{ data: Record<string, unknown> }>(
      transactionUpdate,
    );
    expect(args.data).toEqual({
      name: '개인정보 수집·이용 동의서',
      required: true,
      submissionType: MilestoneSubmissionType.TEXT,
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
    expect(String(sql.strings)).toContain('FOR UPDATE');
    expect(sql.values).toEqual([syntheticMilestoneId]);
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
        applicant: { name: '합성 신청자', profile: null },
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
        files: [{ originalFileName: '최종_진짜최종.hwp', sizeBytes: 2048 }],
        reviews: [],
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
      select: { files: { where: unknown; take: number } };
    }>(findMany);
    expect(call.select.files.where).toEqual({
      lifecycle: SubmissionFileLifecycle.ATTACHED,
      expiresAt: { gt: now },
    });
    expect(call.select.files.take).toBe(1);
    expect(result[0]?.file).toEqual({
      originalFileName: '최종_진짜최종.hwp',
      sizeBytes: 2048,
    });
  });

  it('붙은 첨부가 없으면 file은 null이다', async () => {
    // Given
    const findMany = jest.fn().mockResolvedValue([
      {
        milestoneDocumentId: syntheticDocumentId,
        applicationId: syntheticApplicationId,
        submittedAt: new Date('2026-09-16T14:22:00.000Z'),
        files: [],
        reviews: [],
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

  it('판정이 여러 건이어도 최신 한 건만 칸에 붙인다 — reviewedAt 내림차순 + take 1', async () => {
    // Given: 판정은 쌓이므로 정렬 없이 읽으면 어느 판정이 「지금 판정」인지 정해지지 않는다.
    const reviewedAt = new Date('2026-09-18T09:00:00.000Z');
    const findMany = jest.fn().mockResolvedValue([
      {
        milestoneDocumentId: syntheticDocumentId,
        applicationId: syntheticApplicationId,
        submittedAt: new Date('2026-09-16T14:22:00.000Z'),
        files: [],
        reviews: [
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

    // Then: 같은 밀리초에 두 건이 들어와도 순서가 정해지도록 id로 한 번 더 가른다.
    const call = firstCallArgument<{
      select: { reviews: { orderBy: unknown; take: number } };
    }>(findMany);
    expect(call.select.reviews.orderBy).toEqual([
      { reviewedAt: 'desc' },
      { id: 'desc' },
    ]);
    expect(call.select.reviews.take).toBe(1);
    expect(result[0]?.review).toEqual({
      decision: ReviewDecision.CHANGES_REQUESTED,
      comment: '2쪽 서명이 빠졌습니다.',
      reviewedAt,
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
        status: SubmissionStatus.CHANGES_REQUESTED,
        reviews: [
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
    const result = await repository.findSubmittedSummaries(
      syntheticApplicationId,
      [syntheticDocumentId],
    );

    // Then
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(result[0]).toEqual({
      milestoneDocumentId: syntheticDocumentId,
      submittedAt,
      status: SubmissionStatus.CHANGES_REQUESTED,
      review: {
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
        status: SubmissionStatus.SUBMITTED,
        reviews: [],
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
  it('(서류, 신청) 제출의 최신 판정을 id·decision만 뽑아 돌려준다', async () => {
    // Given
    const findFirst = jest.fn().mockResolvedValue({
      id: 'cuid-synthetic-review',
      decision: ReviewDecision.APPROVED,
    });
    const prisma = {
      milestoneDocumentReview: { findFirst },
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
      select: { id: true, decision: true },
    });
    expect(result).toEqual({
      id: 'cuid-synthetic-review',
      decision: ReviewDecision.APPROVED,
    });
  });

  it('판정이 없으면 null이다', async () => {
    // Given
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = {
      milestoneDocumentReview: { findFirst },
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
      files: [
        {
          storageKey: 'objects/synthetic',
          originalFileName: '최종_진짜최종.hwp',
          mimeType: 'application/x-hwp',
          sizeBytes: 2048,
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
      select: { files: { where: unknown; take: number } };
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
    expect(result).toEqual({
      storageKey: 'objects/synthetic',
      originalFileName: '최종_진짜최종.hwp',
      mimeType: 'application/x-hwp',
      sizeBytes: 2048,
      teamName: '가나다팀',
    });
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
        submissionType: MilestoneSubmissionType.FILE,
        templateFile: null,
      },
      {
        id: secondId,
        milestoneId: syntheticMilestoneId,
        name: '팀 활동 보고',
        required: false,
        submissionType: MilestoneSubmissionType.TEXT,
        templateFile: null,
      },
      {
        id: thirdId,
        milestoneId: syntheticMilestoneId,
        name: '결과 보고서',
        required: true,
        submissionType: MilestoneSubmissionType.FILE,
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
        where: { id: firstId, milestoneId: syntheticMilestoneId },
        data: { sortOrder: 1 },
        select: { id: true },
      },
      {
        where: { id: secondId, milestoneId: syntheticMilestoneId },
        data: { sortOrder: 2 },
        select: { id: true },
      },
      {
        where: { id: thirdId, milestoneId: syntheticMilestoneId },
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
    // Then: 잠금은 요청 순서가 아니라 id 오름차순으로, 이 마일스톤의 행 전체를 한 번에 잡는다.
    expect(lockQueries).toHaveLength(1);
    const lockSql = String(lockQueries[0]?.strings);
    expect(lockSql).toContain('FROM "MilestoneDocument"');
    expect(lockSql).toContain('ORDER BY "id"');
    expect(lockSql).toContain('FOR UPDATE');
    expect(lockQueries[0]?.values).toEqual([syntheticMilestoneId]);
  });
});
