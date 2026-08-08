import {
  MilestoneSubmissionType,
  Prisma,
  Role,
  SubmissionStatus,
} from '@prisma/client';
import { MilestoneDocumentsErrorCode } from './milestone-documents-error-code.enum';
import {
  MilestoneDocumentPendingFileMissingError,
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
    submissionType: MilestoneSubmissionType.FILE,
    templateFileId: null,
    ...overrides,
  };
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
    deleteDocument: jest.fn(),
    countSubmissionsForDocument: jest.fn().mockResolvedValue(0),
    upsertSubmission: jest.fn(),
    findApprovedApplicationsForCollection: jest.fn().mockResolvedValue([]),
    findSubmissionsForCollection: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
  return {
    mocks,
    repository: mocks as unknown as MilestoneDocumentsRepository,
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
    // Given: 서류의 milestoneId가 요청 경로의 milestoneId와 다르다.
    const { mocks, repository } = buildRepository({
      findDocumentContext: jest.fn().mockResolvedValue({
        id: syntheticDocumentId,
        milestoneId: 'cuid-other-milestone',
        programId: syntheticProgramId,
        dueAt: new Date(),
        required: true,
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
      service.collectForStaff(syntheticMilestoneId, now),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND },
    });
  });

  it('마일스톤 요약과 서류 목록을 sortOrder 순 그대로 싣는다', async () => {
    // Given
    const { repository } = collectionRepository();
    const service = new MilestoneDocumentsService(repository);

    // When
    const result = await service.collectForStaff(syntheticMilestoneId, now);

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
    const result = await service.collectForStaff(syntheticMilestoneId, now);

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
    const result = await service.collectForStaff(syntheticMilestoneId, now);

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
    const result = await service.collectForStaff(syntheticMilestoneId, now);

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
    const result = await service.collectForStaff(syntheticMilestoneId, now);

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
    await service.collectForStaff(syntheticMilestoneId, now);

    // Then
    expect(mocks.findByMilestoneId).toHaveBeenCalledTimes(1);
    expect(mocks.findApprovedApplicationsForCollection).toHaveBeenCalledTimes(
      1,
    );
    expect(mocks.findSubmissionsForCollection).toHaveBeenCalledTimes(1);
  });
});
