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
import { MilestoneDocumentFilesService } from './milestone-document-files.service';
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
          submitted: true,
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

beforeEach(() => {
  listForViewer.mockClear();
  createDocument.mockClear();
  updateDocument.mockClear();
  deleteDocument.mockClear();
  reorderDocuments.mockClear();
  collectForStaff.mockClear();
  submit.mockClear();
  uploadTemplate.mockClear();
  downloadTemplate.mockClear();
  downloadSubmissionFile.mockClear();
  upload.mockClear();
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
    milestone: { id: 'synthetic-milestone', name: '프로젝트 계획서 제출' },
    documents: [{ id: 'synthetic-document', sortOrder: 1 }],
    rows: [
      {
        teamName: '가나다팀',
        cells: [{ documentId: 'synthetic-document', submitted: true }],
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
});
