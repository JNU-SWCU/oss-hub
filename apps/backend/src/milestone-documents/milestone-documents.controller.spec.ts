import { ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Readable } from 'node:stream';
import { OriginGuard } from '../auth/origin.guard';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import {
  MilestoneDocumentFilesController,
  MilestoneDocumentsController,
} from './milestone-documents.controller';
import type { MilestoneDocumentArchive } from './milestone-document-archive.service';
import { MilestoneDocumentArchiveService } from './milestone-document-archive.service';
import { MilestoneDocumentFilesService } from './milestone-document-files.service';
import { MilestoneDocumentReviewsService } from './milestone-document-reviews.service';
import { MilestoneDocumentsService } from './milestone-documents.service';
import { MilestoneDocumentsStaffGuard } from './milestone-documents-staff.guard';
import type { MilestoneDocumentsStaffRequest } from './milestone-documents-staff.guard';

let application: INestApplication | undefined;
let baseUrl = '';
const SESSION_GITHUB_ID = 342_900_002n;

// MilestoneDocumentsService 목
const listForViewer = jest.fn().mockResolvedValue([
  {
    id: 'synthetic-document',
    milestoneId: 'synthetic-milestone',
    name: '개인정보 수집·이용 동의서',
    required: true,
    sortOrder: 1,
    submissionType: 'FILE',
    hasTemplateFile: true,
    viewerSubmission: {
      submitted: true,
      submittedAt: '2026-09-16T14:22:00.000Z',
    },
  },
]);
const createDocument = jest.fn().mockResolvedValue({
  id: 'synthetic-document-new',
  milestoneId: 'synthetic-milestone',
  name: '새 서류',
  required: true,
  sortOrder: 2,
  submissionType: 'TEXT',
  hasTemplateFile: false,
});
const updateDocument = jest.fn().mockResolvedValue({
  id: 'synthetic-document',
  milestoneId: 'synthetic-milestone',
  name: '수정된 이름',
  required: false,
  sortOrder: 1,
  submissionType: 'FILE',
  hasTemplateFile: true,
});
const deleteDocument = jest.fn().mockResolvedValue(undefined);
const reorderDocuments = jest.fn().mockResolvedValue([
  {
    id: 'synthetic-document-2',
    milestoneId: 'synthetic-milestone',
    name: '팀 활동 보고',
    required: false,
    sortOrder: 1,
    submissionType: 'TEXT',
    hasTemplateFile: false,
  },
  {
    id: 'synthetic-document',
    milestoneId: 'synthetic-milestone',
    name: '개인정보 수집·이용 동의서',
    required: true,
    sortOrder: 2,
    submissionType: 'FILE',
    hasTemplateFile: true,
  },
]);
const collectForStaff = jest.fn().mockResolvedValue({
  milestone: {
    id: 'synthetic-milestone',
    programId: 'cuid-synthetic-program',
    name: '프로젝트 계획서 제출',
    dueAt: '2026-09-19T09:00:00.000Z',
  },
  documents: [
    {
      id: 'synthetic-document',
      name: '개인정보 수집·이용 동의서',
      required: true,
      sortOrder: 1,
      submissionType: 'FILE',
    },
  ],
  rows: [
    {
      applicationId: 'synthetic-application',
      teamName: '가나다팀',
      applicantName: '합성 신청자',
      memberNicknames: ['synthetic-leader'],
      cells: [
        {
          documentId: 'synthetic-document',
          isSubmitted: true,
          submittedAt: '2026-09-16T14:22:00.000Z',
          file: { name: '최종_진짜최종.hwp', sizeBytes: 2048 },
        },
      ],
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
  filterCounts: { all: 1, hasMissing: 0, zeroSubmission: 0 },
  documentTotals: [
    { documentId: 'synthetic-document', submitted: 1, total: 1 },
  ],
});
const submit = jest.fn().mockResolvedValue({
  id: 'synthetic-submission',
  status: 'SUBMITTED',
  content: { type: 'TEXT', text: '본문' },
  submittedAt: '2026-09-16T14:22:00.000Z',
  files: [],
});

// MilestoneDocumentFilesService 목
const uploadTemplate = jest.fn().mockResolvedValue({
  documentId: 'synthetic-document',
  hasTemplateFile: true,
  fileName: '양식.pdf',
  uploadedAt: '2026-09-16T14:22:00.000Z',
});
const downloadTemplate = jest.fn().mockResolvedValue({
  body: Readable.from(Buffer.from('template-body')),
  fileName: '계획서 양식.pdf',
  contentType: 'application/pdf',
  contentLength: 13,
});
const downloadSubmissionFile = jest.fn().mockResolvedValue({
  body: Readable.from(Buffer.from('submission-body')),
  fileName: '가나다팀_개인정보 수집·이용 동의서.hwp',
  contentType: 'application/x-hwp',
  contentLength: 15,
});
const upload = jest.fn().mockResolvedValue({
  fileId: 'synthetic-file',
  fileName: 'synthetic.pdf',
  contentType: 'application/pdf',
  size: 14,
  expiresAt: '2028-01-01T00:00:00.000Z',
});

// MilestoneDocumentArchiveService 목
// 마일스톤 이름과 마감일이 붙은 한글 ZIP 이름 — RFC 5987 인코딩이 실제로 걸리는지 본다.
const ARCHIVE_FILE_NAME = '1차 중간산출물_2026-08-20.zip';
const ARCHIVE_BODY = 'zip-body';
// 호출마다 새 스트림을 만든다 — 하나를 돌려쓰면 두 번째 요청이 이미 소진된 스트림을 받는다.
const archiveForStaff = jest.fn(
  (): Promise<MilestoneDocumentArchive> =>
    Promise.resolve({
      body: Readable.from(Buffer.from(ARCHIVE_BODY)),
      fileName: ARCHIVE_FILE_NAME,
      contentType: 'application/zip',
      contentLength: ARCHIVE_BODY.length,
    }),
);

// MilestoneDocumentReviewsService 목
const review = jest.fn().mockResolvedValue({
  id: 'synthetic-review',
  decision: 'CHANGES_REQUESTED',
  comment: '2쪽 서명이 빠졌습니다.',
  reviewedAt: '2026-09-18T09:00:00.000Z',
  reviewerNickname: 'synthetic-staff',
});

beforeEach(() => {
  listForViewer.mockClear();
  createDocument.mockClear();
  updateDocument.mockClear();
  deleteDocument.mockClear();
  reorderDocuments.mockClear();
  collectForStaff.mockClear();
  archiveForStaff.mockClear();
  submit.mockClear();
  uploadTemplate.mockClear();
  downloadTemplate.mockClear();
  downloadSubmissionFile.mockClear();
  upload.mockClear();
  review.mockClear();
});

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [
      MilestoneDocumentsController,
      MilestoneDocumentFilesController,
    ],
    providers: [
      {
        provide: MilestoneDocumentsService,
        useValue: {
          listForViewer,
          createDocument,
          updateDocument,
          deleteDocument,
          reorderDocuments,
          collectForStaff,
          submit,
        },
      },
      {
        provide: MilestoneDocumentFilesService,
        useValue: {
          uploadTemplate,
          downloadTemplate,
          downloadSubmissionFile,
          upload,
        },
      },
      {
        provide: MilestoneDocumentReviewsService,
        useValue: { review },
      },
      {
        provide: MilestoneDocumentArchiveService,
        useValue: { archiveForStaff },
      },
    ],
  })
    .overrideGuard(SessionGuard)
    .useValue({
      canActivate: (context: ExecutionContext): boolean => {
        const request = context
          .switchToHttp()
          .getRequest<AuthenticatedRequest>();
        request.sessionGithubId = SESSION_GITHUB_ID;
        return true;
      },
    })
    .overrideGuard(OriginGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(MilestoneDocumentsStaffGuard)
    .useValue({
      canActivate: (context: ExecutionContext): boolean => {
        const request = context
          .switchToHttp()
          .getRequest<MilestoneDocumentsStaffRequest>();
        request.milestoneDocumentActorId = 'synthetic-staff';
        return true;
      },
    })
    .compile();

  application = moduleRef.createNestApplication();
  application.setGlobalPrefix('api/v1');
  application.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  application.useGlobalFilters(new ProblemDetailFilter());
  await application.listen(0, '127.0.0.1');
  baseUrl = await application.getUrl();
});

