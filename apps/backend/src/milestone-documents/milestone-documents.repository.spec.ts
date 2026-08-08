import {
  AccountStatus,
  ApplicationStatus,
  MilestoneSubmissionType,
  Prisma,
  Role,
  SubmissionFileLifecycle,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  MilestoneDocumentFileRetentionUnavailableError,
  MilestoneDocumentPendingFileMissingError,
  MilestoneDocumentsRepository,
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

describe('MilestoneDocumentsRepository 교직원 CRUD', () => {
  it('createDocument는 templateFileId를 null로 채워 돌려준다(새 항목엔 양식이 없다)', async () => {
    // Given
    const create = jest.fn().mockResolvedValue({
      id: syntheticDocumentId,
      milestoneId: syntheticMilestoneId,
      name: '새 서류',
      required: true,
      sortOrder: 3,
      submissionType: MilestoneSubmissionType.TEXT,
    });
    const prisma = {
      milestoneDocument: { create },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result = await repository.createDocument(syntheticMilestoneId, {
      name: '새 서류',
      required: true,
      sortOrder: 3,
      submissionType: MilestoneSubmissionType.TEXT,
    });

    // Then
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
    expect(result.templateFileId).toBeNull();
  });

  it('deleteDocument는 양식 파일을 먼저 지우고 트랜잭션으로 서류 항목을 삭제한다', async () => {
    // Given
    const deleteMany = jest.fn();
    const documentDelete = jest.fn();
    const transaction = jest.fn((operations: unknown[]) =>
      Promise.all(operations),
    );
    const prisma = {
      milestoneDocumentTemplateFile: { deleteMany },
      milestoneDocument: { delete: documentDelete },
      $transaction: transaction,
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    await repository.deleteDocument(syntheticDocumentId);

    // Then
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { milestoneDocumentId: syntheticDocumentId },
    });
    expect(documentDelete).toHaveBeenCalledWith({
      where: { id: syntheticDocumentId },
    });
  });

  it('countSubmissionsForDocument는 해당 서류의 제출 수를 센다', async () => {
    // Given
    const count = jest.fn().mockResolvedValue(2);
    const prisma = {
      milestoneDocumentSubmission: { count },
    } as unknown as PrismaService;
    const repository = new MilestoneDocumentsRepository(prisma);

    // When
    const result =
      await repository.countSubmissionsForDocument(syntheticDocumentId);

    // Then
    expect(count).toHaveBeenCalledWith({
      where: { milestoneDocumentId: syntheticDocumentId },
    });
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
  function transactionPrisma(overrides: Record<string, unknown>) {
    const submissionUpsert = jest.fn().mockResolvedValue({
      id: 'cuid-synthetic-submission',
      status: SubmissionStatus.SUBMITTED,
      content: Prisma.JsonNull,
      submittedAt: new Date('2026-09-16T14:22:00.000Z'),
    });
    const fileUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    const fileFindMany = jest.fn().mockResolvedValue([]);
    const tx = {
      milestoneDocumentSubmission: { upsert: submissionUpsert },
      submissionFile: { updateMany: fileUpdateMany, findMany: fileFindMany },
      ...overrides,
    };
    const prisma = {
      $transaction: jest.fn((callback: (transaction: unknown) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    return { prisma, submissionUpsert, fileUpdateMany, fileFindMany };
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
    });

    // Then
    expect(fileUpdateMany).not.toHaveBeenCalled();
  });

  it('attachFile이 있으면 이전 ATTACHED 파일을 DELETE_PENDING으로 넘기고 pending 파일을 붙인다', async () => {
    // Given
    const fileUpdateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 }) // 이전 ATTACHED → DELETE_PENDING
      .mockResolvedValueOnce({ count: 1 }); // pending → ATTACHED
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
      }),
    ).rejects.toBeInstanceOf(MilestoneDocumentPendingFileMissingError);
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
