// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MilestoneDocumentSection,
  MilestoneDocumentSectionBody,
} from './milestone-document-list';
import type {
  MilestoneDocument,
  MilestoneDocumentViewerSubmission,
} from './milestone-document-api';

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
  submissionType: 'FILE',
  hasTemplateFile: false,
};

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
      .mockResolvedValueOnce(jsonResponse([milestoneDocument]));
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root.render(
        <MilestoneDocumentSection
          milestoneId="milestone-1"
          viewerRole="STAFF"
          closed={false}
        />,
      );
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain(
        '제출 서류를 불러오지 못했습니다.',
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
  });

  function viewer(
    overrides: Partial<MilestoneDocumentViewerSubmission>,
  ): MilestoneDocumentViewerSubmission {
    return {
      submitted: true,
      submittedAt: '2026-08-01T05:22:00.000Z',
      status: 'SUBMITTED',
      review: null,
      ...overrides,
    };
  }

  async function renderRow(
    viewerSubmission: MilestoneDocumentViewerSubmission,
    submissionType: MilestoneDocument['submissionType'] = 'FILE',
  ) {
    await act(async () => {
      root.render(
        <MilestoneDocumentSectionBody
          state={{
            kind: 'ready',
            documents: [
              { ...milestoneDocument, submissionType, viewerSubmission },
            ],
          }}
          viewerRole="STUDENT"
          closed={false}
          onRetry={() => {}}
          onDocumentChange={() => {}}
        />,
      );
    });
  }

  function buttonTexts(): readonly string[] {
    return Array.from(container.querySelectorAll('button')).map(
      (button) => button.textContent?.trim() ?? '',
    );
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

  // 승인에 붙은 사유는 되돌려 보내는 말이 아니다 — 경고 상자로 키우면 승인이 반려처럼 읽힌다.
  it('승인은 사유가 있어도 경고 상자를 띄우지 않는다', async () => {
    await renderRow(
      viewer({
        status: 'APPROVED',
        review: {
          comment: '수고했습니다.',
          reviewedAt: '2026-08-02T01:20:00.000Z',
        },
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
      '승인된 서류는 다시 제출할 수 없습니다.',
    );

    await renderRow(viewer({ status: 'REJECTED' }));
    expect(buttonTexts()).not.toContain('수정');
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.textContent).toContain(
      '반려된 서류는 다시 제출할 수 없습니다.',
    );
  });

  it('보완 요청·검토 대기·미제출에는 제출 입력을 연다', async () => {
    await renderRow(viewer({ status: 'CHANGES_REQUESTED' }));
    expect(buttonTexts()).toContain('수정');
    expect(container.querySelector('input[type="file"]')).not.toBeNull();

    await renderRow(viewer({ status: 'SUBMITTED' }));
    expect(buttonTexts()).toContain('수정');

    await renderRow(
      viewer({ submitted: false, submittedAt: null, status: null }),
    );
    expect(buttonTexts()).toContain('올리기');
  });

  // TEXT 제출도 같은 규칙을 따라야 한다 — 유형마다 다르면 학생이 규칙을 못 읽는다.
  it('텍스트 제출도 승인되면 입력 칸이 열리지 않는다', async () => {
    await renderRow(viewer({ status: 'CHANGES_REQUESTED' }), 'TEXT');
    const editButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '수정',
    );
    if (!(editButton instanceof HTMLButtonElement)) {
      throw new TypeError('수정 버튼을 찾지 못했습니다.');
    }
    await act(async () => editButton.click());
    expect(
      container.querySelector('input[placeholder="제출 내용"]'),
    ).not.toBeNull();

    await renderRow(viewer({ status: 'APPROVED' }), 'TEXT');
    expect(buttonTexts()).not.toContain('수정');
    expect(
      container.querySelector('input[placeholder="제출 내용"]'),
    ).toBeNull();
  });
});