afterAll(async () => {
  await application?.close();
});

it('서류 목록은 브라우저·공유 캐시에 저장하지 않는다', async () => {
  // Given / When
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents`,
  );

  // Then
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  await expect(response.json()).resolves.toMatchObject([
    { id: 'synthetic-document', viewerSubmission: { submitted: true } },
  ]);
  expect(listForViewer).toHaveBeenCalledWith(
    SESSION_GITHUB_ID,
    'synthetic-milestone',
  );
});

it('교직원 서류 항목 추가는 201로 끝나고 서비스에 정규화된 입력을 전달한다', async () => {
  // Given
  const body = {
    name: '  새 서류  ',
    required: true,
    sortOrder: 2,
    submissionType: 'TEXT',
  };

  // When
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  // Then
  expect(response.status).toBe(201);
  await expect(response.json()).resolves.toMatchObject({
    id: 'synthetic-document-new',
  });
  expect(createDocument).toHaveBeenCalledWith('synthetic-milestone', {
    name: '새 서류',
    required: true,
    sortOrder: 2,
    submissionType: 'TEXT',
  });
});

it('필수 필드가 빠진 서류 항목 생성 요청은 서비스 호출 전에 400으로 거절한다', async () => {
  // Given: sortOrder/submissionType이 빠졌다.
  const body = { name: '새 서류', required: true };

  // When
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  // Then
  expect(response.status).toBe(400);
  expect(createDocument).not.toHaveBeenCalled();
});

it('교직원 서류 항목 수정은 200으로 끝난다', async () => {
  // Given
  const body = {
    name: '수정된 이름',
    required: false,
    sortOrder: 1,
    submissionType: 'FILE',
  };

  // When
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  // Then
  expect(response.status).toBe(200);
  expect(updateDocument).toHaveBeenCalledWith(
    'synthetic-milestone',
    'synthetic-document',
    body,
  );
});

it('교직원 서류 항목 삭제는 204로 끝난다', async () => {
  // When
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document`,
    { method: 'DELETE' },
  );

  // Then
  expect(response.status).toBe(204);
  expect(deleteDocument).toHaveBeenCalledWith(
    'synthetic-milestone',
    'synthetic-document',
  );
});

