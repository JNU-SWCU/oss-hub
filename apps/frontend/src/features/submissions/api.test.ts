import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import { createSubmission, getSubmissionForm } from './api';

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
});
