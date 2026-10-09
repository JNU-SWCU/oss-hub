import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { MilestoneDocumentCollectionScreen } from './milestone-document-collection-screen';
import type {
  MilestoneDocumentCollection,
  MilestoneDocumentCollectionCell,
  MilestoneDocumentCollectionRow,
} from './milestone-document-collection-api';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const {
  getMilestoneDocumentCollectionMock,
  getMilestoneDocumentHistoryMock,
  createMilestoneDocumentReviewMock,
} = vi.hoisted(() => ({
  getMilestoneDocumentCollectionMock: vi.fn(),
  getMilestoneDocumentHistoryMock: vi.fn(),
  createMilestoneDocumentReviewMock: vi.fn(),
}));

vi.mock('./milestone-document-collection-api', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('./milestone-document-collection-api')
  >()),
  getMilestoneDocumentCollection: getMilestoneDocumentCollectionMock,
  getMilestoneDocumentHistory: getMilestoneDocumentHistoryMock,
}));
vi.mock('./milestone-document-review-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./milestone-document-review-api')>()),
  createMilestoneDocumentReview: createMilestoneDocumentReviewMock,
}));

function cell(
  documentId: string,
  overrides: Partial<MilestoneDocumentCollectionCell> = {},
): MilestoneDocumentCollectionCell {
  return {
    documentId,
    isSubmitted: true,
    status: 'SUBMITTED',
    revision: 1,
    submittedAt: '2026-07-28T00:00:00.000Z',
    file: null,
    content: null,
    review: null,
    ...overrides,
  };
}

function row(
  applicationId: string,
  teamName: string,
  cells: readonly MilestoneDocumentCollectionCell[],
): MilestoneDocumentCollectionRow {
  return {
    applicationId,
    deliveryStatus: 'MISSING',
    teamName,
    applicantName: '김철수',
    memberNicknames: ['chulsoo'],
    cells,
  };
}

function collection(
  rows: readonly MilestoneDocumentCollectionRow[],
  overrides: Partial<MilestoneDocumentCollection> = {},
): MilestoneDocumentCollection {
  return {
    milestone: {
      id: 'milestone-1',
      programId: 'program-capstone',
      name: '기획서 제출',
      dueAt: '2026-07-15T14:59:59.000Z',
    },
    documents: [
      {
        id: 'd1',
        name: '기획서',
        isRequired: true,
        sortOrder: 1,
      },
      {
        id: 'd2',
        name: '중간 보고',
        isRequired: false,
        sortOrder: 2,
      },
    ],
    rows,
    page: 1,
    pageSize: 20,
    total: rows.length,
    deliveryCounts: { missing: 12, late: 10, complete: 20, noRequiredItems: 5 },
    filterCounts: { all: 47, hasMissing: 12, zeroSubmission: 5 },
    documentTotals: [
      { documentId: 'd1', submitted: 30, total: 47 },
      { documentId: 'd2', submitted: 12, total: 47 },
    ],
    ...overrides,
  };
}

const dueAtInput = '2027-06-30T18:00';

const dueAtSentToServer = '2027-06-30T09:00:00.000Z';