it('서류 순서 재부여는 200으로 끝나고 새 순서 목록을 돌려준다', async () => {
  // Given: 두 번째 항목을 맨 위로 올린 전체 나열이다.
  const body = {
    documentIds: ['synthetic-document-2', 'synthetic-document'],
  };

  // When
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/order`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  // Then: 응답은 목록 조회와 같은 shape이다(프런트가 그대로 갈아 끼운다).
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject([
    { id: 'synthetic-document-2', sortOrder: 1 },
    { id: 'synthetic-document', sortOrder: 2 },
  ]);
  expect(reorderDocuments).toHaveBeenCalledWith('synthetic-milestone', [
    'synthetic-document-2',
    'synthetic-document',
  ]);
});

it('서류 순서 재부여 경로(order)는 :documentId 수정 경로로 잘못 잡히지 않는다', async () => {
  // Given / When
  await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/order`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documentIds: ['synthetic-document'] }),
    },
  );

  // Then: `order`를 id로 착각해 서류 항목 수정 핸들러가 타면 안 된다.
  expect(reorderDocuments).toHaveBeenCalledTimes(1);
  expect(updateDocument).not.toHaveBeenCalled();
});

it('documentIds가 문자열 배열이 아니면 서비스 호출 전에 400으로 거절한다', async () => {
  // Given
  const body = { documentIds: [1, 2] };

  // When
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/order`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  // Then
  expect(response.status).toBe(400);
  expect(reorderDocuments).not.toHaveBeenCalled();
});

it('학생 서류 제출은 201로 끝나고 content를 서비스에 전달한다', async () => {
  // Given
  const body = { content: { type: 'TEXT', text: '본문' } };

  // When
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/submissions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  // Then
  expect(response.status).toBe(201);
  await expect(response.json()).resolves.toMatchObject({
    id: 'synthetic-submission',
  });
  expect(submit).toHaveBeenCalledWith(
    SESSION_GITHUB_ID,
    'synthetic-milestone',
    'synthetic-document',
    { type: 'TEXT', text: '본문' },
  );
});

it('content 타입이 누락된 제출은 서비스 호출 전에 400으로 거절한다', async () => {
  // Given
  const body = { content: { text: '본문' } };

  // When
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/submissions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  // Then
  expect(response.status).toBe(400);
  expect(submit).not.toHaveBeenCalled();
});

it('양식 업로드("양식 올리기"/"양식 교체")는 201로 끝나고 multipart 파일을 서비스에 전달한다', async () => {
  // Given
  const body = new FormData();
  body.append(
    'file',
    new Blob([Buffer.from('%PDF-1.4\n%%EOF')], { type: 'application/pdf' }),
    'synthetic-template.pdf',
  );

  // When
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/template`,
    { method: 'POST', body },
  );

  // Then
  expect(response.status).toBe(201);
  await expect(response.json()).resolves.toMatchObject({
    hasTemplateFile: true,
  });
  expect(uploadTemplate).toHaveBeenCalledWith(
    'synthetic-staff',
    'synthetic-milestone',
    'synthetic-document',
    expect.objectContaining({ originalname: 'synthetic-template.pdf' }),
  );
});

