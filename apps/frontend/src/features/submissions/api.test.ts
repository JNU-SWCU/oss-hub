import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import {
  createSubmission,
  getSubmissionForm,
  getSubmissionMatrix,
} from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('submissions api', () => {
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
      mode: 'TEAM',
      page: 2,
      pageSize: 20,
    });

    // Then
    expect(result).toEqual(page);
    const expectedQuery = new URLSearchParams({
      q: '홍길동',
      applicationMode: 'TEAM',
      page: '2',
      pageSize: '20',
    });
    expect(request).toHaveBeenCalledWith(
      apiPath(`programs/program%2F1/submissions/matrix?${expectedQuery}`),
      undefined,
    );
  });

  it('매트릭스 조회에서 빈 검색어와 ALL 형태는 query에 넣지 않는다', async () => {
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
      mode: 'ALL',
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
