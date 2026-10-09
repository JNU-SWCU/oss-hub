import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { milestoneDocumentUploadPolicy } from '../../../test-support/milestone-document-upload-policy';
import {
  MilestoneDocumentSection,
  MilestoneDocumentSectionBody,
} from './milestone-document-list';
import type {
  MilestoneDocument,
  MilestoneDocumentViewerSubmission,
} from './milestone-document-api';
import { milestoneSubmissionAccess } from './milestone-submission-access';
import type { ApplicationStatus, ViewerRole } from './types';

function access(
  role: ViewerRole,
  applicationStatus: ApplicationStatus | null = null,
) {
  return milestoneSubmissionAccess({ role, applicationStatus });
}

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const milestoneDocument: MilestoneDocument = {
  id: 'document-1',
  milestoneId: 'milestone-1',
  name: '기획서',
  required: true,
  sortOrder: 0,
  hasTemplateFile: false,
  templateFileName: null,
};

function documentListBody(documents: readonly MilestoneDocument[]): unknown {
  return { documents, fileUpload: milestoneDocumentUploadPolicy() };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function problemResponse(status: number, code: string): Response {
  return new Response(
    JSON.stringify({
      type: 'about:blank',
      title: 'Request failed',
      status,
      detail: '합성 이력 조회 실패',
      instance: '/x',
      code,
    }),
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );
}

describe('MilestoneDocumentSection response recovery', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => Promise.resolve(root.unmount()));
    container.remove();
    vi.unstubAllGlobals();
  });

  it('200/null을 실패 화면으로 바꾸고 사용자가 다시 불러올 수 있게 한다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(null))
      .mockResolvedValueOnce(
        jsonResponse(documentListBody([milestoneDocument])),
      );
    vi.stubGlobal('fetch', fetchMock);

    await act(() => {
      root.render(
        <MilestoneDocumentSection
          milestoneId="milestone-1"
          viewerRole="STAFF"
          closed={false}
          submissionAccess={access('STAFF')}
        />,
      );
      return Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain(
        '제출 항목을 불러오지 못했습니다.',
      );
    });

    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === '다시 시도',
    );
    if (!(retry instanceof HTMLButtonElement)) {
      throw new TypeError('다시 시도 버튼을 찾지 못했습니다.');
    }
    await act(() => Promise.resolve(retry.click()));
    await vi.waitFor(() => {
      expect(container.textContent).toContain('기획서');
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('제출과 판정이 부딪혔을 때', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => Promise.resolve(root.unmount()));
    container.remove();
    vi.unstubAllGlobals();
  });

  function problemResponse(
    status: number,
    code: string,
    detail: string,
  ): Response {
    return new Response(
      JSON.stringify({
        type: 'about:blank',
        title: 'Conflict',
        status,
        detail,
        instance: '/x',
        code,
      }),
      { status, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  function documentWithViewer(
    viewerSubmission: MilestoneDocumentViewerSubmission,
  ): MilestoneDocument {
    return { ...milestoneDocument, viewerSubmission };
  }

  const CHANGES_REQUESTED = documentWithViewer({
    submitted: true,
    submittedAt: '2026-08-01T05:22:00.000Z',
    revision: 1,
    status: 'CHANGES_REQUESTED',
    hasCurrentFile: false,
    currentFileName: null,
    history: { hasHistory: false, isComplete: true },
    review: {
      comment: '표지를 고쳐 주세요.',
      reviewedAt: '2026-08-02T00:00:00.000Z',
      resubmissionDueAt: null,
    },
  });
  const APPROVED = documentWithViewer({
    submitted: true,
    submittedAt: '2026-08-01T05:22:00.000Z',
    revision: 1,
    status: 'APPROVED',
    hasCurrentFile: false,
    currentFileName: null,
    history: { hasHistory: false, isComplete: true },
    review: {
      comment: '잘 받았습니다.',
      reviewedAt: '2026-08-03T00:00:00.000Z',
      resubmissionDueAt: null,
    },
  });

  function submitNotice(): HTMLElement | null {
    return container.querySelector(
      '[data-testid="milestone-document-submit-notice"]',
    );
  }

  function button(text: string): HTMLButtonElement | null {
    return (
      Array.from(container.querySelectorAll('button')).find(
        (candidate) => candidate.textContent?.trim() === text,
      ) ?? null
    );
  }

  function submissionInput(): HTMLTextAreaElement | null {
    const found = container.querySelector(
      'textarea[placeholder="제출할 내용이나 설명을 적어 주세요."]',
    );
    return found instanceof HTMLTextAreaElement ? found : null;
  }

  async function resubmit() {
    await act(() => {
      root.render(
        <MilestoneDocumentSection
          milestoneId="milestone-1"
          viewerRole="STUDENT"
          closed={false}
          submissionAccess={access('STUDENT', 'APPROVED')}
        />,
      );
      return Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain('기획서');
    });

    const edit = button('수정');
    if (edit === null) throw new TypeError('수정 버튼을 찾지 못했습니다.');
    await act(() => Promise.resolve(edit.click()));

    const input = submissionInput();
    if (input === null) throw new TypeError('제출 입력 칸을 찾지 못했습니다.');

    const descriptor = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    );
    await act(() => {
      descriptor?.set?.call(input, '고쳐서 다시 냅니다.');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return Promise.resolve();
    });
    await act(() => {
      container
        .querySelector('form')
        ?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
      return Promise.resolve();
    });
  }

  it('재제출 폼을 열면 지금 붙어 있는 첨부가 빠진다고 알린다', async () => {
    const withFile = documentWithViewer({
      submitted: true,
      submittedAt: '2026-08-01T05:22:00.000Z',
      revision: 1,

      status: 'SUBMITTED',
      hasCurrentFile: true,
      currentFileName: '1차_계획서.pdf',
      history: { hasHistory: false, isComplete: true },
      review: null,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(documentListBody([withFile]))),
    );

    await act(() => {
      root.render(
        <MilestoneDocumentSection
          milestoneId="milestone-1"
          viewerRole="STUDENT"
          closed={false}
          submissionAccess={{ kind: 'open' }}
        />,
      );
      return Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(button('수정')).not.toBeNull();
    });
    const edit = button('수정');
    if (edit === null) throw new TypeError('수정 버튼을 찾지 못했습니다.');
    await act(() => Promise.resolve(edit.click()));

    expect(container.textContent).toContain('기존 제출 파일');
    expect(container.textContent).toContain('1차_계획서.pdf');
    expect(container.textContent).toContain('이번 제출에서 빠집니다');
  });

  it('409(MSD_024)를 받으면 상태를 다시 불러와 금지된 조작을 걷는다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(documentListBody([CHANGES_REQUESTED])),
      )
      .mockResolvedValueOnce(
        problemResponse(
          409,
          'MSD_024',
          '제출하는 사이에 교직원 검토 결과가 등록되었습니다. 새로고침 후 다시 확인해 주세요.',
        ),
      )
      .mockResolvedValueOnce(jsonResponse(documentListBody([APPROVED])));
    vi.stubGlobal('fetch', fetchMock);

    await resubmit();
    await vi.waitFor(() => {
      expect(button('수정')).toBeNull();
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(submissionInput()).toBeNull();
    expect(container.textContent).toContain(
      '승인된 제출 항목은 다시 제출할 수 없습니다.',
    );
    expect(
      container.querySelector('[data-slot="status-badge"]')?.textContent,
    ).toBe('승인');

    const notice = submitNotice();
    expect(notice?.textContent).toContain('「기획서」');
    expect(notice?.textContent).toContain('저장되지 않았습니다');
    expect(notice?.textContent).toContain('다시 불러왔습니다');
  });

  it('다시 부르는 것도 실패하면 못 불러왔다고 말한다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(documentListBody([CHANGES_REQUESTED])),
      )
      .mockResolvedValueOnce(
        problemResponse(
          409,
          'MSD_024',
          '제출하는 사이에 교직원 검토 결과가 등록되었습니다.',
        ),
      )
      .mockResolvedValueOnce(
        problemResponse(503, 'COM_002', '잠시 후 다시 시도해 주세요.'),
      );
    vi.stubGlobal('fetch', fetchMock);

    await resubmit();
    await vi.waitFor(() => {
      expect(container.textContent).toContain(
        '제출 항목을 불러오지 못했습니다.',
      );
    });

    const notice = submitNotice();
    expect(notice?.textContent).toContain('저장되지 않았습니다');
    expect(notice?.textContent).toContain('다시 불러오지 못했습니다');
    expect(notice?.textContent).not.toContain('다시 불러왔습니다');
    expect(button('다시 시도')).not.toBeNull();
  });

  it('다른 오류는 문구만 보여 주고 다시 부르지 않는다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(documentListBody([CHANGES_REQUESTED])),
      )
      .mockResolvedValueOnce(
        problemResponse(
          409,
          'MSD_023',
          '승인 또는 반려된 서류는 다시 제출할 수 없습니다.',
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await resubmit();
    await vi.waitFor(() => {
      expect(container.textContent).toContain(
        '승인 또는 반려된 서류는 다시 제출할 수 없습니다.',
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(submitNotice()).toBeNull();

    expect(submissionInput()?.value).toBe('고쳐서 다시 냅니다.');
  });

  it('제출 성공 뒤 목록과 이력 첫 페이지를 다시 읽어 현재 제출본을 표시한다', async () => {
    const refreshed = documentWithViewer({
      submitted: true,
      submittedAt: '2026-08-03T00:00:00.000Z',
      revision: 3,
      status: 'SUBMITTED',
      hasCurrentFile: false,
      currentFileName: null,
      review: CHANGES_REQUESTED.viewerSubmission?.review ?? null,
      history: { hasHistory: true, isComplete: true },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(documentListBody([CHANGES_REQUESTED])),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'submission-1',
          status: 'SUBMITTED',
          submittedAt: '2026-08-03T00:00:00.000Z',
        }),
      )
      .mockResolvedValueOnce(jsonResponse(documentListBody([refreshed])))
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              event: 'RESUBMITTED',
              revision: 3,
              actorNickname: '팀원B',
              comment: null,
              createdAt: '2026-08-03T00:00:00.000Z',
              fileName: null,
            },
          ],
          nextCursor: null,
          isComplete: true,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await resubmit();
    await vi.waitFor(() => {
      expect(container.textContent).toContain('검토 대기');
      expect(container.textContent).toContain('3차 제출본');
      expect(container.textContent).toContain('팀원B');
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('제출 저장 뒤 목록 재조회가 실패하면 재제출을 잠그고 최신 상태 재시도만 제공한다', async () => {
    const refreshed = documentWithViewer({
      submitted: true,
      submittedAt: '2026-08-03T00:00:00.000Z',
      revision: 3,
      status: 'SUBMITTED',
      hasCurrentFile: false,
      currentFileName: null,
      review: CHANGES_REQUESTED.viewerSubmission?.review ?? null,
      history: { hasHistory: true, isComplete: true },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(documentListBody([CHANGES_REQUESTED])),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'submission-1' }))
      .mockResolvedValueOnce(
        problemResponse(503, 'COM_002', '잠시 후 다시 시도해 주세요.'),
      )
      .mockResolvedValueOnce(jsonResponse(documentListBody([refreshed])))
      .mockResolvedValueOnce(
        jsonResponse({ items: [], nextCursor: null, isComplete: true }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await resubmit();
    await vi.waitFor(() => {
      expect(container.textContent).toContain('제출은 저장되었습니다.');
    });
    expect(button('수정')).toBeNull();
    expect(submissionInput()).toBeNull();

    await act(() =>
      Promise.resolve(button('최신 상태 다시 불러오기')?.click()),
    );
    await vi.waitFor(() => {
      expect(container.textContent).toContain('검토 대기');
      expect(container.textContent).not.toContain('제출은 저장되었습니다.');
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('두 행의 저장 재조회와 판정 충돌 재조회를 한 순서로 직렬화한다', async () => {
    const second = {
      ...CHANGES_REQUESTED,
      id: 'document-2',
      name: '결과보고서',
    };
    const refreshedFirst = documentWithViewer({
      submitted: true,
      submittedAt: '2026-08-03T00:00:00.000Z',
      revision: 3,
      status: 'SUBMITTED',
      hasCurrentFile: false,
      currentFileName: null,
      review: CHANGES_REQUESTED.viewerSubmission?.review ?? null,
      history: { hasHistory: false, isComplete: true },
    });
    const approvedSecond = {
      ...APPROVED,
      id: second.id,
      name: second.name,
    };
    let resolveQuiet!: (response: Response) => void;
    let resolveConflict!: (response: Response) => void;
    const quiet = new Promise<Response>((resolve) => {
      resolveQuiet = resolve;
    });
    const conflict = new Promise<Response>((resolve) => {
      resolveConflict = resolve;
    });
    let getCount = 0;
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = input instanceof Request ? input.url : String(input);
        const method =
          input instanceof Request ? input.method : (init?.method ?? 'GET');
        if (method === 'GET') {
          getCount += 1;
          if (getCount === 1)
            return Promise.resolve(
              jsonResponse(documentListBody([CHANGES_REQUESTED, second])),
            );
          if (getCount === 2) return quiet;
          if (getCount === 3) return conflict;
        }
        if (url.includes('/document-1/submissions')) {
          return Promise.resolve(jsonResponse({ id: 'submission-1' }));
        }
        if (url.includes('/document-2/submissions')) {
          return Promise.resolve(
            problemResponse(409, 'MSD_024', '판정이 먼저 저장되었습니다.'),
          );
        }
        throw new TypeError(`Unexpected request: ${method} ${url}`);
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    await act(() => {
      root.render(
        <MilestoneDocumentSection
          milestoneId="milestone-1"
          viewerRole="STUDENT"
          closed={false}
          submissionAccess={access('STUDENT', 'APPROVED')}
        />,
      );
      return Promise.resolve();
    });
    await vi.waitFor(() =>
      expect(container.textContent).toContain(second.name),
    );

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-testid="milestone-document-row"]',
      ),
    );
    const rowFor = (name: string) => {
      const row = rows.find((candidate) =>
        candidate.textContent?.includes(name),
      );
      if (row === undefined) throw new TypeError(`Missing row: ${name}`);
      return row;
    };
    for (const [name, text] of [
      ['기획서', '첫 행 수정'],
      ['결과보고서', '둘째 행 수정'],
    ] as const) {
      const row = rowFor(name);
      await act(() => {
        row
          .querySelector<HTMLButtonElement>('button')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return Promise.resolve();
      });
      const input = row.querySelector<HTMLTextAreaElement>('textarea');
      if (input === null) throw new TypeError(`Missing input: ${name}`);
      const descriptor = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      );
      await act(() => {
        descriptor?.set?.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return Promise.resolve();
      });
    }
    await act(() => {
      for (const row of rows) {
        row
          .querySelector('form')
          ?.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
          );
      }
      return Promise.resolve();
    });

    await vi.waitFor(() => expect(getCount).toBe(2));
    await act(() => {
      resolveQuiet(jsonResponse(documentListBody([refreshedFirst, second])));
      return Promise.resolve();
    });
    await vi.waitFor(() => expect(getCount).toBe(3));
    await act(() => {
      resolveConflict(
        jsonResponse(documentListBody([refreshedFirst, approvedSecond])),
      );
      return Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain('검토 대기');
      expect(container.textContent).toContain(
        '승인된 제출 항목은 다시 제출할 수 없습니다.',
      );
    });
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(2);
  });
});

describe('학생 행이 판정을 읽는 방식', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => Promise.resolve(root.unmount()));
    container.remove();
    vi.unstubAllGlobals();
  });

  function viewer(
    overrides: Partial<MilestoneDocumentViewerSubmission>,
  ): MilestoneDocumentViewerSubmission {
    return {
      submitted: true,
      submittedAt: '2026-08-01T05:22:00.000Z',
      revision: 1,
      status: 'SUBMITTED',
      hasCurrentFile: false,
      currentFileName: null,
      review: null,
      history: { hasHistory: false, isComplete: true },
      ...overrides,
    };
  }

  async function renderRow(
    viewerSubmission: MilestoneDocumentViewerSubmission,
    closed = false,
  ) {
    await act(() => {
      root.render(
        <MilestoneDocumentSectionBody
          key={`${viewerSubmission.submitted}-${viewerSubmission.status}-${closed}`}
          state={{
            kind: 'ready',
            documents: [{ ...milestoneDocument, viewerSubmission }],
            fileUpload: milestoneDocumentUploadPolicy(),
          }}
          viewerRole="STUDENT"
          closed={closed}
          submissionAccess={access('STUDENT', 'APPROVED')}
          conflictNotice={null}
          onRetry={() => {}}
          onDocumentChange={() => {}}
          onSubmitConflict={() => {}}
        />,
      );
      return Promise.resolve();
    });
  }

  function buttonTexts(): readonly string[] {
    return Array.from(container.querySelectorAll('button')).map(
      (button) => button.textContent?.trim() ?? '',
    );
  }

  function actionButton(text: string): HTMLButtonElement {
    const found = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === text,
    );
    if (!(found instanceof HTMLButtonElement)) {
      throw new TypeError(`버튼을 찾지 못했습니다: ${text}`);
    }
    return found;
  }

  function notice(): HTMLElement | null {
    return container.querySelector(
      '[data-testid="milestone-document-review-notice"]',
    );
  }

  it('상태마다 배지 문구가 갈린다', async () => {
    const cases = [
      [{ submitted: false, submittedAt: null, status: null }, '미제출'],
      [{ status: 'SUBMITTED' as const }, '검토 대기'],
      [{ status: 'APPROVED' as const }, '승인'],
      [
        {
          status: 'CHANGES_REQUESTED' as const,
          review: {
            comment: '고쳐 주세요.',
            reviewedAt: '2026-08-02T00:00:00.000Z',
            resubmissionDueAt: null,
          },
        },
        '보완 요청',
      ],
      [
        {
          status: 'REJECTED' as const,
          review: {
            comment: '기한을 넘겼습니다.',
            reviewedAt: '2026-08-02T00:00:00.000Z',
            resubmissionDueAt: null,
          },
        },
        '반려',
      ],
    ] as const;

    for (const [overrides, label] of cases) {
      await renderRow(viewer(overrides));
      const badge = container.querySelector('[data-slot="status-badge"]');
      expect(badge?.textContent).toBe(label);
    }
  });

  it('이력이 있는 제출만 첫 cursor 페이지를 읽어 표시한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        items: [
          {
            event: 'SUBMITTED',
            revision: 1,
            actorNickname: '학생A',
            comment: null,
            createdAt: '2026-08-01T00:00:00.000Z',
            fileName: 'first.pdf',
          },
          {
            event: 'CHANGES_REQUESTED',
            revision: 1,
            actorNickname: '담당자B',
            comment: '서명 페이지를 추가해 주세요.',
            createdAt: '2026-08-02T00:00:00.000Z',
            fileName: null,
          },
          {
            event: 'RESUBMITTED',
            revision: 2,
            actorNickname: '학생A',
            comment: null,
            createdAt: '2026-08-03T00:00:00.000Z',
            fileName: 'second.pdf',
          },
        ],
        nextCursor: null,
        isComplete: true,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await renderRow(
      viewer({
        revision: 2,
        history: { hasHistory: true, isComplete: true },
      }),
    );

    await vi.waitFor(() => {
      expect(container.textContent).toContain('제출·검토 이력');
      expect(container.textContent).toContain('first.pdf');
      expect(container.textContent).toContain('서명 페이지를 추가해 주세요.');
      expect(container.textContent).toContain('second.pdf');
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        '/milestones/milestone-1/documents/document-1/history?limit=20',
      ),
      undefined,
    );
  });

  it('이전 페이지를 요청해 오래된 이력을 앞에 붙인다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              event: 'RESUBMITTED',
              revision: 2,
              actorNickname: '학생A',
              comment: null,
              createdAt: '2026-08-03T00:00:00.000Z',
              fileName: 'latest.pdf',
            },
          ],
          nextCursor: 'older-page',
          isComplete: true,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              event: 'SUBMITTED',
              revision: 1,
              actorNickname: '학생A',
              comment: null,
              createdAt: '2026-08-01T00:00:00.000Z',
              fileName: 'first.pdf',
            },
          ],
          nextCursor: null,
          isComplete: true,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await renderRow(
      viewer({ history: { hasHistory: true, isComplete: true } }),
    );
    await vi.waitFor(() => {
      expect(buttonTexts()).toContain('이전 이력 더 보기');
    });
    await act(() => Promise.resolve(actionButton('이전 이력 더 보기').click()));
    await vi.waitFor(() => {
      expect(container.textContent).toContain('first.pdf');
    });

    expect(fetchMock.mock.calls[1]?.[0]).toContain(
      '/history?limit=20&cursor=older-page',
    );
    const text = container.textContent ?? '';
    expect(text.indexOf('first.pdf')).toBeLessThan(text.indexOf('latest.pdf'));
  });

  it('모든 cursor 페이지를 읽어도 이관 원장이 불완전하면 누락을 명시한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          items: [
            {
              event: 'RESUBMITTED',
              revision: 3,
              actorNickname: '학생A',
              comment: null,
              createdAt: '2026-08-03T00:00:00.000Z',
              fileName: null,
            },
          ],
          nextCursor: null,
          isComplete: false,
        }),
      ),
    );

    await renderRow(
      viewer({ history: { hasHistory: true, isComplete: false } }),
    );
    await vi.waitFor(() => {
      expect(container.textContent).toContain(
        '지난 제출본 가운데 일부는 남아 있지 않아',
      );
    });
    expect(buttonTexts()).not.toContain('이전 이력 더 보기');
  });

  it('이전 cursor가 남아 있어도 알려진 원장 누락과 더 보기를 함께 표시한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          items: [
            {
              event: 'RESUBMITTED',
              revision: 3,
              actorNickname: '학생A',
              comment: null,
              createdAt: '2026-08-03T00:00:00.000Z',
              fileName: null,
            },
          ],
          nextCursor: 'older-page',
          isComplete: false,
        }),
      ),
    );

    await renderRow(
      viewer({ history: { hasHistory: true, isComplete: false } }),
    );
    await vi.waitFor(() => {
      expect(container.textContent).toContain(
        '지난 제출본 가운데 일부는 남아 있지 않아',
      );
    });
    expect(buttonTexts()).toContain('이전 이력 더 보기');
  });

  it('빈 원장은 그리지 않고 미제출 행에는 이력 요청을 보내지 않는다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ items: [], nextCursor: null, isComplete: true }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await renderRow(
      viewer({ history: { hasHistory: true, isComplete: true } }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(container.textContent).not.toContain('제출·검토 이력');

    await renderRow(
      viewer({
        submitted: false,
        submittedAt: null,
        status: null,
        history: { hasHistory: true, isComplete: true },
      }),
    );
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain('제출·검토 이력');
  });

  it('이력 조회 실패는 제출 조작을 막지 않고 같은 페이지를 다시 시도한다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(
        jsonResponse({ items: [], nextCursor: null, isComplete: true }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await renderRow(
      viewer({ history: { hasHistory: true, isComplete: true } }),
    );
    await vi.waitFor(() => {
      expect(
        container.querySelector(
          '[data-testid="milestone-document-history-error"]',
        ),
      ).not.toBeNull();
    });
    expect(buttonTexts()).toContain('수정');

    await act(() => Promise.resolve(actionButton('다시 시도').click()));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      container.querySelector(
        '[data-testid="milestone-document-history-error"]',
      ),
    ).toBeNull();
  });

  it('MSD_005 이력 조회 거절은 안내만 보이고 다시 시도를 주지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(problemResponse(403, 'MSD_005')),
    );

    await renderRow(
      viewer({ history: { hasHistory: true, isComplete: true } }),
    );

    await vi.waitFor(() => {
      expect(
        container.querySelector(
          '[data-testid="milestone-document-history-forbidden"]',
        ),
      ).not.toBeNull();
    });
    expect(container.textContent).toContain(
      '제출 이력은 신청이 승인된 참여자만 볼 수 있습니다.',
    );
    expect(buttonTexts()).not.toContain('다시 시도');
    expect(
      container.querySelector(
        '[data-testid="milestone-document-history-error"]',
      ),
    ).toBeNull();
  });

  it('MSD_005가 아닌 ApiError 이력 조회 실패는 다시 시도 경고를 보인다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(problemResponse(500, 'MSD_999')),
    );

    await renderRow(
      viewer({ history: { hasHistory: true, isComplete: true } }),
    );

    await vi.waitFor(() => {
      expect(
        container.querySelector(
          '[data-testid="milestone-document-history-error"]',
        ),
      ).not.toBeNull();
    });
    expect(buttonTexts()).toContain('다시 시도');
  });

  it('403 API_000 이력 조회 실패도 다시 시도 경고를 보인다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(problemResponse(403, 'API_000')),
    );

    await renderRow(
      viewer({ history: { hasHistory: true, isComplete: true } }),
    );

    await vi.waitFor(() => {
      expect(
        container.querySelector(
          '[data-testid="milestone-document-history-error"]',
        ),
      ).not.toBeNull();
    });
    expect(buttonTexts()).toContain('다시 시도');
    expect(
      container.querySelector(
        '[data-testid="milestone-document-history-forbidden"]',
      ),
    ).toBeNull();
  });

  it('ApiError가 아닌 이력 조회 실패도 다시 시도 경고를 보인다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));

    await renderRow(
      viewer({ history: { hasHistory: true, isComplete: true } }),
    );

    await vi.waitFor(() => {
      expect(
        container.querySelector(
          '[data-testid="milestone-document-history-error"]',
        ),
      ).not.toBeNull();
    });
    expect(buttonTexts()).toContain('다시 시도');
  });

  it('보완 요청·반려는 사유를 날짜와 함께 경고 톤으로 보여 준다', async () => {
    await renderRow(
      viewer({
        status: 'CHANGES_REQUESTED',
        review: {
          comment: '표지의 이름이 신청서와 다릅니다.',
          reviewedAt: '2026-08-02T01:20:00.000Z',
          resubmissionDueAt: null,
        },
      }),
    );

    const box = notice();
    expect(box).not.toBeNull();
    expect(box?.textContent).toContain('표지의 이름이 신청서와 다릅니다.');
    expect(box?.textContent).toContain('보완 요청');
    expect(box?.textContent).toContain('2026년 8월 2일');

    expect(box?.closest('[data-slot="alert"]')?.className).toContain(
      'text-destructive',
    );
  });

  it('반려 사유도 같은 자리에 그대로 보인다', async () => {
    await renderRow(
      viewer({
        status: 'REJECTED',
        review: {
          comment: '제출 기한을 두 주 넘겼습니다.',
          reviewedAt: '2026-08-02T01:20:00.000Z',
          resubmissionDueAt: null,
        },
      }),
    );

    expect(notice()?.textContent).toContain('제출 기한을 두 주 넘겼습니다.');
  });

  it('승인에 적은 사유도 날짜와 함께 학생에게 보인다', async () => {
    await renderRow(
      viewer({
        status: 'APPROVED',
        review: {
          comment: '잘 받았습니다. 다음 단계는 개별로 안내드릴게요.',
          reviewedAt: '2026-08-02T01:20:00.000Z',
          resubmissionDueAt: null,
        },
      }),
    );

    const box = notice();
    expect(box).not.toBeNull();
    expect(box?.textContent).toContain(
      '잘 받았습니다. 다음 단계는 개별로 안내드릴게요.',
    );
    expect(box?.textContent).toContain('승인');
    expect(box?.textContent).toContain('2026년 8월 2일');
  });

  it('승인 사유는 경고 톤으로 키우지 않는다', async () => {
    await renderRow(
      viewer({
        status: 'APPROVED',
        review: {
          comment: '수고했습니다.',
          reviewedAt: '2026-08-02T01:20:00.000Z',
          resubmissionDueAt: null,
        },
      }),
    );

    expect(notice()?.closest('[data-slot="alert"]')?.className).not.toContain(
      'text-destructive',
    );
  });

  it('사유 없는 승인에는 상자를 세우지 않는다', async () => {
    await renderRow(
      viewer({
        status: 'APPROVED',
        review: {
          comment: null,
          reviewedAt: '2026-08-02T01:20:00.000Z',
          resubmissionDueAt: null,
        },
      }),
    );

    expect(notice()).toBeNull();
  });

  it('승인·반려된 서류에는 제출 입력을 열지 않는다', async () => {
    await renderRow(viewer({ status: 'APPROVED' }));
    expect(buttonTexts()).not.toContain('수정');
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.textContent).toContain(
      '승인된 제출 항목은 다시 제출할 수 없습니다.',
    );

    await renderRow(viewer({ status: 'REJECTED' }));
    expect(buttonTexts()).not.toContain('수정');
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.textContent).toContain(
      '반려된 제출 항목은 다시 제출할 수 없습니다.',
    );
  });

  it('보완 요청·검토 대기·미제출에는 제출 입력을 연다', async () => {
    await renderRow(viewer({ status: 'CHANGES_REQUESTED' }));
    expect(buttonTexts()).toContain('수정');
    await act(() => Promise.resolve(actionButton('수정').click()));
    expect(container.querySelector('input[type="file"]')).not.toBeNull();

    await renderRow(viewer({ status: 'SUBMITTED' }));
    expect(buttonTexts()).toContain('수정');

    await renderRow(
      viewer({ submitted: false, submittedAt: null, status: null }),
    );
    expect(buttonTexts()).toContain('올리기');
  });

  it('마감이 지나도 보완 요청은 다시 낼 수 있다', async () => {
    await renderRow(viewer({ status: 'CHANGES_REQUESTED' }), true);
    const editButton = actionButton('수정');
    expect(editButton.disabled).toBe(false);
    await act(() => Promise.resolve(editButton.click()));
    expect(
      container.querySelector(
        'textarea[placeholder="제출할 내용이나 설명을 적어 주세요."]',
      ),
    ).not.toBeNull();
  });

  it('마감 뒤 미제출·검토 대기는 그대로 잠근다', async () => {
    await renderRow(
      viewer({ submitted: false, submittedAt: null, status: null }),
      true,
    );
    expect(actionButton('올리기').disabled).toBe(true);

    await renderRow(viewer({ status: 'SUBMITTED' }), true);
    expect(actionButton('수정').disabled).toBe(true);
  });

  it('마감 뒤, 보완 요청에 이미 응한 제출은 잠근 채로 둔다', async () => {
    await renderRow(
      viewer({
        status: 'SUBMITTED',
        revision: 2,
        review: {
          comment: '3쪽 서명이 빠졌습니다.',
          reviewedAt: '2026-08-02T00:00:00.000Z',
          resubmissionDueAt: null,
        },
      }),
      true,
    );

    expect(container.textContent).toContain('검토 대기');
    expect(actionButton('수정').disabled).toBe(true);
  });

  it('마감 전에는 검토 대기도 잠기지 않는다', async () => {
    await renderRow(viewer({ status: 'SUBMITTED' }));

    expect(actionButton('수정').disabled).toBe(false);
  });

  it('통합 제출도 승인되면 입력 칸이 열리지 않는다', async () => {
    await renderRow(viewer({ status: 'CHANGES_REQUESTED' }));
    const editButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '수정',
    );
    if (!(editButton instanceof HTMLButtonElement)) {
      throw new TypeError('수정 버튼을 찾지 못했습니다.');
    }
    await act(() => Promise.resolve(editButton.click()));
    expect(
      container.querySelector(
        'textarea[placeholder="제출할 내용이나 설명을 적어 주세요."]',
      ),
    ).not.toBeNull();

    await renderRow(viewer({ status: 'APPROVED' }));
    expect(buttonTexts()).not.toContain('수정');
    expect(
      container.querySelector(
        'textarea[placeholder="제출할 내용이나 설명을 적어 주세요."]',
      ),
    ).toBeNull();
  });
});

