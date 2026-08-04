import { ValidationPipe } from '@nestjs/common';
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
    viewerSubmission: { submitted: true, submittedAt: '2026-09-16T14:22:00.000Z' },
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
  submit.mockClear();
  uploadTemplate.mockClear();
  downloadTemplate.mockClear();
  upload.mockClear();
});

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [MilestoneDocumentsController, MilestoneDocumentFilesController],
    providers: [
      {
        provide: MilestoneDocumentsService,
        useValue: {
          listForViewer,
          createDocument,
          updateDocument,
          deleteDocument,
          submit,
        },
      },
      {
        provide: MilestoneDocumentFilesService,
        useValue: { uploadTemplate, downloadTemplate, upload },
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
        const request = context.switchToHttp().getRequest();
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
