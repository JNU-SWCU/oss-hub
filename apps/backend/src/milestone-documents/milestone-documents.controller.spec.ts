import { Logger, ValidationPipe } from '@nestjs/common';
import {
  GUARDS_METADATA,
  INTERCEPTORS_METADATA,
} from '@nestjs/common/constants';
import { AccountStatus } from '@prisma/client';
import type {
  ExecutionContext,
  INestApplication,
  StreamableFile,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import { OriginGuard } from '../auth/controller/origin.guard';
import { AuthConfig } from '../auth/auth.config';
import type { AuthenticatedRequest } from '../auth/controller/http-auth';
import { SessionGuard } from '../auth/controller/session.guard';
import { ProblemDetailFilter } from '../common/controller/problem-detail.filter';
import { UsersAuthorityService } from '../users/service/authority.service';
import { UsersAuthorityRepository } from '../users/repository/authority.repository';
import { MilestoneDocumentsRepository } from './repository/milestone-documents.repository';
import { DomainException } from '../common/error-code';
import {
  MilestoneDocumentFilesController,
  MilestoneDocumentsController,
} from './milestone-documents.controller';
import { MilestoneDocumentArchiveQueryRequestDto } from './dto/milestone-document-archive-query.dto';
import type { MilestoneDocumentArchive } from './milestone-document-archive.types';
import {
  MilestoneDocumentArchiveEntryError,
  MilestoneDocumentArchiveService,
} from './milestone-document-archive.service';
import { MilestoneDocumentFilesService } from './milestone-document-files.service';
import { MilestoneDocumentReviewsService } from './milestone-document-reviews.service';
import { MilestoneDocumentsService } from './milestone-documents.service';
import { MilestoneDocumentCollectionService } from './milestone-document-collection.service';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './domain/milestone-documents-error-code.enum';

let application: INestApplication | undefined;
let baseUrl = '';
const SESSION_GITHUB_ID = 342_900_002n;

const listForViewer = jest.fn().mockResolvedValue([
  {
    id: 'synthetic-document',
    milestoneId: 'synthetic-milestone',
    name: '개인정보 수집·이용 동의서',
    required: true,
    sortOrder: 1,
    hasTemplateFile: true,
    viewerSubmission: {
      submitted: true,
      submittedAt: '2026-09-16T14:22:00.000Z',
    },
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
const createDocument = jest.fn().mockResolvedValue({
  id: 'created-document',
  milestoneId: 'synthetic-milestone',
  name: '새 서류',
  required: true,
  sortOrder: 2,
  templateFileId: null,
  templateFileName: null,
});
const updateDocument = jest.fn().mockResolvedValue({
  id: 'synthetic-document',
  milestoneId: 'synthetic-milestone',
  name: '수정 서류',
  required: false,
  sortOrder: 1,
  templateFileId: null,
  templateFileName: null,
});
const reorderDocuments = jest.fn().mockResolvedValue([
  {
    id: 'synthetic-document',
    milestoneId: 'synthetic-milestone',
    name: '개인정보 수집·이용 동의서',
    required: true,
    sortOrder: 1,
    templateFileId: null,
    templateFileName: null,
  },
]);
const deleteDocument = jest.fn().mockResolvedValue(undefined);

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
const check = jest.fn().mockResolvedValue(undefined);

const ARCHIVE_FILE_NAME = '1차 중간산출물_2026-08-20.zip';
const ARCHIVE_BODY = 'zip-body';

const archiveForStaff = jest.fn((): Promise<MilestoneDocumentArchive> =>
  Promise.resolve({
    body: Readable.from(Buffer.from(ARCHIVE_BODY)),
    fileName: ARCHIVE_FILE_NAME,
    contentType: 'application/zip',
    contentLength: ARCHIVE_BODY.length,
  }),
);

const review = jest.fn().mockResolvedValue({
  id: 'synthetic-review',
  decision: 'CHANGES_REQUESTED',
  comment: '2쪽 서명이 빠졌습니다.',
  reviewedAt: '2026-09-18T09:00:00.000Z',
  resubmissionDueAt: '2026-09-25T09:00:00.000Z',
  reviewerNickname: 'synthetic-staff',
});

beforeEach(() => {
  listForViewer.mockClear();
  collectForStaff.mockClear();
  archiveForStaff.mockClear();
  submit.mockClear();
  createDocument.mockClear();
  updateDocument.mockClear();
  reorderDocuments.mockClear();
  deleteDocument.mockClear();
  uploadTemplate.mockClear();
  downloadTemplate.mockClear();
  downloadSubmissionFile.mockClear();
  upload.mockClear();
  check.mockClear();
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
        provide: MilestoneDocumentCollectionService,
        useValue: { collectForStaff },
      },
      {
        provide: MilestoneDocumentsService,
        useValue: {
          listForViewer,
          collectForStaff,
          submit,
          createDocument,
          updateDocument,
          reorderDocuments,
          deleteDocument,
        },
      },
      {
        provide: MilestoneDocumentFilesService,
        useValue: {
          uploadTemplate,
          downloadTemplate,
          downloadSubmissionFile,
          upload,
          check,
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

interface LegacyMutationRequest {
  readonly method: 'POST' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly body?: Record<string, unknown>;
}

const legacyMutationRequests: readonly LegacyMutationRequest[] = [
  {
    method: 'POST',
    path: '/documents',
    body: { name: '새 서류', required: true, sortOrder: 1 },
  },
  {
    method: 'PATCH',
    path: '/documents/synthetic-document',
    body: { name: '수정 서류', required: true, sortOrder: 1 },
  },
  {
    method: 'PATCH',
    path: '/documents/order',
    body: { documentIds: ['synthetic-document'] },
  },
  {
    method: 'DELETE',
    path: '/documents/synthetic-document',
  },
];

it('서류 목록은 브라우저·공유 캐시에 저장하지 않는다', async () => {
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents`,
  );

  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');

  await expect(response.json()).resolves.toMatchObject({
    documents: [
      { id: 'synthetic-document', viewerSubmission: { submitted: true } },
    ],
    fileUpload: {
      maxBytes: 5 * 1024 * 1024,
      maxLabel: '5 MB',
      accept: '.pdf,.hwp,.zip',
      formatLabel: 'PDF, HWP, ZIP',
    },
  });
  expect(listForViewer).toHaveBeenCalledWith(
    SESSION_GITHUB_ID,
    'synthetic-milestone',
  );
});

it('교직원은 legacy 서류 생성·수정·전체 순서 재부여·삭제를 HTTP로 수행한다', async () => {
  const createResponse = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({
        name: ' 새 서류 ',
        required: true,
        sortOrder: 99,
      }),
    },
  );
  expect(createResponse.status).toBe(201);
  await expect(createResponse.json()).resolves.toMatchObject({
    id: 'created-document',
    sortOrder: 2,
  });
  expect(createDocument.mock.calls).toEqual([
    [
      SESSION_GITHUB_ID,
      'synthetic-milestone',
      { name: '새 서류', required: true, sortOrder: 99 },
    ],
  ]);

  const updateResponse = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({
        name: '수정 서류',
        required: false,
        sortOrder: 100,
      }),
    },
  );
  expect(updateResponse.status).toBe(200);
  await expect(updateResponse.json()).resolves.toMatchObject({
    id: 'synthetic-document',
    required: false,
    sortOrder: 1,
  });
  expect(updateDocument.mock.calls).toEqual([
    [
      SESSION_GITHUB_ID,
      'synthetic-milestone',
      'synthetic-document',
      { name: '수정 서류', required: false, sortOrder: 100 },
    ],
  ]);

  const orderResponse = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/order`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({ documentIds: ['synthetic-document'] }),
    },
  );
  expect(orderResponse.status).toBe(200);
  await expect(orderResponse.json()).resolves.toMatchObject([
    { id: 'synthetic-document', sortOrder: 1 },
  ]);
  expect(reorderDocuments.mock.calls).toEqual([
    [SESSION_GITHUB_ID, 'synthetic-milestone', ['synthetic-document']],
  ]);

  const deleteResponse = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document`,
    { method: 'DELETE', headers: { origin: baseUrl } },
  );
  expect(deleteResponse.status).toBe(204);
  expect(deleteDocument.mock.calls).toEqual([
    [SESSION_GITHUB_ID, 'synthetic-milestone', 'synthetic-document'],
  ]);
});

it.each([
  [MilestoneDocumentsErrorCode.LAST_DOCUMENT_REQUIRED, deleteDocument],
  [MilestoneDocumentsErrorCode.DOCUMENT_HAS_SUBMISSIONS, deleteDocument],
  [MilestoneDocumentsErrorCode.INVALID_REQUEST, reorderDocuments],
] as const)(
  'surfaces legacy document safety code %s through HTTP',
  async (code, operation) => {
    operation.mockRejectedValueOnce(
      new DomainException(MILESTONE_DOCUMENTS_ERROR_CODES[code]),
    );
    const isOrder = code === MilestoneDocumentsErrorCode.INVALID_REQUEST;
    const response = await fetch(
      `${baseUrl}/api/v1/milestones/synthetic-milestone/documents${
        isOrder ? '/order' : '/synthetic-document'
      }`,
      {
        method: isOrder ? 'PATCH' : 'DELETE',
        headers: isOrder
          ? { 'content-type': 'application/json', origin: baseUrl }
          : { origin: baseUrl },
        body: isOrder
          ? JSON.stringify({ documentIds: ['synthetic-document'] })
          : undefined,
      },
    );
    expect(response.status).toBe(MILESTONE_DOCUMENTS_ERROR_CODES[code].status);
    await expect(response.json()).resolves.toMatchObject({ code });
  },
);

it('학생 서류 제출은 내용과 파일을 함께 서비스에 전달한다', async () => {
  const body = { content: { text: '본문', fileId: 'synthetic-file' } };

  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/submissions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

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
  const body = { content: { text: '본문' } };

  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/submissions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

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
  const body = new FormData();
  body.append(
    'file',
    new Blob([Buffer.from('%PDF-1.4\n%%EOF')], { type: 'application/pdf' }),
    'synthetic-template.pdf',
  );

  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/template`,
    { method: 'POST', body },
  );

  expect(response.status).toBe(201);
  await expect(response.json()).resolves.toMatchObject({
    hasTemplateFile: true,
  });
  expect(uploadTemplate).toHaveBeenCalledWith(
    SESSION_GITHUB_ID,
    'synthetic-milestone',
    'synthetic-document',
    expect.objectContaining({ originalname: 'synthetic-template.pdf' }),
  );
});

it('양식 다운로드("양식" 링크)는 attachment 스트림과 private no-store 헤더를 반환한다', async () => {
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/template`,
  );

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
  const body = new FormData();
  body.append('milestoneId', 'synthetic-milestone');
  body.append('documentId', 'synthetic-document');
  body.append(
    'file',
    new Blob([Buffer.from('%PDF-1.4\n%%EOF')], { type: 'application/pdf' }),
    'synthetic.pdf',
  );

  const response = await fetch(`${baseUrl}/api/v1/milestone-document-files`, {
    method: 'POST',
    body,
  });

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

it('/milestone-document-files/checks는 고른 파일만 판정에 넘기고 본문 없는 204로 끝난다', async () => {
  const body = new FormData();
  body.append(
    'file',
    new Blob([Buffer.from('PK\x03\x04')], { type: 'application/zip' }),
    'bundle.zip',
  );

  const response = await fetch(
    `${baseUrl}/api/v1/milestone-document-files/checks`,
    { method: 'POST', body },
  );

  expect(response.status).toBe(204);
  await expect(response.text()).resolves.toBe('');
  expect(check).toHaveBeenCalledWith(
    expect.objectContaining({
      originalname: 'bundle.zip',
      mimetype: 'application/zip',
    }),
  );
  expect(upload).not.toHaveBeenCalled();
});

it('서류 파일 판정은 업로드와 같은 세션+Origin 가드와 multipart 한도를 쓴다', () => {
  const metadata = (key: string, handler: 'check' | 'upload'): unknown =>
    Reflect.getMetadata(
      key,
      Object.getOwnPropertyDescriptor(
        MilestoneDocumentFilesController.prototype,
        handler,
      )?.value as object,
    );

  expect(metadata(GUARDS_METADATA, 'check')).toEqual([
    SessionGuard,
    OriginGuard,
  ]);
  expect(metadata(GUARDS_METADATA, 'check')).toEqual(
    metadata(GUARDS_METADATA, 'upload'),
  );
  expect(metadata(INTERCEPTORS_METADATA, 'check')).toHaveLength(1);
  expect(metadata(INTERCEPTORS_METADATA, 'check')).toEqual(
    metadata(INTERCEPTORS_METADATA, 'upload'),
  );
});

it('서류 수합 조회는 교직원 가드를 거치고 private no-store로 응답한다', async () => {
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/collection`,
  );

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

  expect(collectForStaff).toHaveBeenCalledWith(
    SESSION_GITHUB_ID,
    'synthetic-milestone',
    {
      page: 1,
      pageSize: 20,
      filter: 'ALL',
    },
  );
});

it('서류 수합 조회는 page·pageSize·filter를 숫자·enum으로 바꿔 서비스에 전달한다', async () => {
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/collection?page=2&pageSize=5&filter=HAS_MISSING`,
  );

  expect(response.status).toBe(200);
  expect(collectForStaff).toHaveBeenCalledWith(
    SESSION_GITHUB_ID,
    'synthetic-milestone',
    {
      page: 2,
      pageSize: 5,
      filter: 'HAS_MISSING',
    },
  );
});

it('범위를 벗어난 pageSize는 서비스 호출 전에 400으로 거절한다', async () => {
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/collection?pageSize=101`,
  );

  expect(response.status).toBe(400);
  expect(collectForStaff).not.toHaveBeenCalled();
});

it.each(['MISSING', 'LATE', 'COMPLETE', 'NO_REQUIRED_ITEMS'])(
  '서류 수합은 검토 상태와 별도의 제출 필터 %s를 전달한다',
  async (deliveryStatus) => {
    const response = await fetch(
      `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/collection?deliveryStatus=${deliveryStatus}`,
    );

    expect(response.status).toBe(200);
    expect(collectForStaff).toHaveBeenCalledWith(
      SESSION_GITHUB_ID,
      'synthetic-milestone',
      {
        page: 1,
        pageSize: 20,
        filter: 'ALL',
        deliveryStatus,
      },
    );
  },
);

it('검토 상태는 제출 필터 값으로 받지 않는다', async () => {
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/collection?deliveryStatus=REJECTED`,
  );

  expect(response.status).toBe(400);
  expect(collectForStaff).not.toHaveBeenCalled();
});

it('모르는 filter 값은 서비스 호출 전에 400으로 거절한다', async () => {
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/collection?filter=SOMETHING_ELSE`,
  );

  expect(response.status).toBe(400);
  expect(collectForStaff).not.toHaveBeenCalled();
});

it('서류 수합 조회 경로(collection)는 :documentId 경로로 잘못 잡히지 않는다', async () => {
  await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/collection`,
  );

  expect(collectForStaff).toHaveBeenCalledTimes(1);
  expect(downloadTemplate).not.toHaveBeenCalled();
});

it('제출 파일 다운로드는 다시 붙인 이름으로 attachment 스트림을 반환한다', async () => {
  const response = await fetch(
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/applications/synthetic-application/file`,
  );

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
    SESSION_GITHUB_ID,
    'synthetic-milestone',
    'synthetic-document',
    'synthetic-application',
  );
});

