import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { notifyManager, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '../../../../test-support/render-with-query';
import { requirementUploadPolicy } from '../../../../test-support/requirement-upload-policy';
import { requirementsKey } from '@/lib/query-keys';
import { RequirementSection } from './requirement-list';
import { SubmissionForm } from './submission-form';
import type { Requirement } from './requirement-dto';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});
afterEach(() => {
  vi.unstubAllGlobals();
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
});

it.each([
  ['FILE', false, true],
  ['TEXT', true, false],
  ['FILE_OR_TEXT', true, true],
] as const)(
  '%s offers only its permitted content inputs and an optional comment',
  async (submissionType, text, file) => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <SubmissionForm
            documentId="requirement"
            documentName="결과"
            submissionType={submissionType}
            fileUpload={requirementUploadPolicy()}
            currentFileName={null}
            submitting={false}
            onCancel={vi.fn()}
            onSubmit={vi.fn()}
          />,
        ),
      );
      expect(
        container.querySelector('#requirement-submission-text') !== null,
      ).toBe(text);
      expect(container.querySelector('input[type=file]') !== null).toBe(file);
      expect(
        container.querySelector('#requirement-submission-comment'),
      ).toHaveProperty('required', false);
      expect(container.querySelector('button[type=submit]')).toHaveProperty(
        'disabled',
        true,
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);

it('keeps the revision observed when editing and reloads after a concurrent submission', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const queryClient = createTestQueryClient();
  notifyManager.setScheduler(queueMicrotask);
  let current: Requirement = {
    id: 'document',
    milestoneId: 'milestone',
    name: '활동 기록',
    required: true,
    submissionType: 'TEXT',
    sortOrder: 0,
    hasTemplateFile: false,
    templateFileName: null,
    viewerSubmission: {
      submitted: true,
      submittedAt: '2026-08-01T00:00:00Z',
      revision: 3,
      status: 'SUBMITTED',
      hasCurrentFile: false,
      currentFileName: null,
      review: null,
      history: { hasHistory: false, isComplete: true },
    },
  };
  const payload = () => ({
    documents: [current],
    fileUpload: requirementUploadPolicy(),
  });
  const writes: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        if (typeof init.body !== 'string')
          throw new TypeError('Expected submission JSON');
        writes.push(JSON.parse(init.body));
        return new Response(
          JSON.stringify({
            type: 'about:blank',
            title: 'Conflict',
            status: 409,
            code: 'MSD_048',
            detail: '최신 제출본을 확인해 주세요.',
            instance: '/synthetic',
          }),
          {
            status: 409,
            headers: { 'Content-Type': 'application/problem+json' },
          },
        );
      }
      return new Response(JSON.stringify(payload()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  function editButton() {
    const button = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === '수정',
    );
    if (button === undefined) throw new TypeError('Missing edit button');
    return button;
  }
  async function fill(selector: string, value: string) {
    const element = container.querySelector(selector);
    if (!(element instanceof HTMLTextAreaElement))
      throw new TypeError('Missing content input');
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <RequirementSection
            programId="program"
            milestoneId="milestone"
            viewerRole="STUDENT"
            closed={false}
            submissionAccess={{ kind: 'open' }}
          />
        </QueryClientProvider>,
      ),
    );
    await act(async () => editButton().click());
    await fill('#document-submission-text', '새 활동 내용');
    await fill('#document-submission-comment', '  선택 의견  ');
    const viewer = current.viewerSubmission;
    if (viewer === undefined) throw new TypeError('Missing viewer');
    current = { ...current, viewerSubmission: { ...viewer, revision: 4 } };
    await act(async () => {
      queryClient.setQueryData(
        requirementsKey('program', 'milestone', 'all'),
        payload(),
      );
    });
    const form = container.querySelector('form');
    if (form === null) throw new TypeError('Missing submission form');
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    });
    expect(writes).toEqual([
      {
        content: { text: '새 활동 내용', fileId: null },
        expectedRevision: 3,
        comment: '선택 의견',
      },
    ]);
    expect(container.textContent).toContain('방금 제출은 저장되지 않았습니다');
    expect(container.querySelector('form')).toBeNull();
    expect(editButton().disabled).toBe(false);
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
  }
});