it('양식 다운로드("양식" 링크)는 attachment 스트림과 private no-store 헤더를 반환한다', async () => {
  // When
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/template`,
  );

  // Then
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('content-type')).toBe('application/pdf');
  expect(response.headers.get('content-length')).toBe('13');
  expect(response.headers.get('content-disposition')).toContain('attachment');
  await expect(response.text()).resolves.toBe('template-body');
  expect(downloadTemplate).toHaveBeenCalledWith(
    SESSION_GITHUB_ID,
    'synthetic-milestone',
    'synthetic-document',
  );
});

it('/milestone-document-files는 201로 끝나고 milestoneId/documentId를 함께 전달한다', async () => {
  // Given
  const body = new FormData();
  body.append('milestoneId', 'synthetic-milestone');
  body.append('documentId', 'synthetic-document');
  body.append(
    'file',
    new Blob([Buffer.from('%PDF-1.4\n%%EOF')], { type: 'application/pdf' }),
    'synthetic.pdf',
  );

  // When
  const response = await fetch(`${baseUrl}/api/v1/milestone-document-files`, {
    method: 'POST',
    body,
  });

  // Then
  expect(response.status).toBe(201);
  await expect(response.json()).resolves.toMatchObject({
    fileId: 'synthetic-file',
  });
  expect(upload).toHaveBeenCalledWith(
    SESSION_GITHUB_ID,
    'synthetic-milestone',
    'synthetic-document',
    expect.objectContaining({ originalname: 'synthetic.pdf' }),
  );
});

it('서류 수합 조회는 교직원 가드를 거치고 private no-store로 응답한다', async () => {
  // Given / When
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/collection`,
  );

  // Then
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  await expect(response.json()).resolves.toMatchObject({
    milestone: {
      id: 'synthetic-milestone',
      programId: 'cuid-synthetic-program',
      name: '프로젝트 계획서 제출',
    },
    documents: [{ id: 'synthetic-document', sortOrder: 1 }],
    rows: [
      {
        teamName: '가나다팀',
        cells: [{ documentId: 'synthetic-document', isSubmitted: true }],
      },
    ],
    page: 1,
    pageSize: 20,
    total: 1,
    filterCounts: { all: 1, hasMissing: 0, zeroSubmission: 0 },
    documentTotals: [
      { documentId: 'synthetic-document', submitted: 1, total: 1 },
    ],
  });
  // 쿼리를 안 주면 1페이지 20건 · 전체 필터가 기본값이다(ADR-004 페이지네이션 계약).
  expect(collectForStaff).toHaveBeenCalledWith('synthetic-milestone', {
    page: 1,
    pageSize: 20,
    filter: 'ALL',
  });
});

