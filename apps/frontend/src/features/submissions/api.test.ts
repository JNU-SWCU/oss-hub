import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import {
  createResubmission,
  createSubmission,
  getSubmissionChecklist,
  getSubmissionForm,
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
});
