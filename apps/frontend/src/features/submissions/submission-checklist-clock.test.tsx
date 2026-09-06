// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { getSubmissionChecklist } from './api';
import { SubmissionChecklistPage } from './submission-checklist-page';

vi.mock('./api', () => ({ getSubmissionChecklist: vi.fn() }));

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

it('아무 조작 없이 마감을 지나면 최초 제출만 닫고 재제출은 열어 둔다', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-24T03:00:00Z'));
  vi.mocked(getSubmissionChecklist).mockResolvedValue({
    applicationId: 'application-clock',
    applicationMode: 'PERSONAL',
    items: [
      {
        milestoneId: 'initial-clock',
        name: 'Initial',
        dueAt: '2026-07-24T03:00:00Z',
        submissionType: 'TEXT',
        submission: null,
      },
      {
        milestoneId: 'revision-clock',
        name: 'Revision',
        dueAt: '2026-07-24T03:00:00Z',
        submissionType: 'TEXT',
        submission: {
          id: 'submission-clock',
          status: 'CHANGES_REQUESTED',
          currentRevision: 1,
          decision: 'CHANGES_REQUESTED',
          lastReviewedAt: null,
          reviewComment: null,
          canResubmit: true,
          file: null,
        },
      },
    ],
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <SubmissionChecklistPage
          programId="program-clock"
          milestoneId={null}
        />,
      );
    });
    expect(
      container.querySelector('#submission-trigger-initial-clock')?.tagName,
    ).toBe('A');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(
      container.querySelector('#submission-trigger-initial-clock'),
    ).toHaveProperty('disabled', true);
    expect(
      container.querySelector('#submission-trigger-revision-clock')?.tagName,
    ).toBe('A');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  }
});