it('서류 수합 조회는 page·pageSize·filter를 숫자·enum으로 바꿔 서비스에 전달한다', async () => {
  // Given / When
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/collection?page=2&pageSize=5&filter=HAS_MISSING`,
  );

  // Then
  expect(response.status).toBe(200);
  expect(collectForStaff).toHaveBeenCalledWith('synthetic-milestone', {
    page: 2,
    pageSize: 5,
    filter: 'HAS_MISSING',
  });
});

it('범위를 벗어난 pageSize는 서비스 호출 전에 400으로 거절한다', async () => {
  // Given: 최대 100을 넘겼다.
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/collection?pageSize=101`,
  );

  // Then
  expect(response.status).toBe(400);
  expect(collectForStaff).not.toHaveBeenCalled();
});

it('모르는 filter 값은 서비스 호출 전에 400으로 거절한다', async () => {
  // Given / When
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/collection?filter=SOMETHING_ELSE`,
  );

  // Then
  expect(response.status).toBe(400);
  expect(collectForStaff).not.toHaveBeenCalled();
});

it('서류 수합 조회 경로(collection)는 :documentId 경로로 잘못 잡히지 않는다', async () => {
  // Given / When
  await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/collection`,
  );

  // Then: 서류 항목 상세 계열 핸들러가 아니라 수합 핸들러가 탄다.
  expect(collectForStaff).toHaveBeenCalledTimes(1);
  expect(downloadTemplate).not.toHaveBeenCalled();
});