describe('수합 표에서 판정하기', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = window.document.createElement('div');
    window.document.body.append(container);
    root = createRoot(container);
    getMilestoneDocumentCollectionMock.mockReset();
    getMilestoneDocumentHistoryMock.mockReset();
    getMilestoneDocumentHistoryMock.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    createMilestoneDocumentReviewMock.mockReset();
  });

  afterEach(async () => {
    await act(() => Promise.resolve(root.unmount()));
    container.remove();
  });

  async function render() {
    await act(() => {
      root.render(
        <MilestoneDocumentCollectionScreen
          programId="program-capstone"
          milestoneId="milestone-1"
        />,
      );
      return Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  function buttons(): readonly HTMLButtonElement[] {
    return Array.from(container.querySelectorAll('button'));
  }

  function findButton(
    match: (button: HTMLButtonElement) => boolean,
    what: string,
  ) {
    const found = buttons().find(match);
    if (!(found instanceof HTMLButtonElement)) {
      throw new TypeError(`버튼을 찾지 못했습니다: ${what}`);
    }
    return found;
  }

  function byLabel(label: string): HTMLButtonElement {
    return findButton(
      (button) => button.getAttribute('aria-label') === label,
      label,
    );
  }

  function byText(text: string): HTMLButtonElement {
    return findButton((button) => button.textContent?.trim() === text, text);
  }

  async function click(button: HTMLButtonElement) {
    await act(() => {
      button.click();
      return Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  function panel(): HTMLElement | null {
    return container.querySelector(
      '[data-testid="milestone-document-review-panel"]',
    );
  }

  function typeComment(value: string) {
    const textarea = container.querySelector('textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new TypeError('사유 입력 칸을 찾지 못했습니다.');
    }

    const descriptor = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    );
    descriptor?.set?.call(textarea, value);
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
  }

  function typeResubmissionDueAt(value: string) {
    const input = container.querySelector('input[type="datetime-local"]');
    if (input === null) {
      throw new TypeError('재제출 기한 칸을 찾지 못했습니다.');
    }
    const descriptor = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    );
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  }

  async function openPanelForGaTeam() {
    getMilestoneDocumentCollectionMock.mockResolvedValue(
      collection([row('a', '가팀', [cell('d1'), cell('d2')])]),
    );
    await render();
    await click(byLabel('가팀 기획서 검토'));
  }

  it('제출된 칸을 누르면 표를 떠나지 않고 그 자리에서 판정이 열린다', async () => {
    await openPanelForGaTeam();

    const opened = panel();
    expect(opened).not.toBeNull();
    expect(opened?.textContent).toContain('가팀 — 기획서');

    expect(opened?.closest('table')).not.toBeNull();

    expect(container.textContent).toContain('합계');
  });

  it('첫 이력 조회가 실패해도 패널을 닫지 않고 다시 불러온다', async () => {
    getMilestoneDocumentCollectionMock.mockResolvedValue(
      collection([row('a', '가팀', [cell('d1'), cell('d2')])]),
    );
    getMilestoneDocumentHistoryMock
      .mockRejectedValueOnce(new Error('temporary history failure'))
      .mockResolvedValueOnce({
        items: [
          {
            event: 'SUBMITTED',
            revision: 1,
            actorNickname: 'student-a',
            comment: null,
            createdAt: '2026-07-28T00:00:00.000Z',
            fileName: '기획서-v1.pdf',
          },
        ],
        nextCursor: null,
      });
    await render();

    await click(byLabel('가팀 기획서 검토'));
    await settle();
    expect(panel()?.textContent).toContain('제출 이력을 불러오지 못했습니다.');
    expect(getMilestoneDocumentHistoryMock).toHaveBeenLastCalledWith(
      'milestone-1',
      'd1',
      'a',
      null,
    );

    await click(byText('제출 이력 다시 불러오기'));
    await settle();

    expect(getMilestoneDocumentHistoryMock).toHaveBeenCalledTimes(2);
    expect(getMilestoneDocumentHistoryMock).toHaveBeenLastCalledWith(
      'milestone-1',
      'd1',
      'a',
      null,
    );
    expect(panel()).not.toBeNull();
    expect(panel()?.textContent).toContain('첫 제출');
    expect(panel()?.textContent).toContain('기획서-v1.pdf');
  });

  it('같은 칸을 다시 누르면 닫힌다', async () => {
    await openPanelForGaTeam();
    expect(panel()).not.toBeNull();

    await click(byLabel('가팀 기획서 검토'));

    expect(panel()).toBeNull();
  });

  it('미제출 칸은 누를 수 없다', async () => {
    getMilestoneDocumentCollectionMock.mockResolvedValue(
      collection([
        row('a', '가팀', [
          cell('d1', { isSubmitted: false, status: null, submittedAt: null }),
          cell('d2'),
        ]),
      ]),
    );
    await render();

    expect(
      buttons().some(
        (button) => button.getAttribute('aria-label') === '가팀 기획서 검토',
      ),
    ).toBe(false);
    expect(
      buttons().some(
        (button) => button.getAttribute('aria-label') === '가팀 중간 보고 검토',
      ),
    ).toBe(true);
  });

  it('보완 요청에 사유가 없으면 보내지 않고 그 자리에서 막는다', async () => {
    await openPanelForGaTeam();

    await click(byText('보완 요청'));
    await click(byText('저장'));

    expect(createMilestoneDocumentReviewMock).not.toHaveBeenCalled();
    expect(panel()?.textContent).toContain(
      '보완 요청과 반려는 사유를 입력해 주세요.',
    );

    expect(panel()?.textContent).toContain('가팀 — 기획서');
  });

  it('판정을 고르지 않고 저장하면 고르라고 말한다', async () => {
    await openPanelForGaTeam();

    await click(byText('저장'));

    expect(createMilestoneDocumentReviewMock).not.toHaveBeenCalled();
    expect(panel()?.textContent).toContain(
      '승인, 보완 요청, 반려 중 하나를 골라 주세요.',
    );
  });

  it('승인은 사유 없이 저장한다', async () => {
    await openPanelForGaTeam();
    createMilestoneDocumentReviewMock.mockResolvedValue({
      id: 'r1',
      decision: 'APPROVED',
      comment: null,
      reviewedAt: '2026-08-01T00:00:00.000Z',
      resubmissionDueAt: null,
      reviewerNickname: '교직원',
    });

    await click(byText('승인'));
    await click(byText('저장'));

    expect(createMilestoneDocumentReviewMock).toHaveBeenCalledWith(
      'milestone-1',
      'd1',
      'a',
      {
        decision: 'APPROVED',
        comment: undefined,

        expectedRevision: 1,
        expectedLatestReviewId: null,
      },
    );
  });

  it('지난 판정이 있는 칸은 그 판정 id를 함께 보낸다', async () => {
    getMilestoneDocumentCollectionMock.mockResolvedValue(
      collection([
        row('a', '가팀', [
          cell('d1', {
            status: 'CHANGES_REQUESTED',
            review: {
              id: 'review-42',
              decision: 'CHANGES_REQUESTED',
              comment: '표지를 고쳐 주세요.',
              reviewedAt: '2026-07-29T00:00:00.000Z',
              resubmissionDueAt: null,
            },
          }),
          cell('d2'),
        ]),
      ]),
    );
    await render();
    createMilestoneDocumentReviewMock.mockResolvedValue({
      id: 'r2',
      decision: 'APPROVED',
      comment: null,
      reviewedAt: '2026-08-01T00:00:00.000Z',
      resubmissionDueAt: null,
      reviewerNickname: '교직원',
    });

    await click(byLabel('가팀 기획서 검토'));
    await click(byText('승인'));
    await click(byText('저장'));

    expect(createMilestoneDocumentReviewMock).toHaveBeenCalledWith(
      'milestone-1',
      'd1',
      'a',
      {
        decision: 'APPROVED',
        comment: undefined,
        expectedRevision: 1,
        expectedLatestReviewId: 'review-42',
      },
    );
  });

  it('사유를 적은 보완 요청은 마일스톤·서류·신청 id와 함께 보낸다', async () => {
    await openPanelForGaTeam();
    createMilestoneDocumentReviewMock.mockResolvedValue({
      id: 'r1',
      decision: 'CHANGES_REQUESTED',
      comment: '표지를 고쳐 주세요.',
      reviewedAt: '2026-08-01T00:00:00.000Z',
      resubmissionDueAt: null,
      reviewerNickname: '교직원',
    });

    await click(byText('보완 요청'));
    await act(() => {
      typeComment('  표지를 고쳐 주세요.  ');

      typeResubmissionDueAt(dueAtInput);
      return Promise.resolve();
    });
    await click(byText('저장'));

    expect(createMilestoneDocumentReviewMock).toHaveBeenCalledWith(
      'milestone-1',
      'd1',
      'a',
      {
        decision: 'CHANGES_REQUESTED',
        comment: '표지를 고쳐 주세요.',

        resubmissionDueAt: dueAtSentToServer,
        expectedRevision: 1,
        expectedLatestReviewId: null,
      },
    );
  });

  it('재제출 기한 없는 보완 요청은 보내지 않고 무엇이 빠졌는지 말한다', async () => {
    await openPanelForGaTeam();

    await click(byText('보완 요청'));
    await act(() => {
      typeComment('표지를 고쳐 주세요.');
      return Promise.resolve();
    });
    await click(byText('저장'));

    expect(createMilestoneDocumentReviewMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      '보완 요청은 재제출 기한을 정해 주세요.',
    );
  });

  it('저장에 성공하면 패널을 닫고 같은 조건으로 표를 다시 부른다', async () => {
    await openPanelForGaTeam();
    createMilestoneDocumentReviewMock.mockResolvedValue({
      id: 'r1',
      decision: 'APPROVED',
      comment: null,
      reviewedAt: '2026-08-01T00:00:00.000Z',
      resubmissionDueAt: null,
      reviewerNickname: '교직원',
    });
    const loadsBefore = getMilestoneDocumentCollectionMock.mock.calls.length;

    await click(byText('승인'));
    await click(byText('저장'));

    expect(panel()).toBeNull();
    expect(getMilestoneDocumentCollectionMock.mock.calls.length).toBe(
      loadsBefore + 1,
    );
    expect(getMilestoneDocumentCollectionMock).toHaveBeenLastCalledWith(
      'milestone-1',
      { page: 1, pageSize: 20, filter: 'ALL' },
    );
  });

  it('보내는 동안에는 저장 버튼이 실제로 잠긴다', async () => {
    await openPanelForGaTeam();
    let release: (() => void) | null = null;
    createMilestoneDocumentReviewMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              id: 'r1',
              decision: 'APPROVED',
              comment: null,
              reviewedAt: '2026-08-01T00:00:00.000Z',
              resubmissionDueAt: null,
              reviewerNickname: '교직원',
            });
        }),
    );

    await click(byText('승인'));
    await click(byText('저장'));

    expect(byText('저장 중…').disabled).toBe(true);
    expect(createMilestoneDocumentReviewMock).toHaveBeenCalledTimes(1);

    await act(() => {
      release?.();
      return Promise.resolve();
    });
  });

  it('그 사이 판정이 바뀌었다는 409는 문구와 함께 표를 다시 부른다', async () => {
    await openPanelForGaTeam();
    createMilestoneDocumentReviewMock.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: '제출하는 사이에 교직원 검토 결과가 등록되었습니다.',
        instance: '/x',
        code: 'MSD_024',
      }),
    );
    const loadsBefore = getMilestoneDocumentCollectionMock.mock.calls.length;

    await click(byText('승인'));
    await click(byText('저장'));

    expect(panel()?.textContent).toContain(
      '제출하는 사이에 교직원 검토 결과가 등록되었습니다.',
    );
    expect(getMilestoneDocumentCollectionMock.mock.calls.length).toBe(
      loadsBefore + 1,
    );
  });

  it('사유 필수 422는 문구만 띄우고 표를 다시 부르지 않는다', async () => {
    await openPanelForGaTeam();
    createMilestoneDocumentReviewMock.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Unprocessable Entity',
        status: 422,
        detail: '보완 요청과 반려는 사유를 입력해 주세요.',
        instance: '/x',
        code: 'MSD_021',
      }),
    );
    const loadsBefore = getMilestoneDocumentCollectionMock.mock.calls.length;

    await click(byText('승인'));
    await click(byText('저장'));

    expect(panel()?.textContent).toContain(
      '보완 요청과 반려는 사유를 입력해 주세요.',
    );
    expect(getMilestoneDocumentCollectionMock.mock.calls.length).toBe(
      loadsBefore,
    );
  });

  it('필터를 바꾸면 열어 둔 판정을 닫는다', async () => {
    await openPanelForGaTeam();
    expect(panel()).not.toBeNull();

    await click(byText('미제출 있음 12팀'));

    expect(panel()).toBeNull();
  });

  it('보내는 중에 필터를 바꿔도, 버려진 성공은 지금 조건으로 표를 다시 부른다', async () => {
    await openPanelForGaTeam();
    let release: (() => void) | null = null;
    createMilestoneDocumentReviewMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              id: 'r1',
              decision: 'APPROVED',
              comment: null,
              reviewedAt: '2026-08-01T00:00:00.000Z',
              resubmissionDueAt: null,
              reviewerNickname: '교직원',
            });
        }),
    );

    await click(byText('승인'));
    await click(byText('저장'));
    await click(byText('미제출 있음 12팀'));
    const loadsAfterFilter =
      getMilestoneDocumentCollectionMock.mock.calls.length;

    await act(() => {
      release?.();
      return Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(getMilestoneDocumentCollectionMock.mock.calls.length).toBe(
      loadsAfterFilter + 1,
    );

    expect(getMilestoneDocumentCollectionMock).toHaveBeenLastCalledWith(
      'milestone-1',
      { page: 1, pageSize: 20, filter: 'HAS_MISSING' },
    );
  });

  it('버려진 응답이 실패였으면 표를 다시 부르지 않는다', async () => {
    await openPanelForGaTeam();
    let reject: (() => void) | null = null;
    createMilestoneDocumentReviewMock.mockImplementation(
      () =>
        new Promise((_resolve, rejectPromise) => {
          reject = () =>
            rejectPromise(
              new ApiError({
                type: 'about:blank',
                title: 'Internal Server Error',
                status: 500,
                detail: '알 수 없는 오류입니다.',
                instance: '/x',
                code: 'COM_001',
              }),
            );
        }),
    );

    await click(byText('승인'));
    await click(byText('저장'));
    await click(byText('미제출 있음 12팀'));
    const loadsAfterFilter =
      getMilestoneDocumentCollectionMock.mock.calls.length;

    await act(() => {
      reject?.();
      return Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(getMilestoneDocumentCollectionMock.mock.calls.length).toBe(
      loadsAfterFilter,
    );
  });

  it('보내는 중에 다른 칸을 열면 늦게 온 응답이 그 폼을 닫지 않는다', async () => {
    await openPanelForGaTeam();
    let release: (() => void) | null = null;
    createMilestoneDocumentReviewMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              id: 'r1',
              decision: 'APPROVED',
              comment: null,
              reviewedAt: '2026-08-01T00:00:00.000Z',
              resubmissionDueAt: null,
              reviewerNickname: '교직원',
            });
        }),
    );

    await click(byText('승인'));
    await click(byText('저장'));
    await click(byLabel('가팀 중간 보고 검토'));
    expect(panel()?.textContent).toContain('가팀 — 중간 보고');

    await act(() => {
      release?.();
      return Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(panel()).not.toBeNull();
    expect(panel()?.textContent).toContain('가팀 — 중간 보고');
  });

  function skeleton(): Element | null {
    return container.querySelector('[data-slot="skeleton"]');
  }

  function skeletonStatus(): Element | null {
    const status = container.querySelector('[role="status"]');
    return status?.textContent?.includes('서류 수합 표를 불러오는 중')
      ? status
      : null;
  }

  function tableBusy(): string | null {
    const busyBox = container.querySelector('table')?.closest('[aria-busy]');
    return busyBox?.getAttribute('aria-busy') ?? null;
  }

  function reviewNotice(): HTMLElement | null {
    return container.querySelector(
      '[data-testid="milestone-document-review-notice"]',
    );
  }

  function holdNextLoad(next: MilestoneDocumentCollection): () => void {
    let release: (() => void) | null = null;
    getMilestoneDocumentCollectionMock.mockImplementation(
      () =>
        new Promise<MilestoneDocumentCollection>((resolve) => {
          release = () => resolve(next);
        }),
    );
    return () => release?.();
  }

  async function settle() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('판정을 저장한 뒤 표를 다시 부르는 동안에도 표는 자리를 지킨다', async () => {
    await openPanelForGaTeam();
    createMilestoneDocumentReviewMock.mockResolvedValue({
      id: 'r1',
      decision: 'APPROVED',
      comment: null,
      reviewedAt: '2026-08-01T00:00:00.000Z',
      resubmissionDueAt: null,
      reviewerNickname: '교직원',
    });
    const release = holdNextLoad(
      collection([
        row('a', '가팀', [cell('d1', { status: 'APPROVED' }), cell('d2')]),
      ]),
    );

    await click(byText('승인'));
    await click(byText('저장'));

    expect(skeleton()).toBeNull();
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.textContent).toContain('가팀');
    expect(container.textContent).toContain('합계');

    expect(tableBusy()).toBe('true');

    await act(() => Promise.resolve(release()));
    await settle();

    expect(skeleton()).toBeNull();
    expect(tableBusy()).toBe('false');
  });

  async function expectTableSurvivesConflict(code: string) {
    await openPanelForGaTeam();
    createMilestoneDocumentReviewMock.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: '검토하는 사이에 제출물 또는 검토 결과가 바뀌었습니다.',
        instance: '/x',
        code,
      }),
    );
    const release = holdNextLoad(
      collection([row('a', '가팀', [cell('d1'), cell('d2')])]),
    );

    await click(byText('승인'));
    await click(byText('저장'));

    expect(skeleton()).toBeNull();
    expect(container.textContent).toContain('가팀');
    expect(tableBusy()).toBe('true');

    await act(() => Promise.resolve(release()));
    await settle();

    expect(skeleton()).toBeNull();
    expect(tableBusy()).toBe('false');
  }

  it('MSD_024 뒤의 재조회에도 표는 남는다', async () => {
    await expectTableSurvivesConflict('MSD_024');
  });

  it('MSD_025 뒤의 재조회에도 표는 남는다', async () => {
    await expectTableSurvivesConflict('MSD_025');
  });

  it('필터를 바꾼 조회 중에는 옛 표를 그대로 두지 않는다', async () => {
    await openPanelForGaTeam();
    const release = holdNextLoad(
      collection([row('b', '나팀', [cell('d1'), cell('d2')])]),
    );

    await click(byText('미제출 있음 12팀'));

    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).not.toContain('가팀');
    const loading = skeleton();
    expect(loading).not.toBeNull();
    expect(loading?.getAttribute('aria-busy')).toBe('true');
    const status = skeletonStatus();
    expect(status).not.toBeNull();
    expect(status?.closest('[aria-busy]')).toBeNull();

    await act(() => Promise.resolve(release()));
    await settle();

    expect(container.textContent).toContain('나팀');
  });

  it('페이지를 넘기는 동안에도 옛 표를 그대로 두지 않는다', async () => {
    getMilestoneDocumentCollectionMock.mockResolvedValue(
      collection([row('a', '가팀', [cell('d1'), cell('d2')])], { total: 40 }),
    );
    await render();
    const release = holdNextLoad(
      collection([row('b', '나팀', [cell('d1'), cell('d2')])], {
        page: 2,
        total: 40,
      }),
    );

    await click(byText('다음'));

    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).not.toContain('가팀');
    const loading = skeleton();
    expect(loading).not.toBeNull();
    expect(loading?.getAttribute('aria-busy')).toBe('true');
    const status = skeletonStatus();
    expect(status).not.toBeNull();
    expect(status?.closest('[aria-busy]')).toBeNull();

    await act(() => Promise.resolve(release()));
    await settle();

    expect(container.textContent).toContain('나팀');
  });

  it('칸의 배지는 지금 상태를 그대로 말한다', async () => {
    getMilestoneDocumentCollectionMock.mockResolvedValue(
      collection([
        row('a', '가팀', [
          cell('d1', {
            status: 'REJECTED',
            review: {
              id: 'review-1',
              decision: 'REJECTED',
              comment: '기한을 넘겼습니다.',
              reviewedAt: '2026-07-30T00:00:00.000Z',
              resubmissionDueAt: null,
            },
          }),
          cell('d2', {
            isSubmitted: false,
            status: null,
            submittedAt: null,
          }),
        ]),
      ]),
    );
    await render();

    const cells = Array.from(container.querySelectorAll('tbody td'));
    expect(cells[1]?.textContent).toContain('반려');
    expect(cells[2]?.textContent).toContain('미제출');
  });

  it('다시 낸 칸은 검토 대기로 돌아오고, 패널에 지난 보완 요청이 남는다', async () => {
    getMilestoneDocumentCollectionMock.mockResolvedValue(
      collection([
        row('a', '가팀', [
          cell('d1', {
            status: 'SUBMITTED',
            submittedAt: '2026-08-02T00:00:00.000Z',
            review: {
              id: 'review-2',
              decision: 'CHANGES_REQUESTED',
              comment: '표지의 이름이 신청서와 다릅니다.',
              reviewedAt: '2026-07-30T00:00:00.000Z',
              resubmissionDueAt: null,
            },
          }),
          cell('d2', { isSubmitted: false, status: null, submittedAt: null }),
        ]),
      ]),
    );
    await render();

    const cells = Array.from(container.querySelectorAll('tbody td'));
    expect(cells[1]?.textContent).toContain('검토 대기');
    expect(cells[1]?.textContent).not.toContain('보완 요청');

    await click(byLabel('가팀 기획서 검토'));

    expect(panel()?.textContent).toContain('지난 검토');
    expect(panel()?.textContent).toContain('표지의 이름이 신청서와 다릅니다.');
  });

  it('제출물이 바뀌었다는 409는 판정을 버리고 표를 되돌린 뒤 사실을 말한다', async () => {
    await openPanelForGaTeam();
    createMilestoneDocumentReviewMock.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail:
          '검토하는 사이에 제출물 또는 검토 결과가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.',
        instance: '/x',
        code: 'MSD_025',
      }),
    );
    const loadsBefore = getMilestoneDocumentCollectionMock.mock.calls.length;

    await click(byText('승인'));
    await click(byText('저장'));

    expect(panel()).toBeNull();
    expect(getMilestoneDocumentCollectionMock.mock.calls.length).toBe(
      loadsBefore + 1,
    );

    const notice = container.querySelector(
      '[data-testid="milestone-document-review-notice"]',
    );
    expect(notice).not.toBeNull();

    expect(notice?.textContent).toContain('저장하지 않았습니다');
    expect(notice?.textContent).toContain('다시 불러왔습니다');
    expect(notice?.textContent).toContain('다시 확인한 뒤 다시 검토해 주세요');

    expect(notice?.textContent).not.toContain(
      '제출하는 사이에 교직원 검토 결과가 등록되었습니다',
    );
  });

  async function holdReloadAfterConflict(code: string): Promise<() => void> {
    await openPanelForGaTeam();
    createMilestoneDocumentReviewMock.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: '검토하는 사이에 제출물 또는 검토 결과가 바뀌었습니다.',
        instance: '/x',
        code,
      }),
    );
    const release = holdNextLoad(
      collection([row('a', '가팀', [cell('d1'), cell('d2')])]),
    );
    await click(byText('승인'));
    await click(byText('저장'));
    return release;
  }

  async function failReloadAfterConflict(code: string) {
    await openPanelForGaTeam();
    createMilestoneDocumentReviewMock.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: '검토하는 사이에 제출물 또는 검토 결과가 바뀌었습니다.',
        instance: '/x',
        code,
      }),
    );
    getMilestoneDocumentCollectionMock.mockRejectedValue(
      new Error('네트워크가 끊겼습니다.'),
    );
    await click(byText('승인'));
    await click(byText('저장'));
    await settle();
  }

  it('재조회가 끝나기 전에는 다시 불러왔다고 말하지 않는다', async () => {
    const release = await holdReloadAfterConflict('MSD_025');

    expect(reviewNotice()).toBeNull();
    expect(container.textContent).toContain('가팀');
    expect(tableBusy()).toBe('true');

    await act(() => Promise.resolve(release()));
    await settle();

    expect(reviewNotice()?.textContent).toContain('다시 불러왔습니다');
    expect(tableBusy()).toBe('false');
  });

  it('재조회가 실패하면 낡은 표를 걷고 못 불러왔다고 말한다', async () => {
    await failReloadAfterConflict('MSD_025');

    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).not.toContain('가팀');

    expect(
      buttons().some(
        (button) => button.getAttribute('aria-label') === '가팀 기획서 검토',
      ),
    ).toBe(false);

    expect(skeleton()).toBeNull();

    const notice = reviewNotice();
    expect(notice?.textContent).toContain('저장하지 않았습니다');
    expect(notice?.textContent).toContain('최신 표를 불러오지 못했습니다');
    expect(notice?.textContent).not.toContain('다시 불러왔습니다');

    expect(container.textContent).toContain(
      '서류 수합 표를 불러오지 못했습니다',
    );
    expect(byText('다시 시도')).toBeInstanceOf(HTMLButtonElement);
  });

  it('MSD_024 재조회가 실패해도 저장되지 않았다는 사실은 남는다', async () => {
    await failReloadAfterConflict('MSD_024');

    expect(container.querySelector('table')).toBeNull();
    expect(panel()).toBeNull();

    const notice = reviewNotice();
    expect(notice?.textContent).toContain('다른 검토 결과가 먼저 등록되어');
    expect(notice?.textContent).toContain('저장하지 않았습니다');
    expect(notice?.textContent).toContain('최신 표를 불러오지 못했습니다');
  });

  it('다른 칸을 열면 그 안내는 걷힌다', async () => {
    await openPanelForGaTeam();
    createMilestoneDocumentReviewMock.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: '검토하는 사이에 제출물 또는 검토 결과가 바뀌었습니다.',
        instance: '/x',
        code: 'MSD_025',
      }),
    );

    await click(byText('승인'));
    await click(byText('저장'));
    await click(byLabel('가팀 중간 보고 검토'));

    expect(
      container.querySelector(
        '[data-testid="milestone-document-review-notice"]',
      ),
    ).toBeNull();
  });

  it('패널을 연 뒤 표가 바뀌어도, 보내는 값은 열 때 본 그 제출물이다', async () => {
    await openPanelForGaTeam();
    let release: (() => void) | null = null;
    createMilestoneDocumentReviewMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              id: 'r1',
              decision: 'APPROVED',
              comment: null,
              reviewedAt: '2026-08-01T00:00:00.000Z',
              resubmissionDueAt: null,
              reviewerNickname: '교직원',
            });
        }),
    );

    await click(byLabel('가팀 중간 보고 검토'));
    await click(byText('승인'));
    await click(byText('저장'));

    getMilestoneDocumentCollectionMock.mockResolvedValue(
      collection([
        row('a', '가팀', [
          cell('d1', {
            revision: 2,
            submittedAt: '2026-08-05T00:00:00.000Z',
            review: {
              id: 'review-99',
              decision: 'CHANGES_REQUESTED',
              comment: '다른 교직원이 먼저 보았습니다.',
              reviewedAt: '2026-08-06T00:00:00.000Z',
              resubmissionDueAt: null,
            },
          }),
          cell('d2'),
        ]),
      ]),
    );

    await click(byLabel('가팀 기획서 검토'));

    await act(() => {
      release?.();
      return Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(panel()?.textContent).toContain('다른 교직원이 먼저 보았습니다.');

    createMilestoneDocumentReviewMock.mockReset();
    createMilestoneDocumentReviewMock.mockResolvedValue({
      id: 'r2',
      decision: 'APPROVED',
      comment: null,
      reviewedAt: '2026-08-07T00:00:00.000Z',
      resubmissionDueAt: null,
      reviewerNickname: '교직원',
    });

    await click(byText('승인'));
    await click(byText('저장'));

    expect(createMilestoneDocumentReviewMock).toHaveBeenCalledWith(
      'milestone-1',
      'd1',
      'a',
      {
        decision: 'APPROVED',
        comment: undefined,
        expectedRevision: 1,
        expectedLatestReviewId: null,
      },
    );
  });
});
