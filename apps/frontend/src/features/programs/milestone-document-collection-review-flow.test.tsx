// @vitest-environment happy-dom

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
  createMilestoneDocumentReviewMock,
} = vi.hoisted(() => ({
  getMilestoneDocumentCollectionMock: vi.fn(),
  createMilestoneDocumentReviewMock: vi.fn(),
}));

// 조회·전송 함수만 갈아 끼운다 — 경로 생성·계약 상수는 화면이 실제 값을 쓴다.
vi.mock('./milestone-document-collection-api', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('./milestone-document-collection-api')
  >()),
  getMilestoneDocumentCollection: getMilestoneDocumentCollectionMock,
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
        submissionType: 'FILE',
      },
      {
        id: 'd2',
        name: '중간 보고',
        isRequired: false,
        sortOrder: 2,
        submissionType: 'TEXT',
      },
    ],
    rows,
    page: 1,
    pageSize: 20,
    total: rows.length,
    filterCounts: { all: 47, hasMissing: 12, zeroSubmission: 5 },
    documentTotals: [
      { documentId: 'd1', submitted: 30, total: 47 },
      { documentId: 'd2', submitted: 12, total: 47 },
    ],
    ...overrides,
  };
}

describe('수합 표에서 판정하기', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = window.document.createElement('div');
    window.document.body.append(container);
    root = createRoot(container);
    getMilestoneDocumentCollectionMock.mockReset();
    createMilestoneDocumentReviewMock.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render() {
    await act(async () => {
      root.render(
        <MilestoneDocumentCollectionScreen
          programId="program-capstone"
          milestoneId="milestone-1"
        />,
      );
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
    await act(async () => {
      button.click();
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
    // React가 값 변경을 감지하도록 네이티브 setter로 넣고 input 이벤트를 올린다.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    )?.set;
    setter?.call(textarea, value);
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
  }

  async function openPanelForGaTeam() {
    getMilestoneDocumentCollectionMock.mockResolvedValue(
      collection([row('a', '가팀', [cell('d1'), cell('d2')])]),
    );
    await render();
    await click(byLabel('가팀 기획서 판정'));
  }

  it('제출된 칸을 누르면 표를 떠나지 않고 그 자리에서 판정이 열린다', async () => {
    await openPanelForGaTeam();

    const opened = panel();
    expect(opened).not.toBeNull();
    expect(opened?.textContent).toContain('가팀 — 기획서');
    // 패널이 표 안에 있어야 「어디까지 봤는지」를 잃지 않는다.
    expect(opened?.closest('table')).not.toBeNull();
    // 표는 그대로 남는다 — 다른 화면으로 넘어가지 않았다.
    expect(container.textContent).toContain('합계');
  });

  it('같은 칸을 다시 누르면 닫힌다', async () => {
    await openPanelForGaTeam();
    expect(panel()).not.toBeNull();

    await click(byLabel('가팀 기획서 판정'));

    expect(panel()).toBeNull();
  });

  // 판정할 제출이 없는 칸을 누를 수 있게 두면 눌러 봐야 404(MSD_022)만 돌아온다.
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
        (button) => button.getAttribute('aria-label') === '가팀 기획서 판정',
      ),
    ).toBe(false);
    expect(
      buttons().some(
        (button) => button.getAttribute('aria-label') === '가팀 중간 보고 판정',
      ),
    ).toBe(true);
  });

  /**
   * 변이 검증 대상 1 — 사유 필수 검증이 사라지면 여기가 깨진다. 검증 없이 보내면
   * 서버가 422(MSD_021)로 거절하는데, 그때 교직원이 적어 둔 것은 이미 사라진 뒤다.
   */
  it('보완 요청에 사유가 없으면 보내지 않고 그 자리에서 막는다', async () => {
    await openPanelForGaTeam();

    await click(byText('보완 요청'));
    await click(byText('판정 저장'));

    expect(createMilestoneDocumentReviewMock).not.toHaveBeenCalled();
    expect(panel()?.textContent).toContain(
      '보완 요청과 반려는 사유를 입력해 주세요.',
    );
    // 패널은 열린 채로 남는다 — 닫히면 적으려던 자리를 다시 찾아야 한다.
    expect(panel()?.textContent).toContain('가팀 — 기획서');
  });

  it('판정을 고르지 않고 저장하면 고르라고 말한다', async () => {
    await openPanelForGaTeam();

    await click(byText('판정 저장'));

    expect(createMilestoneDocumentReviewMock).not.toHaveBeenCalled();
    expect(panel()?.textContent).toContain('판정을 골라 주세요.');
  });

  it('승인은 사유 없이 저장한다', async () => {
    await openPanelForGaTeam();
    createMilestoneDocumentReviewMock.mockResolvedValue({
      id: 'r1',
      decision: 'APPROVED',
      comment: null,
      reviewedAt: '2026-08-01T00:00:00.000Z',
      reviewerNickname: '교직원',
    });

    await click(byText('승인'));
    await click(byText('판정 저장'));

    expect(createMilestoneDocumentReviewMock).toHaveBeenCalledWith(
      'milestone-1',
      'd1',
      'a',
      {
        decision: 'APPROVED',
        comment: undefined,
        // 판정은 「내가 본 그 제출물」에 묶인다 — 이 두 값이 빠지면 서버가 400으로 막아
        // 판정 저장이 통째로 실패한다.
        expectedSubmittedAt: '2026-07-28T00:00:00.000Z',
        expectedLatestReviewId: null,
      },
    );
  });

  /**
   * 이미 판정이 한 번 붙은 칸. 그 판정 id를 함께 보내야 「내가 본 뒤에 다른 교직원이 먼저
   * 판정했다」를 서버가 알아챈다 — 언제나 `null`을 보내면 그 위에 조용히 덧발린다.
   */
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
      reviewerNickname: '교직원',
    });

    await click(byLabel('가팀 기획서 판정'));
    await click(byText('승인'));
    await click(byText('판정 저장'));

    expect(createMilestoneDocumentReviewMock).toHaveBeenCalledWith(
      'milestone-1',
      'd1',
      'a',
      {
        decision: 'APPROVED',
        comment: undefined,
        expectedSubmittedAt: '2026-07-28T00:00:00.000Z',
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
      reviewerNickname: '교직원',
    });

    await click(byText('보완 요청'));
    await act(async () => {
      typeComment('  표지를 고쳐 주세요.  ');
    });
    await click(byText('판정 저장'));

    expect(createMilestoneDocumentReviewMock).toHaveBeenCalledWith(
      'milestone-1',
      'd1',
      'a',
      {
        decision: 'CHANGES_REQUESTED',
        comment: '표지를 고쳐 주세요.',
        expectedSubmittedAt: '2026-07-28T00:00:00.000Z',
        expectedLatestReviewId: null,
      },
    );
  });

  /**
   * 저장한 판정은 곧바로 칸의 배지와 「지난 판정」이 되어야 한다. 그 값은 서버가
   * 소유하므로 응답을 손으로 표에 꽂지 않고 같은 조건으로 표를 다시 부른다.
   */
  it('저장에 성공하면 패널을 닫고 같은 조건으로 표를 다시 부른다', async () => {
    await openPanelForGaTeam();
    createMilestoneDocumentReviewMock.mockResolvedValue({
      id: 'r1',
      decision: 'APPROVED',
      comment: null,
      reviewedAt: '2026-08-01T00:00:00.000Z',
      reviewerNickname: '교직원',
    });
    const loadsBefore = getMilestoneDocumentCollectionMock.mock.calls.length;

    await click(byText('승인'));
    await click(byText('판정 저장'));

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
              reviewerNickname: '교직원',
            });
        }),
    );

    await click(byText('승인'));
    await click(byText('판정 저장'));

    // 문자열이 아니라 DOM의 boolean으로 본다.
    expect(byText('저장 중…').disabled).toBe(true);
    expect(createMilestoneDocumentReviewMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.();
    });
  });

  /**
   * 「그 사이 판정이 바뀜」(409)은 손에 든 표가 낡았다는 뜻이다. 문구만 띄우고 표를
   * 그대로 두면 교직원은 낡은 「지난 판정」을 보며 같은 실패를 되풀이한다.
   */
  it('그 사이 판정이 바뀌었다는 409는 문구와 함께 표를 다시 부른다', async () => {
    await openPanelForGaTeam();
    createMilestoneDocumentReviewMock.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: '제출하는 사이에 판정이 등록되었습니다.',
        instance: '/x',
        code: 'MSD_024',
      }),
    );
    const loadsBefore = getMilestoneDocumentCollectionMock.mock.calls.length;

    await click(byText('승인'));
    await click(byText('판정 저장'));

    expect(panel()?.textContent).toContain(
      '제출하는 사이에 판정이 등록되었습니다.',
    );
    expect(getMilestoneDocumentCollectionMock.mock.calls.length).toBe(
      loadsBefore + 1,
    );
  });

  // 입력이 문제인 422는 표가 낡은 것이 아니다 — 다시 부르면 적어 둔 자리만 흔들린다.
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
    await click(byText('판정 저장'));

    expect(panel()?.textContent).toContain(
      '보완 요청과 반려는 사유를 입력해 주세요.',
    );
    expect(getMilestoneDocumentCollectionMock.mock.calls.length).toBe(
      loadsBefore,
    );
  });

  /**
   * 필터를 바꾸면 그 팀이 다음 표에 없을 수 있다. 패널을 열어 둔 채로 두면 적어 둔
   * 사유가 남아 **엉뚱한 팀 칸에 그대로 저장된다** — 그 사유는 학생에게 그대로 보인다.
   */
  it('필터를 바꾸면 열어 둔 판정을 닫는다', async () => {
    await openPanelForGaTeam();
    expect(panel()).not.toBeNull();

    await click(byText('필수 서류 미제출 12팀'));

    expect(panel()).toBeNull();
  });

  /**
   * 판정 POST가 날아가 있는 동안에도 페이지·필터·다른 칸은 그대로 눌린다. 그렇게 **버려진**
   * 응답이라도 성공이었다면 서버에는 이미 저장돼 있다 — 그냥 지나가면 표에는 옛 배지가
   * 그대로 남아, 교직원이 이미 판정한 건을 다시 판정한다(판정은 쌓이므로 학생 화면에
   * 같은 지적이 두 번 남는다).
   *
   * 그래서 다시 부르되 **지금 조건으로** 부른다. 전송을 시작하던 때의 조건으로 부르면
   * 화면은 새 필터 이름 아래에 옛 조건의 답을 기다리게 되고, 어긋난 응답은 버려지니
   * 표가 통째로 빈다.
   */
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
              reviewerNickname: '교직원',
            });
        }),
    );

    await click(byText('승인'));
    await click(byText('판정 저장'));
    await click(byText('필수 서류 미제출 12팀'));
    const loadsAfterFilter =
      getMilestoneDocumentCollectionMock.mock.calls.length;

    await act(async () => {
      release?.();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // 저장된 판정이 표에 반영되도록 한 번 더 부른다.
    expect(getMilestoneDocumentCollectionMock.mock.calls.length).toBe(
      loadsAfterFilter + 1,
    );
    // 그 조회는 **바뀐 필터**로 나간다 — 옛 조건이면 표가 빈다.
    expect(getMilestoneDocumentCollectionMock).toHaveBeenLastCalledWith(
      'milestone-1',
      { page: 1, pageSize: 20, filter: 'HAS_MISSING' },
    );
  });

  /**
   * 버려진 응답이 **실패**였다면 서버에 남은 것이 없다. 그때까지 다시 부르면 교직원이
   * 손대지도 않은 표가 이유 없이 깜빡인다.
   */
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
    await click(byText('판정 저장'));
    await click(byText('필수 서류 미제출 12팀'));
    const loadsAfterFilter =
      getMilestoneDocumentCollectionMock.mock.calls.length;

    await act(async () => {
      reject?.();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(getMilestoneDocumentCollectionMock.mock.calls.length).toBe(
      loadsAfterFilter,
    );
  });

  /**
   * 같은 경합의 다른 얼굴 — 늦게 온 응답의 성공 처리는 판정 폼을 닫는다. 그 사이 교직원이
   * 다른 칸을 열어 두었으면 **방금 연 폼이 눈앞에서 닫힌다**(적어 둔 사유와 함께).
   */
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
              reviewerNickname: '교직원',
            });
        }),
    );

    await click(byText('승인'));
    await click(byText('판정 저장'));
    await click(byLabel('가팀 중간 보고 판정'));
    expect(panel()?.textContent).toContain('가팀 — 중간 보고');

    await act(async () => {
      release?.();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(panel()).not.toBeNull();
    expect(panel()?.textContent).toContain('가팀 — 중간 보고');
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

  /**
   * 보완 요청에 응해 **다시 낸** 칸. 서버는 제출 상태만 되돌리고 판정 기록은 남기므로,
   * 배지를 판정으로 정하면 이 칸이 계속 「보완 요청」으로 보인다 — 교직원은 다시 봐야 할
   * 건을 처리 끝난 것으로 읽고 넘어간다. 칸에는 「검토 대기」, 패널에는 지난 지적이다.
   */
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

    await click(byLabel('가팀 기획서 판정'));

    // 지난 지적은 사라지지 않는다 — 다시 보는 교직원이 무엇을 지적했는지 알아야 한다.
    expect(panel()?.textContent).toContain('지난 판정');
    expect(panel()?.textContent).toContain('표지의 이름이 신청서와 다릅니다.');
  });

  /**
   * 표를 그린 뒤 학생이 다시 냈거나 다른 교직원이 먼저 판정한 경우 — 서버가 409(MSD_025)로
   * 막는다. 그 판정은 **못 본 내용에 붙으려던 것**이라 그냥 다시 눌러 통과시키면 안 된다.
   * 그래서 고른 판정을 버리고, 표를 최신으로 되돌리고, 무슨 일이 났는지 말한다.
   */
  it('제출물이 바뀌었다는 409는 판정을 버리고 표를 되돌린 뒤 사실을 말한다', async () => {
    await openPanelForGaTeam();
    createMilestoneDocumentReviewMock.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail:
          '검토하는 사이에 제출물 또는 판정이 바뀌었습니다. 새로고침 후 다시 확인해 주세요.',
        instance: '/x',
        code: 'MSD_025',
      }),
    );
    const loadsBefore = getMilestoneDocumentCollectionMock.mock.calls.length;

    await click(byText('승인'));
    await click(byText('판정 저장'));

    // 고른 판정은 버려진다 — 패널이 열린 채면 같은 판정을 다시 눌러 통과시킬 수 있다.
    expect(panel()).toBeNull();
    expect(getMilestoneDocumentCollectionMock.mock.calls.length).toBe(
      loadsBefore + 1,
    );

    const notice = container.querySelector(
      '[data-testid="milestone-document-review-notice"]',
    );
    expect(notice).not.toBeNull();
    // 세 가지를 다 말해야 한다: 저장되지 않았다 · 표는 되돌렸다 · 다시 **보고** 판정하라.
    expect(notice?.textContent).toContain('저장하지 않았습니다');
    expect(notice?.textContent).toContain('다시 불러왔습니다');
    expect(notice?.textContent).toContain('다시 확인한 뒤 판정해 주세요');
    /*
     * 학생 제출 경로의 409(MSD_024) 문구를 그대로 쓰지 않는다 — 두 자리에 같은 말을
     * 띄우면 「무엇이 바뀌었는지」가 사라진다.
     */
    expect(notice?.textContent).not.toContain(
      '제출하는 사이에 판정이 등록되었습니다',
    );
  });

  // 새 칸을 열었으면 앞 판정에 대한 안내는 할 일을 마쳤다 — 남겨 두면 지금 칸의 말로 읽힌다.
  it('다른 칸을 열면 그 안내는 걷힌다', async () => {
    await openPanelForGaTeam();
    createMilestoneDocumentReviewMock.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: '검토하는 사이에 제출물 또는 판정이 바뀌었습니다.',
        instance: '/x',
        code: 'MSD_025',
      }),
    );

    await click(byText('승인'));
    await click(byText('판정 저장'));
    await click(byLabel('가팀 중간 보고 판정'));

    expect(
      container.querySelector(
        '[data-testid="milestone-document-review-notice"]',
      ),
    ).toBeNull();
  });

  /**
   * 기대 버전은 **패널을 열던 순간**의 값이어야 한다. 보내는 순간에 표를 다시 읽어 채우면
   * 언제나 최신값이 실려 서버의 대조가 늘 통과하고, 그러면 이 검사가 막으려던 「그 사이
   * 바뀐 제출물에 판정이 붙는다」가 그대로 일어난다.
   *
   * 그 성질을 보려면 **패널을 연 뒤에 표만 바뀌는** 상황이 필요하다. 위의 「버려진 성공은
   * 표를 다시 부른다」가 정확히 그 상황을 만든다.
   */
  it('패널을 연 뒤 표가 바뀌어도, 보내는 값은 열 때 본 그 제출물이다', async () => {
    // 1. 첫 표 — 가팀 기획서는 07-28 제출, 판정 없음.
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
              reviewerNickname: '교직원',
            });
        }),
    );

    // 2. 중간 보고를 판정해 전송을 띄워 둔다.
    await click(byLabel('가팀 중간 보고 판정'));
    await click(byText('승인'));
    await click(byText('판정 저장'));

    // 3. 그 사이 학생이 기획서를 다시 내고 다른 교직원이 판정을 붙였다.
    getMilestoneDocumentCollectionMock.mockResolvedValue(
      collection([
        row('a', '가팀', [
          cell('d1', {
            submittedAt: '2026-08-05T00:00:00.000Z',
            review: {
              id: 'review-99',
              decision: 'CHANGES_REQUESTED',
              comment: '다른 교직원이 먼저 보았습니다.',
              reviewedAt: '2026-08-06T00:00:00.000Z',
            },
          }),
          cell('d2'),
        ]),
      ]),
    );

    // 4. 기획서 패널을 연다 — 이때 화면에 있던 값은 아직 옛 표(07-28 · 판정 없음)다.
    await click(byLabel('가팀 기획서 판정'));

    // 5. 띄워 둔 전송이 늦게 끝난다 → 버려진 성공이므로 표를 다시 부른다(내용이 바뀐다).
    await act(async () => {
      release?.();
    });
    await act(async () => {
      await Promise.resolve();
    });
    // 표는 실제로 새 내용으로 갈렸다.
    expect(panel()?.textContent).toContain('다른 교직원이 먼저 보았습니다.');

    createMilestoneDocumentReviewMock.mockReset();
    createMilestoneDocumentReviewMock.mockResolvedValue({
      id: 'r2',
      decision: 'APPROVED',
      comment: null,
      reviewedAt: '2026-08-07T00:00:00.000Z',
      reviewerNickname: '교직원',
    });

    await click(byText('승인'));
    await click(byText('판정 저장'));

    /*
     * 열 때 본 값이 나간다. 보내는 순간의 표를 읽었다면 08-05·review-99가 실려 서버가
     * 통과시켰을 것이다 — 교직원은 새 제출물을 못 본 채 승인한 셈이 된다. 옛 값을
     * 보내야 서버가 409로 막고, 화면이 「다시 보라」고 말할 수 있다.
     */
    expect(createMilestoneDocumentReviewMock).toHaveBeenCalledWith(
      'milestone-1',
      'd1',
      'a',
      {
        decision: 'APPROVED',
        comment: undefined,
        expectedSubmittedAt: '2026-07-28T00:00:00.000Z',
        expectedLatestReviewId: null,
      },
    );
  });
});
