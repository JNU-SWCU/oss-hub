import {
  MilestoneSubmissionType,
  Prisma,
  Role,
  SubmissionStatus,
} from '@prisma/client';
import type { MilestoneDocumentCollectionQuery } from './domain/milestone-document-collection-query';
import { MilestoneDocumentsErrorCode } from './milestone-documents-error-code.enum';
import {
  MilestoneDocumentPendingFileMissingError,
  MilestoneDocumentsRepository,
  MilestoneDocumentSubmissionTypeChangedError,
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
    submissionType: MilestoneSubmissionType.FILE,
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
    findDocumentContext: jest.fn().mockResolvedValue({
      id: syntheticDocumentId,
      milestoneId: syntheticMilestoneId,
      programId: syntheticProgramId,
      name: '개인정보 수집·이용 동의서',
      dueAt: new Date('2026-09-19T09:00:00.000Z'),
      required: true,
      submissionType: MilestoneSubmissionType.FILE,
    }),
    createDocument: jest.fn(),
    updateDocument: jest.fn(),
    lockDocument: jest.fn().mockResolvedValue({
      id: syntheticDocumentId,
      milestoneId: syntheticMilestoneId,
      submissionType: MilestoneSubmissionType.FILE,
    }),
    reorderDocuments: jest.fn(),
    deleteDocument: jest.fn(),
    countSubmissionsForDocument: jest.fn().mockResolvedValue(0),
    upsertSubmission: jest.fn(),
    findApprovedApplicationsForCollection: jest.fn().mockResolvedValue([]),
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
        lockDocument: (documentId: string): Promise<unknown> => {
          transactionCalls.push('lockDocument');
          return mocks.lockDocument(documentId) as Promise<unknown>;
        },
        countSubmissionsForDocument: (documentId: string): Promise<number> => {
          transactionCalls.push('countSubmissionsForDocument');
          return mocks.countSubmissionsForDocument(
            documentId,
          ) as Promise<number>;
        },
        updateDocument: (
          documentId: string,
          input: unknown,
        ): Promise<unknown> => {
          transactionCalls.push('updateDocument');
          return mocks.updateDocument(documentId, input) as Promise<unknown>;
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
    const { repository } = buildRepository({
      findActiveUser: jest
        .fn()
        .mockResolvedValue({ id: 'staff-1', role: Role.STAFF }),
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
  });

  it('학생 viewer는 자기 신청의 제출 여부(viewerSubmission)를 채운다', async () => {
    // Given: 학생이 이 프로그램에 신청했고 서류를 이미 냈다.
    const submittedAt = new Date('2026-09-16T14:22:00.000Z');
    const { repository } = buildRepository({
      findActiveUser: jest
        .fn()
        .mockResolvedValue({ id: syntheticUserId, role: Role.STUDENT }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: true,
        programEndAt: null,
        repositoryUrl: null,
      }),
      findSubmittedSummaries: jest
        .fn()
        .mockResolvedValue([
          { milestoneDocumentId: syntheticDocumentId, submittedAt },
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
        },
      }),
    ]);
  });

  it('학생 viewer가 아직 신청하지 않았으면 미제출(submitted:false)로 채운다', async () => {
    // Given: 학생 계정이지만 이 프로그램에 신청한 이력이 없다.
    const { repository } = buildRepository({
      findActiveUser: jest
        .fn()
        .mockResolvedValue({ id: syntheticUserId, role: Role.STUDENT }),
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
  it('createDocument는 마일스톤 존재를 확인하고 리포지토리 결과를 DTO로 감싼다', async () => {
    // Given
    const created = baseDocument({ id: 'cuid-synthetic-document-new' });
    const { mocks, repository } = buildRepository({
      createDocument: jest.fn().mockResolvedValue(created),
    });
    const service = new MilestoneDocumentsService(repository);
    const input = {
      name: '새 서류',
      required: true,
      sortOrder: 2,
      submissionType: MilestoneSubmissionType.TEXT,
    };

    // When
    const result = await service.createDocument(syntheticMilestoneId, input);

    // Then
    expect(mocks.createDocument).toHaveBeenCalledWith(
      syntheticMilestoneId,
      input,
    );
    expect(result.id).toBe('cuid-synthetic-document-new');
  });

  it('createDocument는 마일스톤이 없으면 MILESTONE_NOT_FOUND를 던진다', async () => {
    // Given
    const { repository } = buildRepository({
      findMilestone: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.createDocument(syntheticMilestoneId, {
        name: '새 서류',
        required: true,
        sortOrder: 2,
        submissionType: MilestoneSubmissionType.TEXT,
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
        submissionType: MilestoneSubmissionType.FILE,
      }),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.updateDocument(syntheticMilestoneId, syntheticDocumentId, {
        name: '수정된 이름',
        required: false,
        sortOrder: 1,
        submissionType: MilestoneSubmissionType.FILE,
      }),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
    expect(mocks.updateDocument).not.toHaveBeenCalled();
  });

  it('updateDocument는 서류 행이 사라졌으면 DOCUMENT_NOT_FOUND를 던진다', async () => {
    // Given: 잠금 조회가 아무 행도 못 잡았다.
    const { mocks, repository } = buildRepository({
      lockDocument: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.updateDocument(syntheticMilestoneId, syntheticDocumentId, {
        name: '수정된 이름',
        required: false,
        sortOrder: 1,
        submissionType: MilestoneSubmissionType.FILE,
      }),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
    });
    expect(mocks.updateDocument).not.toHaveBeenCalled();
  });

  it('updateDocument는 제출이 있는 항목의 제출 방식 변경을 DOCUMENT_HAS_SUBMISSIONS로 막는다', async () => {
    // Given: 이미 파일 제출이 2건 있는 FILE 항목을 TEXT로 바꾸려 한다.
    // 바꾸면 수합 표의 칸이 file을 잃어 「안 냈네」로 읽히므로 삭제와 같은 코드로 막는다.
    const { mocks, repository } = buildRepository({
      countSubmissionsForDocument: jest.fn().mockResolvedValue(2),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.updateDocument(syntheticMilestoneId, syntheticDocumentId, {
        name: '개인정보 수집·이용 동의서',
        required: true,
        sortOrder: 1,
        submissionType: MilestoneSubmissionType.TEXT,
      }),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_HAS_SUBMISSIONS },
    });
    expect(mocks.updateDocument).not.toHaveBeenCalled();
  });

  it('updateDocument는 잠금·세기·갱신을 한 트랜잭션 안에서 이 순서로 한다', async () => {
    // Given: 세기와 갱신이 갈라져 있으면 그 사이 제출이 카운트를 피해 들어온다.
    // 판단의 근거가 되는 읽기(잠금)와 그 판단으로 하는 쓰기가 같은 트랜잭션에 있어야 한다.
    const { transactionCalls, withTransaction, repository } = buildRepository({
      countSubmissionsForDocument: jest.fn().mockResolvedValue(0),
      updateDocument: jest
        .fn()
        .mockResolvedValue(
          baseDocument({ submissionType: MilestoneSubmissionType.TEXT }),
        ),
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    await service.updateDocument(syntheticMilestoneId, syntheticDocumentId, {
      name: '개인정보 수집·이용 동의서',
      required: true,
      sortOrder: 1,
      submissionType: MilestoneSubmissionType.TEXT,
    });

    // Then
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(transactionCalls).toEqual([
      'lockDocument',
      'countSubmissionsForDocument',
      'updateDocument',
    ]);
  });

  it('updateDocument는 트랜잭션 밖에서 읽어 둔 값이 아니라 잠근 뒤 다시 읽은 제출 방식으로 판단한다', async () => {
    // Given: 트랜잭션 밖 조회(findDocumentContext)는 아직 TEXT라고 말하지만, 잠금을 기다리는
    // 사이 다른 교직원이 이미 FILE로 바꿔 놨다. 요청도 FILE이므로 방식 변경이 아니다 —
    // 낡은 값으로 판단하면 「변경이다」로 잘못 읽어 제출 수를 세고 막아 버린다.
    const { mocks, repository } = buildRepository({
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: syntheticMilestoneId,
        programId: syntheticProgramId,
        name: '개인정보 수집·이용 동의서',
        dueAt: new Date('2026-09-19T09:00:00.000Z'),
        required: true,
        submissionType: MilestoneSubmissionType.TEXT,
      }),
      lockDocument: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: syntheticMilestoneId,
        submissionType: MilestoneSubmissionType.FILE,
      }),
      countSubmissionsForDocument: jest.fn().mockResolvedValue(3),
      updateDocument: jest.fn().mockResolvedValue(baseDocument()),
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    await service.updateDocument(syntheticMilestoneId, syntheticDocumentId, {
      name: '개인정보 수집·이용 동의서',
      required: true,
      sortOrder: 1,
      submissionType: MilestoneSubmissionType.FILE,
    });

    // Then: 방식이 그대로이므로 세지도 막지도 않는다.
    expect(mocks.countSubmissionsForDocument).not.toHaveBeenCalled();
    expect(mocks.updateDocument).toHaveBeenCalled();
  });

  it('updateDocument는 제출이 있어도 이름·필수여부·순서 변경은 그대로 허용한다', async () => {
    // Given: 제출이 2건 있지만 제출 방식(FILE)은 그대로다.
    const { mocks, repository } = buildRepository({
      countSubmissionsForDocument: jest.fn().mockResolvedValue(2),
      updateDocument: jest
        .fn()
        .mockResolvedValue(
          baseDocument({ name: '수정된 이름', required: false, sortOrder: 3 }),
        ),
    });
    const service = new MilestoneDocumentsService(repository);
    const input = {
      name: '수정된 이름',
      required: false,
      sortOrder: 3,
      submissionType: MilestoneSubmissionType.FILE,
    };

    // When
    const result = await service.updateDocument(
      syntheticMilestoneId,
      syntheticDocumentId,
      input,
    );

    // Then: 제출 방식이 그대로면 제출 수를 셀 필요조차 없다.
    expect(mocks.countSubmissionsForDocument).not.toHaveBeenCalled();
    expect(mocks.updateDocument).toHaveBeenCalledWith(
      syntheticDocumentId,
      input,
    );
    expect(result.name).toBe('수정된 이름');
  });

  it('updateDocument는 제출이 없으면 제출 방식 변경도 허용한다', async () => {
    // Given: 아직 아무도 내지 않은 항목이다.
    const { mocks, repository } = buildRepository({
      countSubmissionsForDocument: jest.fn().mockResolvedValue(0),
      updateDocument: jest.fn().mockResolvedValue(
        baseDocument({
          submissionType: MilestoneSubmissionType.TEXT,
        }),
      ),
    });
    const service = new MilestoneDocumentsService(repository);
    const input = {
      name: '개인정보 수집·이용 동의서',
      required: true,
      sortOrder: 1,
      submissionType: MilestoneSubmissionType.TEXT,
    };

    // When
    const result = await service.updateDocument(
      syntheticMilestoneId,
      syntheticDocumentId,
      input,
    );

    // Then
    expect(mocks.countSubmissionsForDocument).toHaveBeenCalledWith(
      syntheticDocumentId,
    );
    expect(mocks.updateDocument).toHaveBeenCalledWith(
      syntheticDocumentId,
      input,
    );
    expect(result.submissionType).toBe(MilestoneSubmissionType.TEXT);
  });

  it('deleteDocument는 제출이 있으면 DOCUMENT_HAS_SUBMISSIONS로 거부한다', async () => {
    // Given
    const { mocks, repository } = buildRepository({
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

  it('deleteDocument는 제출이 없으면 리포지토리 삭제를 호출한다', async () => {
    // Given
    const { mocks, repository } = buildRepository({
      countSubmissionsForDocument: jest.fn().mockResolvedValue(0),
    });
    const service = new MilestoneDocumentsService(repository);

    // When
    await service.deleteDocument(syntheticMilestoneId, syntheticDocumentId);

    // Then
    expect(mocks.deleteDocument).toHaveBeenCalledWith(syntheticDocumentId);
  });
});

describe('MilestoneDocumentsService.updateDocument — 제출과의 경쟁', () => {
  /**
   * 「제출 방식 변경」과 「학생 제출」의 경쟁을 행 잠금 수준에서 흉내 내는 가짜 저장소.
   *
   * Postgres 규칙 중 이 결함에 필요한 둘만 옮겼다.
   * 1. 교직원이 서류 행을 잠그고 있는 동안 학생 제출은 커밋하지 못하고 기다린다.
   * 2. 기다렸다 깨어난 제출은 제출 방식을 **다시 읽어** 자기 유형과 다르면 쓰지 않는다
   *    (실제로는 `upsertSubmission`의 `FOR SHARE` + 재확인이 하는 일이다).
   *
   * 잠그지 않으면 기다림도 재확인도 없이 곧바로 커밋된다 — 그게 원래 결함이다.
   */
  function buildRaceWorld() {
    const row: {
      id: string;
      milestoneId: string;
      submissionType: MilestoneSubmissionType;
    } = {
      id: syntheticDocumentId,
      milestoneId: syntheticMilestoneId,
      submissionType: MilestoneSubmissionType.FILE,
    };
    let locked = false;
    let waitingFileSubmissions = 0;
    let submissionCount = 0;

    function commitFileSubmission() {
      if (row.submissionType !== MilestoneSubmissionType.FILE) return;
      submissionCount += 1;
    }

    /** 학생이 FILE 제출을 보낸다 — 서비스가 유형을 검증하던 시점에는 FILE이었다. */
    function studentSubmitsFile() {
      if (locked) {
        waitingFileSubmissions += 1;
        return;
      }
      commitFileSubmission();
    }

    function releaseLock() {
      locked = false;
      for (let index = 0; index < waitingFileSubmissions; index += 1) {
        commitFileSubmission();
      }
      waitingFileSubmissions = 0;
    }

    /** 제출은 언제나 「제출 수를 센 직후」에 도착한다 — 가드가 가장 취약한 순간이다. */
    function countThenStudentSubmits() {
      const seen = submissionCount;
      studentSubmitsFile();
      return Promise.resolve(seen);
    }

    const repository = {
      findMilestone: jest.fn().mockResolvedValue({
        id: syntheticMilestoneId,
        programId: syntheticProgramId,
        name: '프로젝트 계획서 제출',
        dueAt: new Date('2026-09-19T09:00:00.000Z'),
      }),
      findDocumentContext: jest
        .fn()
        .mockImplementation(() => Promise.resolve({ ...row })),
      // 트랜잭션 밖 단발 세기 — 잠금이 없으므로 제출을 막지 못한다.
      countSubmissionsForDocument: jest
        .fn()
        .mockImplementation(countThenStudentSubmits),
      updateDocument: jest
        .fn()
        .mockImplementation(
          (_id: string, input: { submissionType: MilestoneSubmissionType }) => {
            row.submissionType = input.submissionType;
            return Promise.resolve({ ...baseDocument(), ...input });
          },
        ),
      withTransaction: jest.fn(
        async (operation: (store: unknown) => Promise<unknown>) => {
          try {
            return await operation({
              lockDocument: () => {
                locked = true;
                return Promise.resolve({ ...row });
              },
              countSubmissionsForDocument: countThenStudentSubmits,
              updateDocument: (
                _id: string,
                input: { submissionType: MilestoneSubmissionType },
              ) => {
                row.submissionType = input.submissionType;
                return Promise.resolve({ ...baseDocument(), ...input });
              },
            });
          } finally {
            releaseLock();
          }
        },
      ),
    };

    return {
      repository: repository as unknown as MilestoneDocumentsRepository,
      state: () => ({
        submissionType: row.submissionType,
        submissionCount,
      }),
    };
  }

  it('제출 수를 센 직후 제출이 도착해도 「TEXT인데 FILE 제출이 들어 있는」 상태를 남기지 않는다', async () => {
    // Given: 아직 아무도 내지 않은 FILE 항목을 TEXT로 바꾸는 중에 FILE 제출 하나가 도착한다.
    const { repository, state } = buildRaceWorld();
    const service = new MilestoneDocumentsService(repository);

    // When
    await service.updateDocument(syntheticMilestoneId, syntheticDocumentId, {
      name: '개인정보 수집·이용 동의서',
      required: true,
      sortOrder: 1,
      submissionType: MilestoneSubmissionType.TEXT,
    });

    // Then: 둘 중 하나만 통과해야 한다. 방식이 TEXT로 바뀌었다면 그 제출은 남아 있으면 안 된다.
    const final = state();
    expect(
      final.submissionType === MilestoneSubmissionType.TEXT &&
        final.submissionCount > 0,
    ).toBe(false);
  });
});

describe('MilestoneDocumentsService.reorderDocuments (교직원)', () => {
  const secondDocumentId = 'cuid-synthetic-document-2';
  const thirdDocumentId = 'cuid-synthetic-document-3';

  function reorderRepository(
    overrides: Partial<Record<string, jest.Mock>> = {},
  ) {
    return buildRepository({
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
    // Given
    const { mocks, repository } = reorderRepository({
      findMilestone: jest.fn().mockResolvedValue(null),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.reorderDocuments(syntheticMilestoneId, [syntheticDocumentId]),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND },
    });
    expect(mocks.reorderDocuments).not.toHaveBeenCalled();
  });

  it('전체 집합이 일치하면 요청 순서 그대로 리포지토리에 넘기고 새 순서를 돌려준다', async () => {
    // Given: 3개를 역순으로 보낸다.
    const requested = [thirdDocumentId, secondDocumentId, syntheticDocumentId];
    const { mocks, repository } = reorderRepository({
      reorderDocuments: jest.fn().mockResolvedValue([
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
    expect(mocks.reorderDocuments).toHaveBeenCalledWith(
      syntheticMilestoneId,
      requested,
    );
    expect(result.map((document) => document.id)).toEqual(requested);
    expect(result.map((document) => document.sortOrder)).toEqual([1, 2, 3]);
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
    expect(mocks.reorderDocuments).not.toHaveBeenCalled();
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
    expect(mocks.reorderDocuments).not.toHaveBeenCalled();
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
    expect(mocks.reorderDocuments).not.toHaveBeenCalled();
  });
});

describe('MilestoneDocumentsService.submit (학생)', () => {
  const now = new Date('2026-09-16T14:22:00.000Z');

  it('학생이 아니면 STUDENT_ONLY로 거부한다', async () => {
    // Given
    const { repository } = buildRepository({
      findActiveUser: jest
        .fn()
        .mockResolvedValue({ id: 'staff-1', role: Role.STAFF }),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.submit(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        { type: MilestoneSubmissionType.TEXT, text: '본문' },
        now,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.STUDENT_ONLY },
    });
  });

  it('서류 제출 유형과 내용 유형이 다르면 CONTENT_TYPE_MISMATCH로 거부한다', async () => {
    // Given: 서류 항목은 FILE 유형인데 TEXT로 제출했다.
    const { repository } = buildRepository({
      findActiveUser: jest
        .fn()
        .mockResolvedValue({ id: syntheticUserId, role: Role.STUDENT }),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.submit(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        { type: MilestoneSubmissionType.TEXT, text: '본문' },
        now,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.CONTENT_TYPE_MISMATCH },
    });
  });

  it('이 프로그램 신청이 없으면 NOT_APPLICATION_MEMBER로 거부한다', async () => {
    // Given
    const { repository } = buildRepository({
      findActiveUser: jest
        .fn()
        .mockResolvedValue({ id: syntheticUserId, role: Role.STUDENT }),
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: syntheticMilestoneId,
        programId: syntheticProgramId,
        dueAt: now,
        required: true,
        submissionType: MilestoneSubmissionType.TEXT,
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
        { type: MilestoneSubmissionType.TEXT, text: '본문' },
        now,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.NOT_APPLICATION_MEMBER },
    });
  });

  it('신청이 아직 승인 전이면 APPLICATION_APPROVAL_REQUIRED로 거부한다', async () => {
    // Given
    const { repository } = buildRepository({
      findActiveUser: jest
        .fn()
        .mockResolvedValue({ id: syntheticUserId, role: Role.STUDENT }),
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: syntheticMilestoneId,
        programId: syntheticProgramId,
        dueAt: now,
        required: true,
        submissionType: MilestoneSubmissionType.TEXT,
      }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: false,
        programEndAt: null,
        repositoryUrl: null,
      }),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.submit(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        { type: MilestoneSubmissionType.TEXT, text: '본문' },
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
      findActiveUser: jest
        .fn()
        .mockResolvedValue({ id: syntheticUserId, role: Role.STUDENT }),
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: syntheticMilestoneId,
        programId: syntheticProgramId,
        dueAt: now,
        required: true,
        submissionType: MilestoneSubmissionType.TEXT,
      }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: true,
        programEndAt: null,
        repositoryUrl: null,
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
      { type: MilestoneSubmissionType.TEXT, text: '본문' },
      now,
    );

    // Then
    expect(mocks.upsertSubmission).toHaveBeenCalledWith({
      milestoneDocumentId: syntheticDocumentId,
      applicationId: syntheticApplicationId,
      submittedById: syntheticUserId,
      submittedAt: now,
      content: { type: MilestoneSubmissionType.TEXT, text: '본문' },
      attachFile: null,
      expectedSubmissionType: MilestoneSubmissionType.TEXT,
    });
    expect(result.id).toBe('cuid-synthetic-submission');
    expect(result.submittedAt).toBe(now.toISOString());
  });

  it('FILE 제출은 attachFile을 채우고 content는 Prisma.JsonNull이다', async () => {
    // Given
    const { mocks, repository } = buildRepository({
      findActiveUser: jest
        .fn()
        .mockResolvedValue({ id: syntheticUserId, role: Role.STUDENT }),
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: syntheticMilestoneId,
        programId: syntheticProgramId,
        dueAt: now,
        required: true,
        submissionType: MilestoneSubmissionType.FILE,
      }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: true,
        programEndAt: null,
        repositoryUrl: null,
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
      { type: MilestoneSubmissionType.FILE, fileId: 'cuid-synthetic-file' },
      now,
    );

    // Then
    expect(mocks.upsertSubmission).toHaveBeenCalledWith({
      milestoneDocumentId: syntheticDocumentId,
      applicationId: syntheticApplicationId,
      submittedById: syntheticUserId,
      submittedAt: now,
      content: Prisma.JsonNull,
      attachFile: {
        fileId: 'cuid-synthetic-file',
        uploaderId: syntheticUserId,
        milestoneId: syntheticMilestoneId,
      },
      expectedSubmissionType: MilestoneSubmissionType.FILE,
    });
    expect(result.files).toEqual([
      expect.objectContaining({ id: 'cuid-synthetic-file' }),
    ]);
  });

  it('REPOSITORY_RELEASE 제출은 연결된 저장소가 없으면 REPOSITORY_NOT_READY로 거부한다', async () => {
    // Given
    const { repository } = buildRepository({
      findActiveUser: jest
        .fn()
        .mockResolvedValue({ id: syntheticUserId, role: Role.STUDENT }),
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: syntheticMilestoneId,
        programId: syntheticProgramId,
        dueAt: now,
        required: true,
        submissionType: MilestoneSubmissionType.REPOSITORY_RELEASE,
      }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: true,
        programEndAt: null,
        repositoryUrl: null,
      }),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.submit(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        {
          type: MilestoneSubmissionType.REPOSITORY_RELEASE,
          releaseUrl: 'https://github.invalid/team/repo/releases/tag/v1',
        },
        now,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.REPOSITORY_NOT_READY },
    });
  });

  it('REPOSITORY_RELEASE 제출은 연결된 저장소와 무관한 URL이면 RELEASE_URL_NOT_LINKED_REPOSITORY로 거부한다', async () => {
    // Given
    const { repository } = buildRepository({
      findActiveUser: jest
        .fn()
        .mockResolvedValue({ id: syntheticUserId, role: Role.STUDENT }),
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: syntheticMilestoneId,
        programId: syntheticProgramId,
        dueAt: now,
        required: true,
        submissionType: MilestoneSubmissionType.REPOSITORY_RELEASE,
      }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: true,
        programEndAt: null,
        repositoryUrl: 'https://github.invalid/team/oss-team-04',
      }),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.submit(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        {
          type: MilestoneSubmissionType.REPOSITORY_RELEASE,
          releaseUrl:
            'https://github.invalid/other-team/other-repo/releases/tag/v1',
        },
        now,
      ),
    ).rejects.toMatchObject({
      errorCode: {
        code: MilestoneDocumentsErrorCode.RELEASE_URL_NOT_LINKED_REPOSITORY,
      },
    });
  });

  it('pending 파일이 만료·소유자 불일치로 붙지 않으면 PENDING_FILE_NOT_FOUND로 변환한다', async () => {
    // Given
    const { repository } = buildRepository({
      findActiveUser: jest
        .fn()
        .mockResolvedValue({ id: syntheticUserId, role: Role.STUDENT }),
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: syntheticMilestoneId,
        programId: syntheticProgramId,
        dueAt: now,
        required: true,
        submissionType: MilestoneSubmissionType.FILE,
      }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: true,
        programEndAt: null,
        repositoryUrl: null,
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
        { type: MilestoneSubmissionType.FILE, fileId: 'cuid-expired-file' },
        now,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.PENDING_FILE_NOT_FOUND },
    });
  });

  it('제출 방식이 검증 뒤 바뀌어 있었으면 CONTENT_TYPE_MISMATCH로 변환한다', async () => {
    // Given: 트랜잭션 밖 검증은 FILE로 통과했지만, 잠금 아래에서 다시 읽으니 이미 TEXT였다.
    // 이 제출이 그대로 커밋되면 「TEXT인데 FILE 제출이 들어 있는」 상태가 남는다.
    const { repository } = buildRepository({
      findActiveUser: jest
        .fn()
        .mockResolvedValue({ id: syntheticUserId, role: Role.STUDENT }),
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: syntheticMilestoneId,
        programId: syntheticProgramId,
        dueAt: now,
        required: true,
        submissionType: MilestoneSubmissionType.FILE,
      }),
      findStudentApplication: jest.fn().mockResolvedValue({
        applicationId: syntheticApplicationId,
        approved: true,
        programEndAt: null,
        repositoryUrl: null,
      }),
      upsertSubmission: jest
        .fn()
        .mockRejectedValue(new MilestoneDocumentSubmissionTypeChangedError()),
    });
    const service = new MilestoneDocumentsService(repository);

    // When / Then
    await expect(
      service.submit(
        1n,
        syntheticMilestoneId,
        syntheticDocumentId,
        { type: MilestoneSubmissionType.FILE, fileId: 'cuid-synthetic-file' },
        now,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.CONTENT_TYPE_MISMATCH },
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
          submissionType: MilestoneSubmissionType.TEXT,
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
      name: '프로젝트 계획서 제출',
      dueAt: '2026-09-19T09:00:00.000Z',
    });
    expect(result.documents).toEqual([
      {
        id: syntheticDocumentId,
        name: '개인정보 수집·이용 동의서',
        required: true,
        sortOrder: 1,
        submissionType: MilestoneSubmissionType.FILE,
      },
      {
        id: secondDocumentId,
        name: '팀 활동 보고',
        required: false,
        sortOrder: 2,
        submissionType: MilestoneSubmissionType.TEXT,
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

  it('제출이 없는 서류도 칸을 비우지 않고 submitted:false로 채운다', async () => {
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
    for (const row of result.rows) {
      expect(row.cells).toEqual([
        {
          documentId: syntheticDocumentId,
          submitted: false,
          submittedAt: null,
          file: null,
        },
        {
          documentId: secondDocumentId,
          submitted: false,
          submittedAt: null,
          file: null,
        },
      ]);
    }
  });

  it('제출한 칸만 submitted:true가 되고 FILE 유형이면 파일 정보를 싣는다', async () => {
    // Given
    const { repository } = collectionRepository({
      findSubmissionsForCollection: jest.fn().mockResolvedValue([
        {
          milestoneDocumentId: syntheticDocumentId,
          applicationId: syntheticApplicationId,
          submittedAt: new Date('2026-09-16T14:22:00.000Z'),
          file: { originalFileName: '최종_진짜최종.hwp', sizeBytes: 2048 },
        },
        {
          milestoneDocumentId: secondDocumentId,
          applicationId: syntheticApplicationId,
          submittedAt: new Date('2026-09-17T10:00:00.000Z'),
          file: null,
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
        submitted: true,
        submittedAt: '2026-09-16T14:22:00.000Z',
        file: { name: '최종_진짜최종.hwp', sizeBytes: 2048 },
      },
      {
        documentId: secondDocumentId,
        submitted: true,
        submittedAt: '2026-09-17T10:00:00.000Z',
        file: null,
      },
    ]);
    // 다른 팀의 칸이 섞이지 않는다.
    expect(result.rows[1]?.cells.every((cell) => !cell.submitted)).toBe(true);
  });

  it('첨부가 만료돼 리포지토리가 file:null을 주면 목록에도 파일을 싣지 않는다', async () => {
    // Given: 만료 필터가 걸러 낸 상태다 — 「목록엔 보이는데 받으면 실패」를 만들지 않는다.
    const { mocks, repository } = collectionRepository({
      findSubmissionsForCollection: jest.fn().mockResolvedValue([
        {
          milestoneDocumentId: syntheticDocumentId,
          applicationId: syntheticApplicationId,
          submittedAt: new Date('2026-09-16T14:22:00.000Z'),
          file: null,
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
    );
    expect(result.rows[0]?.cells[0]).toEqual({
      documentId: syntheticDocumentId,
      submitted: true,
      submittedAt: '2026-09-16T14:22:00.000Z',
      file: null,
    });
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
    expect(mocks.findSubmissionsForCollection).toHaveBeenCalledTimes(1);
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

  function submission(applicationId: string, milestoneDocumentId: string) {
    return { milestoneDocumentId, applicationId, submittedAt, file: null };
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
          submissionType: MilestoneSubmissionType.TEXT,
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