describe('교직원 서류 일괄 내려받기(ZIP)', () => {
  const archiveUrl = (query = ''): string =>
    `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/collection/archive${query}`;

  it('groupBy를 안 주면 팀별 묶기(TEAM)로 서비스를 부른다', async () => {
    const response = await fetch(archiveUrl());

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe(ARCHIVE_BODY);
    expect(archiveForStaff).toHaveBeenCalledWith(
      SESSION_GITHUB_ID,
      'synthetic-milestone',
      {
        kind: 'ALL',
        grouping: 'TEAM',
      },
    );
  });

  it('groupBy=DOCUMENT는 그대로 서비스에 전달한다', async () => {
    const response = await fetch(archiveUrl('?groupBy=DOCUMENT'));

    expect(response.status).toBe(200);
    expect(archiveForStaff).toHaveBeenCalledWith(
      SESSION_GITHUB_ID,
      'synthetic-milestone',
      {
        kind: 'ALL',
        grouping: 'DOCUMENT',
      },
    );
  });

  it('ZIP 응답은 application/zip · attachment · private no-store로 나간다', async () => {
    const response = await fetch(archiveUrl());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const disposition = response.headers.get('content-disposition') ?? '';
    expect(disposition).toContain('attachment');

    expect(disposition).toContain(
      `filename*=UTF-8''${encodeURIComponent(ARCHIVE_FILE_NAME)}`,
    );
    expect(disposition).toContain('.zip');
  });

  it('길이를 아는 ZIP은 Content-Length를 실어 보낸다', async () => {
    const response = await fetch(archiveUrl());

    expect(response.headers.get('content-length')).toBe(
      String(ARCHIVE_BODY.length),
    );
  });

  it('길이를 모르는 ZIP은 Content-Length를 아예 붙이지 않는다 — 청크 전송이다', async () => {
    archiveForStaff.mockResolvedValueOnce({
      body: Readable.from(Buffer.from(ARCHIVE_BODY)),
      fileName: ARCHIVE_FILE_NAME,
      contentType: 'application/zip',
      contentLength: null,
    });

    const response = await fetch(archiveUrl());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBeNull();
    expect(response.headers.get('content-type')).toBe('application/zip');
    await expect(response.text()).resolves.toBe(ARCHIVE_BODY);
  });

  it('일괄 내려받기 경로(collection/archive)는 :documentId 경로로 잘못 잡히지 않는다', async () => {
    await fetch(archiveUrl());

    expect(archiveForStaff).toHaveBeenCalledTimes(1);
    expect(collectForStaff).not.toHaveBeenCalled();
    expect(downloadTemplate).not.toHaveBeenCalled();
  });

  it.each([['TEAMS'], ['team'], ['']])(
    'groupBy가 %p이면 서비스 호출 전에 400으로 거절한다',
    async (groupBy) => {
      const response = await fetch(
        archiveUrl(`?groupBy=${encodeURIComponent(groupBy)}`),
      );

      expect(response.status).toBe(400);
      expect(archiveForStaff).not.toHaveBeenCalled();
    },
  );

  it('documentId를 주면 그 서류로 좁힌 범위로 서비스를 부른다', async () => {
    const response = await fetch(archiveUrl('?documentId=doc-plan'));

    expect(response.status).toBe(200);
    expect(archiveForStaff).toHaveBeenCalledWith(
      SESSION_GITHUB_ID,
      'synthetic-milestone',
      {
        kind: 'DOCUMENT',
        documentId: 'doc-plan',
      },
    );
  });

  it('documentId와 groupBy를 함께 주면 400으로 거절한다', async () => {
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
    const response = await fetch(archiveUrl('?groupBy=TEAM&groupBy=DOCUMENT'));

    expect(response.status).toBe(400);
    expect(archiveForStaff).not.toHaveBeenCalled();
  });

  it.each([
    ['page', 'page=2'],
    ['filter', 'filter=HAS_MISSING'],
  ])(
    '이 경로가 받지 않는 쿼리(%s)는 400으로 거절한다 — 필터·페이지는 계약에 없다',
    async (_name, query) => {
      const response = await fetch(archiveUrl(`?${query}`));

      expect(response.status).toBe(400);
      expect(archiveForStaff).not.toHaveBeenCalled();
    },
  );

  describe('압축 도중 실패', () => {
    const ARCHIVE_REQUEST_PATH =
      '/api/v1/milestones/synthetic-milestone/documents/collection/archive';
    const STORAGE_ERROR_MESSAGE =
      'synthetic-bucket 연결이 끊겼다 (secret-token-would-leak-here)';

    const FAILED_STORAGE_KEY =
      'submission-files/00000000-0000-4000-8000-000000000001';

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

    const documentScopeQuery = (): MilestoneDocumentArchiveQueryRequestDto =>
      Object.assign(new MilestoneDocumentArchiveQueryRequestDto(), {
        documentId: 'synthetic-document',
      });

    const streamArchive = (
      probe: ArchiveResponseProbe,
      query: MilestoneDocumentArchiveQueryRequestDto = new MilestoneDocumentArchiveQueryRequestDto(),
    ): Promise<StreamableFile> => {
      if (application === undefined) {
        throw new Error('테스트 애플리케이션이 아직 뜨지 않았다');
      }
      return application
        .get(MilestoneDocumentsController)
        .archive(
          { sessionGithubId: SESSION_GITHUB_ID },
          'synthetic-milestone',
          query,
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
      const probe = createArchiveResponseProbe();
      const streamable = await streamArchive(probe);
      expect(probe.headers.get('content-length')).toBe(
        String(ARCHIVE_BODY.length),
      );
      expect(probe.headers.has('content-disposition')).toBe(true);
      const nest = createNestStreamableProbe();

      streamable.errorHandler(new Error(STORAGE_ERROR_MESSAGE), nest.response);

      expect(probe.headers.has('content-length')).toBe(false);
      expect(probe.headers.has('content-disposition')).toBe(false);
      expect(probe.written.status).toBe(503);
      expect(probe.written.contentType).toBe('application/problem+json');
      expect(probe.written.body).toEqual({
        type: 'about:blank',
        title: 'Service Unavailable',
        status: 503,

        detail: '파일 저장소를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
        instance: ARCHIVE_REQUEST_PATH,
        code: 'MSD_012',
      });
    });

    it('오류 원문을 본문으로 내보내지 않는다 — Nest 기본 errorHandler로 되돌아가면 샌다', async () => {
      const probe = createArchiveResponseProbe();
      const streamable = await streamArchive(probe);
      const nest = createNestStreamableProbe();

      streamable.errorHandler(new Error(STORAGE_ERROR_MESSAGE), nest.response);

      expect(nest.sent).toEqual([]);
      expect(nest.response.statusCode).toBe(200);
      expect(JSON.stringify(probe.written.body)).not.toContain(
        STORAGE_ERROR_MESSAGE,
      );
      expect(probe.written.status).not.toBe(400);
    });

    it('헤더가 이미 나갔으면 본문을 새로 쓰지 않고 끊는다', async () => {
      const probe = createArchiveResponseProbe({ headersSent: true });
      const streamable = await streamArchive(probe);
      const nest = createNestStreamableProbe();

      streamable.errorHandler(new Error(STORAGE_ERROR_MESSAGE), nest.response);

      expect(probe.written.ended).toBe(true);
      expect(probe.written.status).toBeUndefined();
      expect(probe.written.body).toBeUndefined();

      expect(probe.headers.has('content-disposition')).toBe(true);
    });

    it('응답이 이미 파괴됐으면 아무것도 하지 않는다', async () => {
      const probe = createArchiveResponseProbe({
        destroyed: true,
        headersSent: true,
      });
      const streamable = await streamArchive(probe);
      const nest = createNestStreamableProbe();

      streamable.errorHandler(new Error(STORAGE_ERROR_MESSAGE), nest.response);

      expect(probe.written.ended).toBe(false);
      expect(probe.written.status).toBeUndefined();
      expect(probe.written.body).toBeUndefined();
    });

    it('실패는 서버 로그에 남긴다 — 「받다가 멈췄다」 신고에 맞댈 근거가 된다', async () => {
      const probe = createArchiveResponseProbe({ destroyed: true });
      const streamable = await streamArchive(probe);
      const nest = createNestStreamableProbe();

      streamable.errorHandler(new Error(STORAGE_ERROR_MESSAGE), nest.response);

      expect(loggedErrors).toHaveLength(1);
      expect(String(loggedErrors[0])).toContain(STORAGE_ERROR_MESSAGE);
    });

    it('헤더가 나간 뒤의 실패 한 줄에 마일스톤·요청 범위·끊긴 항목이 함께 남는다', async () => {
      const probe = createArchiveResponseProbe({ headersSent: true });
      const streamable = await streamArchive(probe);
      const nest = createNestStreamableProbe();

      streamable.errorHandler(
        new MilestoneDocumentArchiveEntryError(
          FAILED_STORAGE_KEY,
          new Error('SUBMISSION_FILE_STORAGE_GET_FAILED'),
        ),
        nest.response,
      );

      expect(loggedErrors).toHaveLength(1);
      const line = String(loggedErrors[0]);
      expect(line).toContain('milestoneId=synthetic-milestone');
      expect(line).toContain('scope=ALL');
      expect(line).toContain(`storageKey=${FAILED_STORAGE_KEY}`);
      expect(line).toContain('SUBMISSION_FILE_STORAGE_GET_FAILED');
    });

    it('서류 한 종류만 받는 요청은 로그에서 전체 내려받기와 구분된다', async () => {
      const probe = createArchiveResponseProbe({ headersSent: true });
      const streamable = await streamArchive(probe, documentScopeQuery());
      const nest = createNestStreamableProbe();

      streamable.errorHandler(
        new MilestoneDocumentArchiveEntryError(
          FAILED_STORAGE_KEY,
          new Error('SUBMISSION_FILE_STORAGE_GET_FAILED'),
        ),
        nest.response,
      );

      expect(String(loggedErrors[0])).toContain('scope=DOCUMENT');
    });

    it('성공한 일괄 내려받기에서는 이 실패 로그가 남지 않는다', async () => {
      const response = await fetch(archiveUrl());

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe(ARCHIVE_BODY);
      expect(loggedErrors).toEqual([]);
    });

    it('응답이 close를 내면 압축 스트림을 파괴한다 — 취소해도 서버가 계속 끌어오면 안 된다', async () => {
      const body = Readable.from(Buffer.from(ARCHIVE_BODY));
      const destroy = jest.spyOn(body, 'destroy');
      archiveForStaff.mockResolvedValueOnce({
        body,
        fileName: ARCHIVE_FILE_NAME,
        contentType: 'application/zip',
        contentLength: ARCHIVE_BODY.length,
      });
      const probe = createArchiveResponseProbe();

      await streamArchive(probe);

      expect(probe.closeListeners).toHaveLength(1);
      expect(destroy).not.toHaveBeenCalled();

      for (const listener of probe.closeListeners) listener();

      expect(destroy).toHaveBeenCalledTimes(1);
    });
  });
});

