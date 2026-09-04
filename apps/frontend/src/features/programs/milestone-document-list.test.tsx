// @vitest-environment happy-dom

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
import type { ApplicationStatus } from './types';

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

/** 목록 응답 봉투 — 화면은 이 안의 `fileUpload`로 파일 입력을 그린다(#1107). */
function documentListBody(documents: readonly MilestoneDocument[]): unknown {
  return { documents, fileUpload: milestoneDocumentUploadPolicy() };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
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
    await act(async () => root.unmount());
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

    await act(async () => {
      root.render(
        <MilestoneDocumentSection
          milestoneId="milestone-1"
          viewerRole="STAFF"
          closed={false}
          applicationStatus={null}
        />,
      );
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
    await act(async () => retry.click());
    await vi.waitFor(() => {
      expect(container.textContent).toContain('기획서');
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/**
 * 학생이 다시 내는 사이에 교직원 판정이 먼저 커밋된 경우 — 백엔드가 409(MSD_024)를 준다.
 *
 * 실제 fetch를 태워 보는 이유는 **화면이 다시 부르는지**가 이 갈래의 전부이기 때문이다.
 * 오류 문구만 갈아 끼우면 화면은 여전히 「보완 요청」으로 알아 제출 입력을 열어 두고,
 * 그 판정이 승인이었다면 학생은 이미 금지된 조작을 계속 보며 누를 때마다 409를 다시 받는다.
 */
describe('제출과 판정이 부딪혔을 때', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
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
    history: { hasHistory: false, isComplete: true },
    review: {
      comment: '표지를 고쳐 주세요.',
      reviewedAt: '2026-08-02T00:00:00.000Z',
    },
  });
  const APPROVED = documentWithViewer({
    submitted: true,
    submittedAt: '2026-08-01T05:22:00.000Z',
    revision: 1,
    status: 'APPROVED',
    hasCurrentFile: false,
    history: { hasHistory: false, isComplete: true },
    review: {
      comment: '잘 받았습니다.',
      reviewedAt: '2026-08-03T00:00:00.000Z',
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

  /** 보완 요청을 받은 서류를 다시 낸다 — 두 번째 fetch가 그 제출이다. */
  async function resubmit() {
    await act(async () => {
      root.render(
        <MilestoneDocumentSection
          milestoneId="milestone-1"
          viewerRole="STUDENT"
          closed={false}
          applicationStatus="APPROVED"
        />,
      );
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain('기획서');
    });

    const edit = button('수정');
    if (edit === null) throw new TypeError('수정 버튼을 찾지 못했습니다.');
    await act(async () => edit.click());

    const input = submissionInput();
    if (input === null) throw new TypeError('제출 입력 칸을 찾지 못했습니다.');
    // React가 값 변경을 감지하도록 네이티브 setter로 넣고 input 이벤트를 올린다.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setter?.call(input, '고쳐서 다시 냅니다.');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector('form')
        ?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
    });
  }

  /**
   * 변이 검증 대상 — MSD_024 뒤의 재조회가 사라지면 여기가 깨진다. 화면은 「보완 요청」인
   * 채로 남아 승인된 서류에 제출 입력을 계속 열어 둔다.
   */
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
      // 승인된 서류에는 제출 입력이 남지 않는다 — 다시 부르지 않으면 그대로 열려 있다.
      expect(button('수정')).toBeNull();
    });

    // 목록을 실제로 다시 불렀다 — 조회 · 제출 · 재조회.
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

  /**
   * 다시 부르는 것까지 실패한 경우. 「다시 불러왔습니다」라고 적어 두면 학생은 지금 화면이
   * 최신이라고 믿는다 — 못 불러왔다고 말하고 되돌릴 길을 준다.
   */
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
      // 못 불러온 목록은 그대로 두지 않는다 — 되돌릴 길만 남는다.
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

  /**
   * 마감·권한처럼 상태가 낡아서 나는 것이 아닌 실패는 지금처럼 문구만 보여 준다. 여기까지
   * 다시 부르면 학생이 적어 둔 내용이 이유 없이 사라진다.
   */
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
    // 적어 둔 내용은 그대로 남는다.
    expect(submissionInput()?.value).toBe('고쳐서 다시 냅니다.');
  });

  it('제출 성공 뒤 목록과 이력 첫 페이지를 다시 읽어 현재 제출본을 표시한다', async () => {
    const refreshed = documentWithViewer({
      submitted: true,
      submittedAt: '2026-08-03T00:00:00.000Z',
      revision: 3,
      status: 'SUBMITTED',
      hasCurrentFile: false,
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
      expect(container.textContent).toContain('재검토 대기');
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

    await act(async () => button('최신 상태 다시 불러오기')?.click());
    await vi.waitFor(() => {
      expect(container.textContent).toContain('재검토 대기');
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

    await act(async () => {
      root.render(
        <MilestoneDocumentSection
          milestoneId="milestone-1"
          viewerRole="STUDENT"
          closed={false}
          applicationStatus="APPROVED"
        />,
      );
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
      await act(async () => {
        row
          .querySelector<HTMLButtonElement>('button')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      const input = row.querySelector<HTMLTextAreaElement>('textarea');
      if (input === null) throw new TypeError(`Missing input: ${name}`);
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      await act(async () => {
        setter?.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    await act(async () => {
      for (const row of rows) {
        row
          .querySelector('form')
          ?.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
          );
      }
    });

    await vi.waitFor(() => expect(getCount).toBe(2));
    await act(async () => {
      resolveQuiet(jsonResponse(documentListBody([refreshedFirst, second])));
    });
    await vi.waitFor(() => expect(getCount).toBe(3));
    await act(async () => {
      resolveConflict(
        jsonResponse(documentListBody([refreshedFirst, approvedSecond])),
      );
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain('재검토 대기');
      expect(container.textContent).toContain(
        '승인된 제출 항목은 다시 제출할 수 없습니다.',
      );
    });
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(2);
  });
});

/**
 * 학생 행의 판정 표시. 실제 DOM에서 확인하는 이유는 **없어야 할 것이 없는지**를 묻기
 * 때문이다 — 마크업 문자열을 `not.toContain('수정')`으로 훑으면 다른 자리의 같은 글자에
 * 걸려 조용히 통과하거나, 반대로 버튼이 남아 있어도 못 잡는다.
 */
describe('학생 행이 판정을 읽는 방식', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
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
      review: null,
      history: { hasHistory: false, isComplete: true },
      ...overrides,
    };
  }

  /**
   * `applicationStatus`의 기본값은 승인이다 — 이 describe의 나머지 검사는 전부 **정상
   * 참여자**의 화면을 보고 있고, 되돌려진 신청은 아래 전용 검사에서만 다룬다.
   */
  async function renderRow(
    viewerSubmission: MilestoneDocumentViewerSubmission,
    closed = false,
    applicationStatus: ApplicationStatus | null = 'APPROVED',
  ) {
    await act(async () => {
      root.render(
        <MilestoneDocumentSectionBody
          key={`${viewerSubmission.submitted}-${viewerSubmission.status}-${closed}-${applicationStatus}`}
          state={{
            kind: 'ready',
            documents: [{ ...milestoneDocument, viewerSubmission }],
            fileUpload: milestoneDocumentUploadPolicy(),
          }}
          viewerRole="STUDENT"
          closed={closed}
          applicationStatus={applicationStatus}
          conflictNotice={null}
          onRetry={() => {}}
          onDocumentChange={() => {}}
          onSubmitConflict={() => {}}
        />,
      );
    });
  }

  function buttonTexts(): readonly string[] {
    return Array.from(container.querySelectorAll('button')).map(
      (button) => button.textContent?.trim() ?? '',
    );
  }

  /** 잠김은 문자열이 아니라 **그 버튼의 DOM boolean**으로 본다. */
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
    await act(async () => actionButton('이전 이력 더 보기').click());
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
      expect(container.textContent).toContain('이관 전 제출 이력 일부');
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
      expect(container.textContent).toContain('이관 전 제출 이력 일부');
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

    await act(async () => actionButton('다시 시도').click());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      container.querySelector(
        '[data-testid="milestone-document-history-error"]',
      ),
    ).toBeNull();
  });

  /**
   * 변이 검증 대상 3 — 사유 표시가 사라지면 여기가 깨진다. 사유가 없으면 학생은 배지만
   * 보고 「안 됐구나」까지만 읽고 닫고, 같은 서류가 같은 이유로 또 되돌아온다.
   */
  it('보완 요청·반려는 사유를 날짜와 함께 경고 톤으로 보여 준다', async () => {
    await renderRow(
      viewer({
        status: 'CHANGES_REQUESTED',
        review: {
          comment: '표지의 이름이 신청서와 다릅니다.',
          reviewedAt: '2026-08-02T01:20:00.000Z',
        },
      }),
    );

    const box = notice();
    expect(box).not.toBeNull();
    expect(box?.textContent).toContain('표지의 이름이 신청서와 다릅니다.');
    expect(box?.textContent).toContain('보완 요청');
    expect(box?.textContent).toContain('2026년 8월 2일');
    // 경고 톤이어야 눈에 띈다 — 평범한 회색 문단이면 학생이 지나친다.
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
        },
      }),
    );

    expect(notice()?.textContent).toContain('제출 기한을 두 주 넘겼습니다.');
  });

  /**
   * 변이 검증 대상 1 — 승인 사유 표시가 사라지면 여기가 깨진다.
   *
   * 판정 폼은 사유 칸에 「학생에게 그대로 보입니다」라고 적어 두고 **승인에도** 사유를
   * 받는다. 그런데 승인만 상자를 안 그리면 교직원이 적은 「잘 받았습니다, 다음 단계
   * 안내드릴게요」는 학생에게 닿지 않는다 — 화면이 약속한 것을 안 지키는 상태다.
   */
  it('승인에 적은 사유도 날짜와 함께 학생에게 보인다', async () => {
    await renderRow(
      viewer({
        status: 'APPROVED',
        review: {
          comment: '잘 받았습니다. 다음 단계는 개별로 안내드릴게요.',
          reviewedAt: '2026-08-02T01:20:00.000Z',
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

  // 되돌려 보내는 말이 아니다 — 같은 빨간 상자에 담으면 승인인데 문제가 있는 것처럼 읽힌다.
  it('승인 사유는 경고 톤으로 키우지 않는다', async () => {
    await renderRow(
      viewer({
        status: 'APPROVED',
        review: {
          comment: '수고했습니다.',
          reviewedAt: '2026-08-02T01:20:00.000Z',
        },
      }),
    );

    expect(notice()?.closest('[data-slot="alert"]')?.className).not.toContain(
      'text-destructive',
    );
  });

  // 승인은 사유가 선택이다 — 비면 배지가 이미 말한 「승인」 아래 빈 상자만 남는다.
  it('사유 없는 승인에는 상자를 세우지 않는다', async () => {
    await renderRow(
      viewer({
        status: 'APPROVED',
        review: { comment: null, reviewedAt: '2026-08-02T01:20:00.000Z' },
      }),
    );

    expect(notice()).toBeNull();
  });

  /**
   * 변이 검증 대상 2 — 「보완 요청일 때만 재제출」이 항상 허용으로 바뀌면 여기가 깨진다.
   * 승인·반려된 서류에 제출 칸이 열려 있으면 눌러 봐야 409(MSD_023)만 돌아온다.
   */
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
    await act(async () => actionButton('수정').click());
    expect(container.querySelector('input[type="file"]')).not.toBeNull();

    await renderRow(viewer({ status: 'SUBMITTED' }));
    expect(buttonTexts()).toContain('수정');

    await renderRow(
      viewer({ submitted: false, submittedAt: null, status: null }),
    );
    expect(buttonTexts()).toContain('올리기');
  });

  /**
   * 마감이 지난 마일스톤. 교직원이 마감 **뒤에** 「고쳐서 다시 내세요」라고 하는 것은 흔한
   * 일이라, 화면이 그 항목까지 잠그면 학생은 요청받은 재제출을 낼 방법이 없다 — 서버는
   * 받아 주는데 화면만 막는 상태가 된다.
   */
  it('마감이 지나도 보완 요청은 다시 낼 수 있다', async () => {
    await renderRow(viewer({ status: 'CHANGES_REQUESTED' }), true);
    const editButton = actionButton('수정');
    expect(editButton.disabled).toBe(false);
    await act(async () => editButton.click());
    expect(
      container.querySelector(
        'textarea[placeholder="제출할 내용이나 설명을 적어 주세요."]',
      ),
    ).not.toBeNull();
  });

  /**
   * 마감이 푸는 것은 보완 요청 하나뿐이다. 미제출·검토 대기까지 열면 마감이 아무것도
   * 막지 않는 표시가 된다 — 마감 전 교체와 마감 뒤 재제출은 다른 일이다.
   */
  it('마감 뒤 미제출·검토 대기는 그대로 잠근다', async () => {
    await renderRow(
      viewer({ submitted: false, submittedAt: null, status: null }),
      true,
    );
    expect(actionButton('올리기').disabled).toBe(true);

    await renderRow(viewer({ status: 'SUBMITTED' }), true);
    expect(actionButton('수정').disabled).toBe(true);
  });

  // 마감 전에는 예전 그대로다 — 마감 규칙을 고치면서 평상시를 함께 흔들지 않는다.
  it('마감 전에는 검토 대기도 잠기지 않는다', async () => {
    await renderRow(viewer({ status: 'SUBMITTED' }));

    expect(actionButton('수정').disabled).toBe(false);
  });

  /**
   * #1206 — 교직원이 승인을 되돌리면(APPROVED → SUBMITTED) 제출 행은 그대로 남아 이 줄이
   * 계속 「수정」을 내놓지만, 눌러서 내면 서버가 403(MSD_006 「승인된 신청만 제출할 수
   * 있습니다」)으로 거절한다. 화면이 할 수 없는 일을 제안하는 자리다.
   *
   * 잠근 버튼을 남기지 않고 **자리를 비운다** — 눌리지 않는 항목을 굳이 보여 주면 화면만
   * 복잡해진다는 판단이 이미 있었다(#1099 → PR #1200). 왜 못 내는지는 바로 위 마일스톤
   * 머리줄이 이미 말한다(`components/milestone-row.tsx`).
   */
  it('되돌려진 신청의 제출 줄에서는 「수정」을 내놓지 않는다', async () => {
    await renderRow(viewer({ status: 'SUBMITTED' }), false, 'SUBMITTED');

    expect(buttonTexts()).not.toContain('수정');
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(
      container.querySelector(
        'textarea[placeholder="제출할 내용이나 설명을 적어 주세요."]',
      ),
    ).toBeNull();
  });

  /** 보완 요청을 받아 둔 줄도 같다 — 되돌려진 동안에는 그 요청에 답할 수 없다. */
  it('되돌려진 신청에서는 보완 요청 줄의 「수정」도 걷는다', async () => {
    await renderRow(
      viewer({ status: 'CHANGES_REQUESTED' }),
      false,
      'SUBMITTED',
    );

    expect(buttonTexts()).not.toContain('수정');
  });

  /**
   * 대조 — 이 검사가 함께 서 있지 않으면 「수정」을 아무에게나 지우는 변경도 위 검사를
   * 통과한다. 승인된 학생의 재제출은 이 티켓의 「하지 않을 것」이다.
   */
  it('승인된 신청의 「수정」은 그대로 둔다', async () => {
    await renderRow(viewer({ status: 'SUBMITTED' }), false, 'APPROVED');
    expect(buttonTexts()).toContain('수정');
    expect(actionButton('수정').disabled).toBe(false);

    await renderRow(viewer({ status: 'CHANGES_REQUESTED' }), false, 'APPROVED');
    expect(buttonTexts()).toContain('수정');
  });

  /**
   * 아직 한 번도 내지 않은 줄의 「올리기」는 건드리지 않는다. 그 상태(미신청·승인 대기)의
   * 제출 조작 노출은 #1098이 신청 판정을 머리줄과 서류 줄에 함께 나눠 주는 방식으로 따로
   * 다루는 자리라, 여기서 함께 지우면 같은 화면을 두 규칙이 서로 다르게 고치게 된다.
   */
  it('되돌려진 신청이어도 미제출 줄의 「올리기」는 이 티켓이 다루지 않는다', async () => {
    await renderRow(
      viewer({ submitted: false, submittedAt: null, status: null }),
      false,
      'SUBMITTED',
    );

    expect(buttonTexts()).toContain('올리기');
  });

  it('통합 제출도 승인되면 입력 칸이 열리지 않는다', async () => {
    await renderRow(viewer({ status: 'CHANGES_REQUESTED' }));
    const editButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '수정',
    );
    if (!(editButton instanceof HTMLButtonElement)) {
      throw new TypeError('수정 버튼을 찾지 못했습니다.');
    }
    await act(async () => editButton.click());
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

/*
 * #1107 — 교직원 「양식 올리기」에도 accept도 사전 검사도 없어, 상한을 넘은 파일이 그대로
 * 전송되고 화면에는 「API 오류 응답이 ProblemDetail 형식이 아닙니다.」가 떴다. 학생 제출과
 * 같은 기준을 따라야 한다.
 */
describe('교직원 양식 올리기의 사전 검사', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderStaffRow() {
    await act(async () => {
      root.render(
        <MilestoneDocumentSectionBody
          state={{
            kind: 'ready',
            documents: [milestoneDocument],
            fileUpload: milestoneDocumentUploadPolicy(),
          }}
          viewerRole="STAFF"
          closed={false}
          applicationStatus={null}
          conflictNotice={null}
          onRetry={() => {}}
          onDocumentChange={() => {}}
          onSubmitConflict={() => {}}
        />,
      );
    });
  }

  function fileInput(): HTMLInputElement {
    const element = container.querySelector('input[type="file"]');
    if (!(element instanceof HTMLInputElement))
      throw new TypeError('Missing file input.');
    return element;
  }

  async function select(name: string, size: number) {
    const input = fileInput();
    const candidate = new File(['synthetic'], name);
    Object.defineProperty(candidate, 'size', {
      configurable: true,
      value: size,
    });
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [candidate],
    });
    await act(async () =>
      input.dispatchEvent(new Event('change', { bubbles: true })),
    );
  }

  it('고르기 전에 학생 제출과 같은 안내를 보여 주고 형식을 제한한다', async () => {
    await renderStaffRow();

    expect(container.textContent).toContain(
      'PDF, HWP, JPG, PNG, ZIP · 최대 5 MB',
    );
    expect(fileInput().getAttribute('accept')).toBe(
      '.pdf,.hwp,.jpg,.jpeg,.png,.zip',
    );
  });

  it('상한을 넘은 파일은 요청을 내보내지 않고 사유를 말한다', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await renderStaffRow();

    await select('양식.pdf', 5 * 1024 * 1024 + 1);

    expect(fetchMock).not.toHaveBeenCalled();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('파일은 5 MB 이하여야 합니다.');
    expect(alert?.textContent).not.toContain('ProblemDetail');
  });

  it('허용 형식 밖의 파일도 요청 전에 걸러진다', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await renderStaffRow();

    await select('설치.exe', 10);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'PDF, HWP, JPG, PNG, ZIP 파일만 선택할 수 있습니다.',
    );
  });

  /*
   * 사전 검사를 지나온 실패도 남는다 — 그때 서버가 ProblemDetail을 주지 못하면 화면은
   * 개발자용 문장이 아니라 이 화면의 문구를 말해야 한다.
   */
  it('ProblemDetail이 아닌 실패에도 개발자용 문장을 붙이지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>413 Request Entity Too Large</html>', {
          status: 413,
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    );
    await renderStaffRow();

    await select('양식.pdf', 1024);

    await vi.waitFor(() => {
      const alert = container.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain('양식 업로드에 실패했습니다.');
    });
    expect(container.textContent).not.toContain('ProblemDetail');
  });
});
