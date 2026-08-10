import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import {
  createResubmission,
  createSubmission,
  downloadMilestoneDocumentCurrentFile,
  getSubmissionChecklist,
  getSubmissionForm,
  getSubmissionMatrix,
  listMilestoneDocumentCurrentFiles,
  uploadSubmissionFile,
} from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(value: unknown, status = 201): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('submissions api', () => {
  it('마일스톤 서류 목록과 현재 파일 endpoint에서 식별자를 모두 인코딩한다', async () => {
    // Given
    const listResponse = jsonResponse([], 200);
    const fileResponse = new Response('current', {
      status: 200,
      headers: {
        'Content-Disposition':
          'attachment; filename="current.pdf"; filename*=UTF-8\'\'current.pdf',
      },
    });
    const request = vi
      .fn()
      .mockResolvedValueOnce(listResponse)
      .mockResolvedValueOnce(fileResponse);
    vi.stubGlobal('fetch', request);

    // When
    await listMilestoneDocumentCurrentFiles('milestone/1');
    await downloadMilestoneDocumentCurrentFile('milestone/1', 'document/1');

    // Then
    expect(request).toHaveBeenNthCalledWith(
      1,
      apiPath('milestones/milestone%2F1/documents'),
      undefined,
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      apiPath(
        'milestones/milestone%2F1/documents/document%2F1/submissions/current/file',
      ),
      undefined,
    );
  });

  it('파일과 식별자를 FormData로 보내고 Content-Type을 직접 설정하지 않는다', async () => {
    const uploaded = {
      fileId: 'file-1',
      fileName: 'report.pdf',
      contentType: 'application/pdf',
      size: 3,
      expiresAt: '2026-12-31T00:00:00.000Z',
    };
    const request = vi.fn().mockResolvedValue(jsonResponse(uploaded));
    vi.stubGlobal('fetch', request);
    const file = new File(['pdf'], 'report.pdf', { type: 'application/pdf' });

    const result = await uploadSubmissionFile(
      'application-1',
      'milestone-1',
      file,
    );

    expect(result).toEqual(uploaded);
    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(apiPath('submission-files'));
    expect(init.method).toBe('POST');
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
    const body = init.body as FormData;
    expect(body.get('applicationId')).toBe('application-1');
    expect(body.get('milestoneId')).toBe('milestone-1');
    expect(body.get('file')).toBe(file);
  });

  it('file resubmission upload context is sent as FormData fields', async () => {
    // Given
    const uploaded = {
      fileId: 'file-2',
      fileName: 'replacement.pdf',
      contentType: 'application/pdf',
      size: 3,
      expiresAt: '2026-12-31T00:00:00.000Z',
    };
    const request = vi.fn().mockResolvedValue(jsonResponse(uploaded));
    vi.stubGlobal('fetch', request);
    const file = new File(['pdf'], 'replacement.pdf', {
      type: 'application/pdf',
    });

    // When
    const result = await uploadSubmissionFile(
      'application-1',
      'milestone-1',
      file,
      { submissionId: 'submission-1', baseRevision: 3 },
    );

    // Then
    expect(result).toEqual(uploaded);
    const init = request.mock.calls[0]?.[1];
    expect(init?.headers).toBeUndefined();
    expect(init?.body).toBeInstanceOf(FormData);
    if (!(init?.body instanceof FormData)) {
      throw new Error('expected FormData body');
    }
    expect(init.body.get('applicationId')).toBe('application-1');
    expect(init.body.get('milestoneId')).toBe('milestone-1');
    expect(init.body.get('submissionId')).toBe('submission-1');
    expect(init.body.get('baseRevision')).toBe('3');
    expect(init.body.get('file')).toBe(file);
  });
  it('program과 milestone 식별자를 인코딩해 폼을 조회한다', async () => {
    // Given
    const response = {
      applicationId: 'application-1',
      applicationMode: 'PERSONAL',
      milestone: {
        id: 'milestone/1',
        name: '최종 제출',
        dueAt: '2026-09-30T14:59:59.000Z',
        dDay: 69,
        deadlineLabel: 'D-69',
        submissionType: 'TEXT',
        instructions: null,
      },
      repository: null,
      existingSubmission: null,
      canSubmit: true,
      blockedReason: null,
    };
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', request);

    // When
    const result = await getSubmissionForm('program/1', 'milestone/1');

    // Then
    expect(result).toEqual(response);
    expect(request).toHaveBeenCalledWith(
      apiPath('programs/program%2F1/milestones/milestone%2F1/submission-form'),
      undefined,
    );
  });

  it('최초 제출 계약을 JSON body로 전송한다', async () => {
    // Given
    const created = {
      submissionId: 'submission-1',
      status: 'SUBMITTED',
      submittedAt: '2026-07-23T00:00:00.000Z',
    };
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(created), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', request);
    const input = {
      applicationId: 'application-1',
      milestoneId: 'milestone-1',
      content: { type: 'TEXT' as const, text: '합성 제출 내용' },
      comment: '합성 코멘트',
    };

    // When
    const result = await createSubmission(input);

    // Then
    expect(result).toEqual(created);
    expect(request).toHaveBeenCalledWith(apiPath('submissions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  });

  it('program 식별자를 인코딩해 내 체크리스트를 조회한다', async () => {
    // Given
    const checklist = {
      applicationId: 'application-personal',
      applicationMode: 'PERSONAL',
      items: [
        {
          milestoneId: 'milestone-1',
          name: '중간 보고',
          dueAt: '2026-09-01T14:59:59.000Z',
          submissionType: 'TEXT',
          submission: null,
        },
      ],
    };
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(checklist), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', request);

    // When
    const result = await getSubmissionChecklist('program/1');

    // Then
    expect(result).toEqual(checklist);
    expect(request).toHaveBeenCalledWith(
      apiPath('programs/program%2F1/submissions/me'),
      undefined,
    );
  });

  it('재제출은 baseRevision을 body에 담아 resubmissions로 보낸다', async () => {
    // Given
    const created = {
      submissionId: 'submission/1',
      revision: 2,
      status: 'SUBMITTED',
    };
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(created), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', request);

    // When
    const result = await createResubmission({
      submissionId: 'submission/1',
      baseRevision: 1,
      content: { type: 'TEXT', text: '실행 화면을 추가했습니다' },
      comment: '보완 완료',
    });

    // Then: submissionId는 URL로만, baseRevision·content·comment는 body로.
    expect(result).toEqual(created);
    expect(request).toHaveBeenCalledWith(
      apiPath('submissions/submission%2F1/resubmissions'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseRevision: 1,
          content: { type: 'TEXT', text: '실행 화면을 추가했습니다' },
          comment: '보완 완료',
        }),
      },
    );
  });

  it('매트릭스 조회는 programId를 인코딩하고 #124 query 계약대로 직렬화한다', async () => {
    // Given
    const page = {
      milestones: [],
      rows: [],
      page: 2,
      pageSize: 20,
      total: 0,
    };
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(page), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', request);

    // When
    const result = await getSubmissionMatrix('program/1', {
      q: ' 홍길동 ',
      page: 2,
      pageSize: 20,
    });

    // Then
    expect(result).toEqual(page);
    const expectedQuery = new URLSearchParams({
      q: '홍길동',
      page: '2',
      pageSize: '20',
    });
    expect(request).toHaveBeenCalledWith(
      apiPath(`programs/program%2F1/submissions/matrix?${expectedQuery}`),
      undefined,
    );
  });

  it('매트릭스 조회에서 빈 검색어는 query에 넣지 않는다', async () => {
    // Given
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          milestones: [],
          rows: [],
          page: 1,
          pageSize: 20,
          total: 0,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', request);

    // When
    await getSubmissionMatrix('program-1', {
      q: '  ',
      page: 1,
      pageSize: 20,
    });

    // Then
    expect(request).toHaveBeenCalledWith(
      apiPath('programs/program-1/submissions/matrix?page=1&pageSize=20'),
      undefined,
    );
  });
});