describe('열어 둔 화면에서 재제출 기한이 지나는 순간', () => {
  const resubmissionDueAt = '2026-09-26T09:00:00.000Z';
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-26T08:59:59.000Z'));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function awaitingResubmission(): MilestoneDocumentViewerSubmission {
    return {
      submitted: true,
      submittedAt: '2026-09-20T00:00:00.000Z',
      revision: 1,
      status: 'CHANGES_REQUESTED',
      hasCurrentFile: false,
      currentFileName: null,
      review: {
        comment: '3쪽 서명이 빠졌습니다.',
        reviewedAt: '2026-09-20T00:00:00.000Z',
        resubmissionDueAt,
      },
      history: { hasHistory: false, isComplete: true },
    };
  }

  function renderRow(): void {
    act(() => {
      root.render(
        <MilestoneDocumentSectionBody
          state={{
            kind: 'ready',
            documents: [
              {
                ...milestoneDocument,
                viewerSubmission: awaitingResubmission(),
              },
            ],
            fileUpload: milestoneDocumentUploadPolicy(),
          }}
          viewerRole="STUDENT"
          submissionAccess={{ kind: 'open' }}
          closed
          conflictNotice={null}
          onRetry={() => {}}
          onDocumentChange={() => {}}
          onSubmitConflict={() => {}}
        />,
      );
    });
  }

  function editButton(): HTMLButtonElement {
    const found = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '수정',
    );
    if (!(found instanceof HTMLButtonElement)) {
      throw new TypeError('수정 버튼을 찾지 못했습니다.');
    }
    return found;
  }

  function dueText(): string {
    return (
      container.querySelector(
        '[data-testid="milestone-document-resubmission-due"]',
      )?.textContent ?? ''
    );
  }

  it('안내와 「수정」 버튼이 스스로 잠긴다', () => {
    renderRow();

    expect(editButton().disabled).toBe(false);
    expect(dueText()).toContain('까지');

    act(() => {
      vi.advanceTimersByTime(1001);
    });

    expect(editButton().disabled).toBe(true);
    expect(dueText()).toContain('지났습니다');
  });

  it('브라우저 최대 대기 시간을 두 번 넘겨도 기한 뒤에는 수정이 잠긴다', () => {
    const maxDelay = 2_147_483_647;
    vi.setSystemTime(
      new Date(Date.parse(resubmissionDueAt) - maxDelay * 2 - 1000),
    );
    renderRow();
    expect(editButton().disabled).toBe(false);

    act(() => {
      vi.advanceTimersByTime(maxDelay);
    });
    act(() => {
      vi.advanceTimersByTime(maxDelay);
    });
    act(() => {
      vi.advanceTimersByTime(1001);
    });

    expect(editButton().disabled).toBe(true);
  });

  it('기한을 겨냥한 타이머 하나만 걸고, 지나면 스스로 걷힌다', () => {
    renderRow();

    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1001);
    });

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('압축 내용 거절은 파일 입력 한 자리에만 선다', () => {
  let container: HTMLDivElement;
  let root: Root;
  const lockedDetail =
    '비밀번호가 걸린 압축 파일은 제출할 수 없습니다. 비밀번호 없이 다시 압축해 주세요.';

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => Promise.resolve(root.unmount()));
    container.remove();
    vi.unstubAllGlobals();
  });

  function rejection(): Response {
    return new Response(
      JSON.stringify({
        type: 'about:blank',
        title: 'Unprocessable Content',
        status: 422,
        detail: lockedDetail,
        instance: '/x',
        code: 'MSD_040',
      }),
      { status: 422, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  function button(text: string): HTMLButtonElement | null {
    return (
      Array.from(container.querySelectorAll('button')).find(
        (candidate) => candidate.textContent?.trim() === text,
      ) ?? null
    );
  }

  it('거절된 ZIP을 그대로 제출해도 문장은 파일 입력 아래에 한 번만 뜬다', async () => {
    const fetchMock = vi.fn((target: RequestInfo | URL) =>
      Promise.resolve(
        (typeof target === 'string' || target instanceof URL
          ? target.toString()
          : target.url
        ).includes('/milestone-document-files')
          ? rejection()
          : jsonResponse(documentListBody([milestoneDocument])),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await act(() => {
      root.render(
        <MilestoneDocumentSection
          milestoneId="milestone-1"
          viewerRole="STUDENT"
          closed={false}
          submissionAccess={access('STUDENT', 'APPROVED')}
        />,
      );
      return Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(button('올리기')).not.toBeNull();
    });
    await act(() => Promise.resolve(button('올리기')?.click()));
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement))
      throw new TypeError('Missing file input.');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['PK'], 'locked.zip', { type: 'application/zip' })],
    });
    await act(() =>
      Promise.resolve(
        input.dispatchEvent(new Event('change', { bubbles: true })),
      ),
    );
    await vi.waitFor(() => {
      expect(
        container.querySelector('#document-1-submission-file-error')
          ?.textContent,
      ).toBe(lockedDetail);
    });

    await act(() => {
      container
        .querySelector('form')
        ?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
      return Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([target]) =>
          (typeof target === 'string' || target instanceof URL
            ? target.toString()
            : target.url
          ).endsWith('/milestone-document-files'),
        ),
      ).toBe(true);
    });
    await act(async () => {});

    expect(container.textContent?.split(lockedDetail)).toHaveLength(2);
    expect(
      container.querySelector('#document-1-submission-file-error')?.textContent,
    ).toBe(lockedDetail);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });
});