it('제출 파일 다운로드는 다시 붙인 이름으로 attachment 스트림을 반환한다', async () => {
  // Given / When
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/applications/synthetic-application/file`,
  );

  // Then
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('content-type')).toBe('application/x-hwp');
  expect(response.headers.get('content-length')).toBe('15');
  const disposition = response.headers.get('content-disposition') ?? '';
  expect(disposition).toContain('attachment');
  expect(disposition).toContain(
    `filename*=UTF-8''${encodeURIComponent('가나다팀_개인정보 수집·이용 동의서.hwp')}`,
  );
  await expect(response.text()).resolves.toBe('submission-body');
  expect(downloadSubmissionFile).toHaveBeenCalledWith(
    'synthetic-milestone',
    'synthetic-document',
    'synthetic-application',
  );
});

describe('교직원 서류 일괄 내려받기(ZIP)', () => {
  const archiveUrl = (query = ''): string =>
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/collection/archive${query}`;

  it('groupBy를 안 주면 팀별 묶기(TEAM)로 서비스를 부른다', async () => {
    // Given / When
    const response = await fetch(archiveUrl());

    // Then: 기본값은 DTO(toGrouping)가 정한다 — 서비스는 언제나 확정된 값을 받는다.
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe(ARCHIVE_BODY);
    expect(archiveForStaff).toHaveBeenCalledWith('synthetic-milestone', 'TEAM');
  });

  it('groupBy=DOCUMENT는 그대로 서비스에 전달한다', async () => {
    // Given / When
    const response = await fetch(archiveUrl('?groupBy=DOCUMENT'));

    // Then
    expect(response.status).toBe(200);
    expect(archiveForStaff).toHaveBeenCalledWith(
      'synthetic-milestone',
      'DOCUMENT',
    );
  });

  it('ZIP 응답은 application/zip · attachment · private no-store로 나간다', async () => {
    // Given / When
    const response = await fetch(archiveUrl());

    // Then
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const disposition = response.headers.get('content-disposition') ?? '';
    expect(disposition).toContain('attachment');
    // 한글 이름은 RFC 5987로 실어야 브라우저가 `_____.zip`이 아닌 제 이름으로 저장한다.
    expect(disposition).toContain(
      `filename*=UTF-8''${encodeURIComponent(ARCHIVE_FILE_NAME)}`,
    );
    expect(disposition).toContain('.zip');
  });

  it('길이를 아는 ZIP은 Content-Length를 실어 보낸다', async () => {
    // Given / When
    const response = await fetch(archiveUrl());

    // Then: 이 값이 있어야 브라우저가 중간에 끊긴 내려받기를 실패로 판정한다.
    expect(response.headers.get('content-length')).toBe(
      String(ARCHIVE_BODY.length),
    );
  });

  it('길이를 모르는 ZIP은 Content-Length를 아예 붙이지 않는다 — 청크 전송이다', async () => {
    // Given: 크기를 미리 셀 수 없었던 압축(contentLength === null).
    archiveForStaff.mockResolvedValueOnce({
      body: Readable.from(Buffer.from(ARCHIVE_BODY)),
      fileName: ARCHIVE_FILE_NAME,
      contentType: 'application/zip',
      contentLength: null,
    });

    // When
    const response = await fetch(archiveUrl());

    // Then: `String(null)`이 헤더로 나가면 받는 쪽이 길이를 0이나 오류로 읽는다.
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBeNull();
    expect(response.headers.get('content-type')).toBe('application/zip');
    await expect(response.text()).resolves.toBe(ARCHIVE_BODY);
  });

  it('일괄 내려받기 경로(collection/archive)는 :documentId 경로로 잘못 잡히지 않는다', async () => {
    // Given / When
    await fetch(archiveUrl());

    // Then: 수합 표도, 서류 항목 상세 계열 핸들러도 아니라 일괄 내려받기 핸들러가 탄다.
    expect(archiveForStaff).toHaveBeenCalledTimes(1);
    expect(collectForStaff).not.toHaveBeenCalled();
    expect(downloadTemplate).not.toHaveBeenCalled();
  });

  it.each([['TEAMS'], ['team'], ['']])(
    'groupBy가 %p이면 서비스 호출 전에 400으로 거절한다',
    async (groupBy) => {
      // Given: 오타·소문자·빈 값을 조용히 기본값으로 접으면 교직원은 팀별로 묶었다고 믿고
      // 서류별로 묶인 ZIP을 받는다.
      const response = await fetch(
        archiveUrl(`?groupBy=${encodeURIComponent(groupBy)}`),
      );

      // Then
      expect(response.status).toBe(400);
      expect(archiveForStaff).not.toHaveBeenCalled();
    },
  );

  it('groupBy를 배열로 보내면 400으로 거절한다', async () => {
    // Given: `?groupBy=TEAM&groupBy=DOCUMENT`는 express가 배열로 파싱한다.
    const response = await fetch(archiveUrl('?groupBy=TEAM&groupBy=DOCUMENT'));

    // Then
    expect(response.status).toBe(400);
    expect(archiveForStaff).not.toHaveBeenCalled();
  });

  it.each([['page', 'page=2'], ['filter', 'filter=HAS_MISSING']])(
    '이 경로가 받지 않는 쿼리(%s)는 400으로 거절한다 — 필터·페이지는 계약에 없다',
    async (_name, query) => {
      // Given: 「필수 서류 미제출」로 걸러 놓고 받은 ZIP을 그 팀들만 담긴 것으로 읽으면
      // 안 되므로, 표의 쿼리가 이 경로에서 조용히 무시되는 대신 드러나게 막힌다.
      const response = await fetch(archiveUrl(`?${query}`));

      // Then
      expect(response.status).toBe(400);
      expect(archiveForStaff).not.toHaveBeenCalled();
    },
  );
});

