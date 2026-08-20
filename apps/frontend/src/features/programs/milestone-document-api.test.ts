import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import {
  listMilestoneDocuments,
  milestoneDocumentTemplateHref,
  reorderMilestoneDocuments,
  submitMilestoneDocument,
  uploadMilestoneDocumentFile,
  uploadMilestoneDocumentTemplate,
} from './milestone-document-api';
import type { MilestoneDocument } from './milestone-document-api';

const document: MilestoneDocument = {
  id: 'document-1',
  milestoneId: 'milestone-1',
  name: '기획서',
  required: true,
  sortOrder: 0,
  submissionType: 'FILE',
  hasTemplateFile: false,
  templateFileName: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('listMilestoneDocuments', () => {
  it('milestoneId 경로로 서류 목록을 조회한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([document]));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listMilestoneDocuments('milestone-1')).resolves.toEqual([
      document,
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('milestones/milestone-1/documents'),
      undefined,
    );
  });
});

/**
 * 순서 바꾸기는 항목별 PATCH가 아니라 고정 세그먼트 `order`로 **한 번** 나간다.
 * 항목별 PATCH 두 건으로 되돌리면 한쪽만 성공했을 때 sortOrder가 같아져 그 뒤로
 * 순서를 못 바꾸는 상태가 된다(백엔드 `reorder-milestone-documents-request.dto.ts`).
 */
describe('reorderMilestoneDocuments', () => {
  it('전체 id 목록을 order 경로에 한 번 PATCH한다', async () => {
    const reordered = [
      { ...document, id: 'document-2', sortOrder: 1 },
      { ...document, sortOrder: 2 },
    ];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(reordered));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      reorderMilestoneDocuments('milestone-1', ['document-2', 'document-1']),
    ).resolves.toEqual(reordered);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('milestones/milestone-1/documents/order'),
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentIds: ['document-2', 'document-1'] }),
      },
    );
  });
});

describe('uploadMilestoneDocumentFile', () => {
  it('milestoneId/documentId/file을 FormData로 담아 업로드한다', async () => {
    const uploaded = {
      fileId: 'file-1',
      fileName: 'plan.pdf',
      contentType: 'application/pdf',
      size: 1024,
      expiresAt: '2026-08-10T00:00:00.000Z',
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(uploaded));
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['content'], 'plan.pdf', {
      type: 'application/pdf',
    });
    await expect(
      uploadMilestoneDocumentFile('milestone-1', 'document-1', file),
    ).resolves.toEqual(uploaded);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [calledPath, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledPath).toBe(apiPath('milestone-document-files'));
    expect(init.method).toBe('POST');
    const body = init.body as FormData;
    expect(body.get('milestoneId')).toBe('milestone-1');
    expect(body.get('documentId')).toBe('document-1');
    expect(body.get('file')).toBe(file);
  });
});

describe('submitMilestoneDocument', () => {
  it('content를 JSON body로 감싸 제출 endpoint에 POST한다', async () => {
    const submission = {
      id: 'submission-1',
      status: 'SUBMITTED',
      submittedAt: '2026-08-10T00:00:00.000Z',
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(submission));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      submitMilestoneDocument('milestone-1', 'document-1', {
        type: 'FILE',
        fileId: 'file-1',
      }),
    ).resolves.toEqual(submission);

    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('milestones/milestone-1/documents/document-1/submissions'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: { type: 'FILE', fileId: 'file-1' } }),
      },
    );
  });
});

describe('uploadMilestoneDocumentTemplate', () => {
  it('양식 파일을 FormData로 담아 template endpoint에 POST한다', async () => {
    const uploaded = {
      documentId: 'document-1',
      hasTemplateFile: true,
      templateFileName: null,

      fileName: 'template.docx',
      uploadedAt: '2026-08-10T00:00:00.000Z',
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(uploaded));
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['content'], 'template.docx');
    await expect(
      uploadMilestoneDocumentTemplate('milestone-1', 'document-1', file),
    ).resolves.toEqual(uploaded);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [calledPath, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledPath).toBe(
      apiPath('milestones/milestone-1/documents/document-1/template'),
    );
    expect(init.method).toBe('POST');
    expect((init.body as FormData).get('file')).toBe(file);
  });
});

describe('milestoneDocumentTemplateHref', () => {
  it('apiPath를 통해 다운로드 경로 문자열을 만든다', () => {
    expect(milestoneDocumentTemplateHref('milestone-1', 'document-1')).toBe(
      apiPath('milestones/milestone-1/documents/document-1/template'),
    );
  });
});
