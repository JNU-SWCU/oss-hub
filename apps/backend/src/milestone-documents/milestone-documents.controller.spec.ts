import { Logger, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type {
  ExecutionContext,
  INestApplication,
  StreamableFile,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import { OriginGuard } from '../auth/origin.guard';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import {
  MilestoneDocumentFilesController,
  MilestoneDocumentsController,
} from './milestone-documents.controller';
import { MilestoneDocumentArchiveQueryRequestDto } from './dto/milestone-document-archive-query.dto';
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
  submissionType: 'FILE',
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
const archiveForStaff = jest.fn((): Promise<MilestoneDocumentArchive> =>
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
  });
});

it('새 서류 항목 요청에 상위 FILE/TEXT 선택을 넣으면 400으로 거절한다', async () => {
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '새 서류',
        required: true,
        sortOrder: 2,
        submissionType: 'TEXT',
      }),
    },
  );

  expect(response.status).toBe(400);
  expect(createDocument).not.toHaveBeenCalled();
});

it('필수 필드가 빠진 서류 항목 생성 요청은 서비스 호출 전에 400으로 거절한다', async () => {
  // Given: sortOrder가 빠졌다.
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

it('학생 서류 제출은 내용과 파일을 함께 서비스에 전달한다', async () => {
  // Given
  const body = { content: { text: '본문', fileId: 'synthetic-file' } };

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
    { text: '본문', fileId: 'synthetic-file' },
  );
});

it('내용만 있는 제출도 서비스에 전달한다', async () => {
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
  expect(response.status).toBe(201);
  expect(submit).toHaveBeenCalledWith(
    SESSION_GITHUB_ID,
    'synthetic-milestone',
    'synthetic-document',
    { text: '본문', fileId: null },
  );
});

it('내용과 파일이 모두 비어 있으면 서비스 호출 전에 422로 거절한다', async () => {
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/submissions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: { text: '  ', fileId: '  ' } }),
    },
  );

  expect(response.status).toBe(422);
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
    expect(archiveForStaff).toHaveBeenCalledWith('synthetic-milestone', {
      kind: 'ALL',
      grouping: 'TEAM',
    });
  });

  it('groupBy=DOCUMENT는 그대로 서비스에 전달한다', async () => {
    // Given / When
    const response = await fetch(archiveUrl('?groupBy=DOCUMENT'));

    // Then
    expect(response.status).toBe(200);
    expect(archiveForStaff).toHaveBeenCalledWith('synthetic-milestone', {
      kind: 'ALL',
      grouping: 'DOCUMENT',
    });
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

  it('documentId를 주면 그 서류로 좁힌 범위로 서비스를 부른다', async () => {
    const response = await fetch(archiveUrl('?documentId=doc-plan'));

    expect(response.status).toBe(200);
    expect(archiveForStaff).toHaveBeenCalledWith('synthetic-milestone', {
      kind: 'DOCUMENT',
      documentId: 'doc-plan',
    });
  });

  it('documentId와 groupBy를 함께 주면 400으로 거절한다', async () => {
    /*
     * 서류 하나짜리 ZIP에는 묶는 방식이 없다. 조용히 한쪽을 무시하면 `groupBy=DOCUMENT`를
     * 보낸 사람은 「서류별로 묶어 받았다」고 믿은 채 남는다 — 되돌려 주는 편이 정직하다.
     */
    const response = await fetch(
      archiveUrl('?documentId=doc-plan&groupBy=TEAM'),
    );

    expect(response.status).toBe(400);
    expect(archiveForStaff).not.toHaveBeenCalled();
  });

  it('빈 documentId는 400으로 거절한다', async () => {
    const response = await fetch(archiveUrl('?documentId='));

    expect(response.status).toBe(400);
    expect(archiveForStaff).not.toHaveBeenCalled();
  });

  it('groupBy를 배열로 보내면 400으로 거절한다', async () => {
    // Given: `?groupBy=TEAM&groupBy=DOCUMENT`는 express가 배열로 파싱한다.
    const response = await fetch(archiveUrl('?groupBy=TEAM&groupBy=DOCUMENT'));

    // Then
    expect(response.status).toBe(400);
    expect(archiveForStaff).not.toHaveBeenCalled();
  });

  it.each([
    ['page', 'page=2'],
    ['filter', 'filter=HAS_MISSING'],
  ])(
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

  /**
   * 압축을 흘려 보내다 실패했을 때.
   *
   * ⚠ 이 갈래를 덮지 않으면 Nest의 **기본 errorHandler**로 조용히 되돌아간다. 기본 구현은
   * `res.statusCode = 400; res.send(err.message)`라서 이 저장소의 ProblemDetailFilter를 거치지
   * 않은 **오류 원문**이 그대로 본문이 되고, 헤더에는 이미 `application/zip`과 첨부 파일명이
   * 붙어 있어 받는 쪽은 ZIP인 줄 알고 저장한다.
   *
   * 오류는 스트림이 흐르는 도중에 나야 재현되므로 HTTP 요청으로는 시점을 고정할 수 없다.
   * 대신 핸들러가 돌려준 StreamableFile에서 `errorHandler`를 꺼내 세 갈래(헤더 전·헤더 후·
   * 파괴됨)를 그대로 부른다.
   */
  describe('압축 도중 실패', () => {
    const ARCHIVE_REQUEST_PATH =
      '/api/v1/milestones/synthetic-milestone/documents/collection/archive';
    const STORAGE_ERROR_MESSAGE =
      'synthetic-bucket 연결이 끊겼다 (secret-token-would-leak-here)';

    /** 컨트롤러가 실제로 손대는 express Response의 부분집합. */
    interface ArchiveResponseStub {
      headersSent: boolean;
      destroyed: boolean;
      req: { path: string };
      setHeader(name: string, value: string): ArchiveResponseStub;
      removeHeader(name: string): void;
      once(event: string, listener: () => void): ArchiveResponseStub;
      status(code: number): ArchiveResponseStub;
      contentType(type: string): ArchiveResponseStub;
      json(body: unknown): ArchiveResponseStub;
      end(): ArchiveResponseStub;
    }

    interface ArchiveResponseProbe {
      readonly response: Response;
      /** 지금 응답에 실려 있는 헤더(소문자 이름 → 값). removeHeader가 실제로 지운다. */
      readonly headers: Map<string, string>;
      readonly closeListeners: (() => void)[];
      readonly written: {
        status?: number;
        contentType?: string;
        body?: unknown;
        ended: boolean;
      };
    }

    const createArchiveResponseProbe = (
      state: { headersSent?: boolean; destroyed?: boolean } = {},
    ): ArchiveResponseProbe => {
      const headers = new Map<string, string>();
      const closeListeners: (() => void)[] = [];
      const written: ArchiveResponseProbe['written'] = { ended: false };
      const stub: ArchiveResponseStub = {
        headersSent: state.headersSent ?? false,
        destroyed: state.destroyed ?? false,
        req: { path: ARCHIVE_REQUEST_PATH },
        setHeader(name, value) {
          headers.set(name.toLowerCase(), value);
          return stub;
        },
        removeHeader(name) {
          headers.delete(name.toLowerCase());
        },
        once(event, listener) {
          if (event === 'close') closeListeners.push(listener);
          return stub;
        },
        status(code) {
          written.status = code;
          return stub;
        },
        contentType(type) {
          written.contentType = type;
          return stub;
        },
        json(body) {
          written.body = body;
          return stub;
        },
        end() {
          written.ended = true;
          return stub;
        },
      };
      return {
        response: stub as unknown as Response,
        headers,
        closeListeners,
        written,
      };
    };

    /**
     * Nest가 errorHandler에 함께 넘기는 좁은 응답 객체. 컨트롤러의 핸들러는 이것을 **쓰지
     * 않지만**, 기본 errorHandler는 여기에 400과 오류 원문을 쓴다 — 그래서 이 객체가
     * 그대로인지가 「기본 동작으로 되돌아가지 않았다」의 증거가 된다.
     */
    type NestStreamableResponse = Parameters<StreamableFile['errorHandler']>[1];

    const createNestStreamableProbe = (): {
      response: NestStreamableResponse;
      sent: string[];
    } => {
      const sent: string[] = [];
      return {
        response: {
          destroyed: false,
          headersSent: false,
          statusCode: 200,
          send: (body) => {
            sent.push(body);
          },
          end: () => undefined,
        },
        sent,
      };
    };

    const streamArchive = (
      probe: ArchiveResponseProbe,
    ): Promise<StreamableFile> => {
      if (application === undefined) {
        throw new Error('테스트 애플리케이션이 아직 뜨지 않았다');
      }
      return application
        .get(MilestoneDocumentsController)
        .archive(
          'synthetic-milestone',
          new MilestoneDocumentArchiveQueryRequestDto(),
          probe.response,
        );
    };

    let loggedErrors: unknown[];

    beforeEach(() => {
      loggedErrors = [];
      jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation((message: unknown) => {
          loggedErrors.push(message);
        });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('헤더가 나가기 전에 실패하면 503 problem+json으로 바꾸고 ZIP 헤더를 걷어 낸다', async () => {
      // Given: 성공을 전제로 Content-Length·Content-Disposition이 이미 붙어 있다.
      const probe = createArchiveResponseProbe();
      const streamable = await streamArchive(probe);
      expect(probe.headers.get('content-length')).toBe(
        String(ARCHIVE_BODY.length),
      );
      expect(probe.headers.has('content-disposition')).toBe(true);
      const nest = createNestStreamableProbe();

      // When
      streamable.errorHandler(new Error(STORAGE_ERROR_MESSAGE), nest.response);

      // Then: ZIP이 아닌 것을 ZIP이라고 말하지 않는다.
      expect(probe.headers.has('content-length')).toBe(false);
      expect(probe.headers.has('content-disposition')).toBe(false);
      expect(probe.written.status).toBe(503);
      expect(probe.written.contentType).toBe('application/problem+json');
      expect(probe.written.body).toEqual({
        type: 'about:blank',
        title: 'Service Unavailable',
        status: 503,
        // 오류 원문이 아니라 사람에게 보여 줄 문구가 나간다.
        detail: '파일 저장소를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
        instance: ARCHIVE_REQUEST_PATH,
        code: 'MSD_012',
      });
    });

    it('오류 원문을 본문으로 내보내지 않는다 — Nest 기본 errorHandler로 되돌아가면 샌다', async () => {
      // Given
      const probe = createArchiveResponseProbe();
      const streamable = await streamArchive(probe);
      const nest = createNestStreamableProbe();

      // When
      streamable.errorHandler(new Error(STORAGE_ERROR_MESSAGE), nest.response);

      // Then: 기본 구현이었다면 statusCode가 400이 되고 send()로 원문이 나갔을 자리다.
      expect(nest.sent).toEqual([]);
      expect(nest.response.statusCode).toBe(200);
      expect(JSON.stringify(probe.written.body)).not.toContain(
        STORAGE_ERROR_MESSAGE,
      );
      expect(probe.written.status).not.toBe(400);
    });

    it('헤더가 이미 나갔으면 본문을 새로 쓰지 않고 끊는다', async () => {
      // Given: 한 바이트라도 나갔으면 되돌릴 것이 없다 — 미리 실어 둔 Content-Length가
      // 브라우저에게 「덜 받았다」를 말해 준다.
      const probe = createArchiveResponseProbe({ headersSent: true });
      const streamable = await streamArchive(probe);
      const nest = createNestStreamableProbe();

      // When
      streamable.errorHandler(new Error(STORAGE_ERROR_MESSAGE), nest.response);

      // Then
      expect(probe.written.ended).toBe(true);
      expect(probe.written.status).toBeUndefined();
      expect(probe.written.body).toBeUndefined();
      // 이미 나간 헤더를 걷으려 들지 않는다(걷어도 소용없고 오류만 난다).
      expect(probe.headers.has('content-disposition')).toBe(true);
    });

    it('응답이 이미 파괴됐으면 아무것도 하지 않는다', async () => {
      // Given: 교직원이 내려받기를 취소해 소켓이 이미 닫힌 뒤다.
      const probe = createArchiveResponseProbe({
        destroyed: true,
        headersSent: true,
      });
      const streamable = await streamArchive(probe);
      const nest = createNestStreamableProbe();

      // When
      streamable.errorHandler(new Error(STORAGE_ERROR_MESSAGE), nest.response);

      // Then: 닫힌 소켓에 쓰면 잡을 곳 없는 예외가 된다.
      expect(probe.written.ended).toBe(false);
      expect(probe.written.status).toBeUndefined();
      expect(probe.written.body).toBeUndefined();
    });

    it('실패는 서버 로그에 남긴다 — 「받다가 멈췄다」 신고에 맞댈 근거가 된다', async () => {
      // Given
      const probe = createArchiveResponseProbe({ destroyed: true });
      const streamable = await streamArchive(probe);
      const nest = createNestStreamableProbe();

      // When
      streamable.errorHandler(new Error(STORAGE_ERROR_MESSAGE), nest.response);

      // Then: 응답을 못 쓰는 갈래에서도 로그는 남는다.
      expect(loggedErrors).toHaveLength(1);
      expect(String(loggedErrors[0])).toContain(STORAGE_ERROR_MESSAGE);
    });

    it('응답이 close를 내면 압축 스트림을 파괴한다 — 취소해도 서버가 계속 끌어오면 안 된다', async () => {
      // Given: Nest의 Express 어댑터는 `stream.pipe(response)`만 하고, pipe는 받는 쪽이 닫혀도
      // 주는 쪽을 파괴하지 않는다(unpipe만 한다).
      const body = Readable.from(Buffer.from(ARCHIVE_BODY));
      const destroy = jest.spyOn(body, 'destroy');
      archiveForStaff.mockResolvedValueOnce({
        body,
        fileName: ARCHIVE_FILE_NAME,
        contentType: 'application/zip',
        contentLength: ARCHIVE_BODY.length,
      });
      const probe = createArchiveResponseProbe();

      // When
      await streamArchive(probe);

      // Then
      expect(probe.closeListeners).toHaveLength(1);
      expect(destroy).not.toHaveBeenCalled();

      // When: 교직원이 내려받기를 취소했다.
      for (const listener of probe.closeListeners) listener();

      // Then
      expect(destroy).toHaveBeenCalledTimes(1);
    });
  });
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