describe('교직원 서류 제출물 판정', () => {
  /**
   * 수합 표 칸이 준 「본 그 버전」 — 프런트는 칸의 `revision`과 `review.id`를 그대로
   * 되돌려 보낸다. 판정이 없던 칸은 `expectedLatestReviewId: null`이다.
   */
  const seenVersion = {
    expectedRevision: 3,
    expectedLatestReviewId: null,
  };

  it('판정은 201로 끝나고 판정자 nickname까지 실어 돌려준다', async () => {
    // Given
    const body = {
      decision: 'CHANGES_REQUESTED',
      comment: '2쪽 서명이 빠졌습니다.',
      ...seenVersion,
    };

    // When
    const response = await fetch(
      `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/applications/synthetic-application/reviews`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    // Then
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      id: 'synthetic-review',
      decision: 'CHANGES_REQUESTED',
      comment: '2쪽 서명이 빠졌습니다.',
      reviewedAt: '2026-09-18T09:00:00.000Z',
      reviewerNickname: 'synthetic-staff',
    });
    // 판정자는 세션이 아니라 가드가 확정한 교직원 id다.
    expect(review).toHaveBeenCalledWith(
      'synthetic-staff',
      'synthetic-milestone',
      'synthetic-document',
      'synthetic-application',
      {
        decision: 'CHANGES_REQUESTED',
        comment: '2쪽 서명이 빠졌습니다.',
        // 본문의 정수가 그대로 넘어간다 — 비교는 리비전 값으로 한다.
        expectedRevision: 3,
        expectedLatestReviewId: null,
      },
    );
  });

  it('승인은 사유 없이도 통과하고 comment는 null로 정규화된다', async () => {
    // Given
    const body = { decision: 'APPROVED', ...seenVersion };

    // When
    const response = await fetch(
      `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/applications/synthetic-application/reviews`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    // Then
    expect(response.status).toBe(201);
    expect(review).toHaveBeenCalledWith(
      'synthetic-staff',
      'synthetic-milestone',
      'synthetic-document',
      'synthetic-application',
      {
        decision: 'APPROVED',
        comment: null,
        expectedRevision: 3,
        expectedLatestReviewId: null,
      },
    );
  });

  it('보완 요청에 사유가 없으면 서비스 호출 전에 422로 거절한다', async () => {
    // Given
    const body = { decision: 'CHANGES_REQUESTED', ...seenVersion };

    // When
    const response = await fetch(
      `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/applications/synthetic-application/reviews`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    // Then
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: 'MSD_021' });
    expect(review).not.toHaveBeenCalled();
  });

  it('반려 사유가 공백뿐이면 422로 거절한다 — 학생 화면에 빈 사유가 남지 않게 한다', async () => {
    // Given
    const body = { decision: 'REJECTED', comment: '   ', ...seenVersion };

    // When
    const response = await fetch(
      `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/applications/synthetic-application/reviews`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    // Then
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: 'MSD_021' });
    expect(review).not.toHaveBeenCalled();
  });

  it('알 수 없는 decision은 400으로 거절한다', async () => {
    // Given
    const body = { decision: 'MAYBE', comment: '음', ...seenVersion };

    // When
    const response = await fetch(
      `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/applications/synthetic-application/reviews`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    // Then
    expect(response.status).toBe(400);
    expect(review).not.toHaveBeenCalled();
  });

  it.each([
    ['expectedRevision', { expectedLatestReviewId: null }],
    ['expectedLatestReviewId', { expectedRevision: 3 }],
  ])(
    '%s를 빼먹은 요청은 400으로 막는다 — 기대 버전 없이 판정이 통과하면 검사가 없는 것과 같다',
    async (_field, partialVersion) => {
      // Given: 「보내면 검사하고 안 보내면 넘어간다」로 두면 요청 하나로 대조를 우회한다.
      const body = {
        decision: 'APPROVED',
        ...partialVersion,
      };

      // When
      const response = await fetch(
        `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/applications/synthetic-application/reviews`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

      // Then
      expect(response.status).toBe(400);
      expect(review).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['문자열', '3'],
    ['소수', 1.5],
    ['0', 0],
  ])(
    'expectedRevision이 %s이면 400으로 막는다 — 어떤 제출도 가리키지 못하는 값이다',
    async (_shape, expectedRevision) => {
      // Given: 리비전은 1부터 시작하는 정수다. 느슨하게 받으면 대조가 언제나 어긋나 판정이
      // 전부 409가 되고, 교직원에게는 「새로고침하라」만 반복된다 — 원인은 요청 값인데
      // 화면은 경합이 일어났다고 말한다.
      const body = {
        decision: 'APPROVED',
        expectedRevision,
        expectedLatestReviewId: null,
      };

      // When
      const response = await fetch(
        `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/applications/synthetic-application/reviews`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

      // Then
      expect(response.status).toBe(400);
      expect(review).not.toHaveBeenCalled();
    },
  );
});

function readHandlerGuards(propertyKey: string): unknown {
  const handler: unknown = Object.getOwnPropertyDescriptor(
    MilestoneDocumentsController.prototype,
    propertyKey,
  )?.value;
  expect(typeof handler).toBe('function');
  return Reflect.getMetadata(GUARDS_METADATA, handler as object);
}

describe('교직원 전용 endpoint의 가드 구성', () => {
  it('서류 수합 조회는 SessionGuard + MilestoneDocumentsStaffGuard를 붙인다', () => {
    // Given / When
    const guards = readHandlerGuards('collection');

    // Then
    expect(guards).toEqual([SessionGuard, MilestoneDocumentsStaffGuard]);
  });

  it('서류 일괄 내려받기는 SessionGuard + MilestoneDocumentsStaffGuard를 붙인다', () => {
    // Given / When
    const guards = readHandlerGuards('archive');

    // Then: 마일스톤의 모든 제출물을 한 번에 내보내는 경로다 — 교직원 가드가 빠지면
    // 학생 세션 하나로 전체 산출물을 통째로 가져갈 수 있다.
    expect(guards).toEqual([SessionGuard, MilestoneDocumentsStaffGuard]);
  });

  it('서류 순서 재부여는 SessionGuard + MilestoneDocumentsStaffGuard + OriginGuard를 붙인다', () => {
    // Given / When
    const guards = readHandlerGuards('reorder');

    // Then: 상태를 바꾸는 요청이라 CSRF 방어(OriginGuard)까지 붙는다.
    expect(guards).toEqual([
      SessionGuard,
      MilestoneDocumentsStaffGuard,
      OriginGuard,
    ]);
  });

  it('제출 파일 다운로드는 SessionGuard + MilestoneDocumentsStaffGuard를 붙인다', () => {
    // Given / When
    const guards = readHandlerGuards('downloadSubmissionFile');

    // Then: 인가 사슬 1번(ACTIVE + STAFF/ADMIN)은 이 가드가 담당한다.
    expect(guards).toEqual([SessionGuard, MilestoneDocumentsStaffGuard]);
  });

  it('제출물 판정은 SessionGuard + MilestoneDocumentsStaffGuard + OriginGuard를 붙인다', () => {
    // Given / When
    const guards = readHandlerGuards('review');

    // Then: 상태를 바꾸는 요청이라 CSRF 방어(OriginGuard)까지 붙는다.
    expect(guards).toEqual([
      SessionGuard,
      MilestoneDocumentsStaffGuard,
      OriginGuard,
    ]);
  });
});