describe('교직원 서류 제출물 판정', () => {
  const seenVersion = {
    expectedRevision: 3,
    expectedLatestReviewId: null,
  };

  const resubmissionDueAt = '2026-09-25T09:00:00.000Z';

  it('판정은 201로 끝나고 판정자 nickname까지 실어 돌려준다', async () => {
    const body = {
      decision: 'CHANGES_REQUESTED',
      comment: '2쪽 서명이 빠졌습니다.',
      resubmissionDueAt,
      ...seenVersion,
    };

    const response = await fetch(
      `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/applications/synthetic-application/reviews`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      id: 'synthetic-review',
      decision: 'CHANGES_REQUESTED',
      comment: '2쪽 서명이 빠졌습니다.',
      reviewedAt: '2026-09-18T09:00:00.000Z',
      resubmissionDueAt: '2026-09-25T09:00:00.000Z',
      reviewerNickname: 'synthetic-staff',
    });

    expect(review).toHaveBeenCalledWith(
      SESSION_GITHUB_ID,
      'synthetic-milestone',
      'synthetic-document',
      'synthetic-application',
      {
        decision: 'CHANGES_REQUESTED',
        comment: '2쪽 서명이 빠졌습니다.',

        resubmissionDueAt: new Date(resubmissionDueAt),

        expectedRevision: 3,
        expectedLatestReviewId: null,
      },
    );
  });

  it('승인은 사유 없이도 통과하고 comment는 null로 정규화된다', async () => {
    const body = { decision: 'APPROVED', ...seenVersion };

    const response = await fetch(
      `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/applications/synthetic-application/reviews`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    expect(response.status).toBe(201);
    expect(review).toHaveBeenCalledWith(
      SESSION_GITHUB_ID,
      'synthetic-milestone',
      'synthetic-document',
      'synthetic-application',
      {
        decision: 'APPROVED',
        comment: null,

        resubmissionDueAt: null,
        expectedRevision: 3,
        expectedLatestReviewId: null,
      },
    );
  });

  it('보완 요청에 사유가 없으면 서비스 호출 전에 422로 거절한다', async () => {
    const body = {
      decision: 'CHANGES_REQUESTED',
      resubmissionDueAt,
      ...seenVersion,
    };

    const response = await fetch(
      `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/applications/synthetic-application/reviews`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: 'MSD_021' });
    expect(review).not.toHaveBeenCalled();
  });

  it('반려 사유가 공백뿐이면 422로 거절한다 — 학생 화면에 빈 사유가 남지 않게 한다', async () => {
    const body = { decision: 'REJECTED', comment: '   ', ...seenVersion };

    const response = await fetch(
      `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/applications/synthetic-application/reviews`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: 'MSD_021' });
    expect(review).not.toHaveBeenCalled();
  });

  it('보완 요청에 재제출 기한이 없으면 서비스 호출 전에 422로 거절한다', async () => {
    const body = {
      decision: 'CHANGES_REQUESTED',
      comment: '2쪽 서명이 빠졌습니다.',
      ...seenVersion,
    };

    const response = await fetch(
      `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/applications/synthetic-application/reviews`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: 'MSD_032' });
    expect(review).not.toHaveBeenCalled();
  });

  it('반려에 실려 온 기한은 서비스로 넘기지 않는다', async () => {
    const body = {
      decision: 'REJECTED',
      comment: '기한을 넘겼습니다.',
      resubmissionDueAt,
      ...seenVersion,
    };

    const response = await fetch(
      `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/applications/synthetic-application/reviews`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    expect(response.status).toBe(201);
    expect(review).toHaveBeenCalledWith(
      SESSION_GITHUB_ID,
      'synthetic-milestone',
      'synthetic-document',
      'synthetic-application',
      {
        decision: 'REJECTED',
        comment: '기한을 넘겼습니다.',
        resubmissionDueAt: null,
        expectedRevision: 3,
        expectedLatestReviewId: null,
      },
    );
  });

  it('알 수 없는 decision은 400으로 거절한다', async () => {
    const body = { decision: 'MAYBE', comment: '음', ...seenVersion };

    const response = await fetch(
      `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/applications/synthetic-application/reviews`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    expect(response.status).toBe(400);
    expect(review).not.toHaveBeenCalled();
  });

  it.each([
    ['expectedRevision', { expectedLatestReviewId: null }],
    ['expectedLatestReviewId', { expectedRevision: 3 }],
  ])(
    '%s를 빼먹은 요청은 400으로 막는다 — 기대 버전 없이 판정이 통과하면 검사가 없는 것과 같다',
    async (_field, partialVersion) => {
      const body = {
        decision: 'APPROVED',
        ...partialVersion,
      };

      const response = await fetch(
        `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/applications/synthetic-application/reviews`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

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
      const body = {
        decision: 'APPROVED',
        expectedRevision,
        expectedLatestReviewId: null,
      };

      const response = await fetch(
        `${baseUrl}/api/v1/milestones/synthetic-milestone/documents/synthetic-document/applications/synthetic-application/reviews`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

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

describe('legacy mutation route HTTP guard rejections', () => {
  let guardedApplication: INestApplication | undefined;
  let guardedBaseUrl = '';
  let sessionGithubId = SESSION_GITHUB_ID;
  const studentGithubId = SESSION_GITHUB_ID + 1n;
  const rejectedStaffGithubId = SESSION_GITHUB_ID + 2n;
  const allowedOrigin = 'https://jnu-oss-hub.com';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MilestoneDocumentsController],
      providers: [
        MilestoneDocumentsService,
        { provide: MilestoneDocumentsRepository, useValue: {} },
        { provide: MilestoneDocumentFilesService, useValue: {} },
        { provide: MilestoneDocumentReviewsService, useValue: {} },
        { provide: MilestoneDocumentArchiveService, useValue: {} },
        { provide: MilestoneDocumentCollectionService, useValue: {} },
        UsersAuthorityService,
        OriginGuard,
        { provide: AuthConfig, useValue: { allowedOrigin } },
        {
          provide: UsersAuthorityRepository,
          useValue: {
            findActorByGithubId: (githubId: bigint) =>
              Promise.resolve(
                githubId === SESSION_GITHUB_ID
                  ? {
                      id: 'synthetic-staff',
                      hasStaffAccess: true,
                      hasAdminAccess: false,
                      accountStatus: AccountStatus.ACTIVE,
                    }
                  : githubId === studentGithubId
                    ? {
                        id: 'synthetic-student',
                        hasStaffAccess: false,
                        hasAdminAccess: false,
                        accountStatus: AccountStatus.ACTIVE,
                      }
                    : {
                        id: 'inactive-staff',
                        hasStaffAccess: true,
                        hasAdminAccess: false,
                        accountStatus: AccountStatus.DEACTIVATED,
                      },
              ),
          },
        },
      ],
    })
      .overrideGuard(SessionGuard)
      .useValue({
        canActivate: (context: ExecutionContext): boolean => {
          context
            .switchToHttp()
            .getRequest<AuthenticatedRequest>().sessionGithubId =
            sessionGithubId;
          return true;
        },
      })
      .compile();

    guardedApplication = moduleRef.createNestApplication();
    guardedApplication.setGlobalPrefix('api/v1');
    guardedApplication.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    guardedApplication.useGlobalFilters(new ProblemDetailFilter());
    await guardedApplication.listen(0, '127.0.0.1');
    guardedBaseUrl = await guardedApplication.getUrl();
  });

  afterAll(async () => {
    await guardedApplication?.close();
  });

  beforeEach(() => {
    createDocument.mockClear();
    updateDocument.mockClear();
    reorderDocuments.mockClear();
    deleteDocument.mockClear();
  });

  it.each([
    ['active student without staff/admin access', studentGithubId],
    ['deactivated staff account despite staff access', rejectedStaffGithubId],
  ] as const)(
    'rejects %s on every legacy mutation route before the writer',
    async (_state, githubId) => {
      sessionGithubId = githubId;
      await assertRejectedLegacyMutations(guardedBaseUrl, {
        origin: allowedOrigin,
      });
    },
  );

  it.each([{}, { origin: 'https://attacker.example' }] as const)(
    'rejects missing or foreign origin evidence on every legacy mutation route',
    async (headers) => {
      sessionGithubId = SESSION_GITHUB_ID;
      await assertRejectedLegacyMutations(guardedBaseUrl, headers);
    },
  );

  async function assertRejectedLegacyMutations(
    applicationUrl: string,
    headers: Readonly<Record<string, string | undefined>>,
  ): Promise<void> {
    for (const request of legacyMutationRequests) {
      const response = await fetch(
        `${applicationUrl}/api/v1/milestones/synthetic-milestone${request.path}`,
        {
          method: request.method,
          headers: {
            ...definedHeaders(headers),
            ...(request.body === undefined
              ? {}
              : { 'content-type': 'application/json' }),
          },
          body:
            request.body === undefined
              ? undefined
              : JSON.stringify(request.body),
        },
      );
      expect(response.status).toBe(403);
      if (headers.origin === allowedOrigin)
        await expect(response.json()).resolves.toEqual({
          type: 'about:blank',
          title: 'FORBIDDEN',
          status: 403,
          detail:
            MILESTONE_DOCUMENTS_ERROR_CODES[
              MilestoneDocumentsErrorCode.STAFF_ONLY
            ].message,
          instance: `/api/v1/milestones/synthetic-milestone${request.path}`,
          code: 'MSD_001',
        });
    }
    expect(createDocument.mock.calls).toHaveLength(0);
    expect(updateDocument.mock.calls).toHaveLength(0);
    expect(reorderDocuments.mock.calls).toHaveLength(0);
    expect(deleteDocument.mock.calls).toHaveLength(0);
  }
});

function definedHeaders(
  headers: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) result[name] = value;
  }
  return result;
}

describe('교직원 전용 endpoint의 가드 구성', () => {
  it.each(['create', 'update', 'reorder', 'remove', 'uploadTemplate'])(
    'legacy writer %s keeps SessionGuard + OriginGuard',
    (handler) => {
      expect(readHandlerGuards(handler)).toEqual([SessionGuard, OriginGuard]);
    },
  );

  it('서류 수합 조회는 SessionGuard만 붙인다', () => {
    const guards = readHandlerGuards('collection');

    expect(guards).toEqual([SessionGuard]);
  });

  it('서류 일괄 내려받기는 SessionGuard만 붙인다', () => {
    const guards = readHandlerGuards('archive');

    expect(guards).toEqual([SessionGuard]);
  });

  it('제출 파일 다운로드는 SessionGuard만 붙인다', () => {
    const guards = readHandlerGuards('downloadSubmissionFile');

    expect(guards).toEqual([SessionGuard]);
  });

  it('제출물 판정은 SessionGuard + OriginGuard를 붙인다', () => {
    const guards = readHandlerGuards('review');

    expect(guards).toEqual([SessionGuard, OriginGuard]);
  });
});
