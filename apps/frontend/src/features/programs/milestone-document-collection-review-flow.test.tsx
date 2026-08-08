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
    submittedAt: '2026-07-28T00:00:00.000Z',
    file: null,
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
          cell('d1', { isSubmitted: false, submittedAt: null }),
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
      { decision: 'APPROVED', comment: undefined },
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
      { decision: 'CHANGES_REQUESTED', comment: '표지를 고쳐 주세요.' },
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

  it('칸의 배지는 판정을 그대로 말한다', async () => {
    getMilestoneDocumentCollectionMock.mockResolvedValue(
      collection([
        row('a', '가팀', [
          cell('d1', {
            review: {
              decision: 'REJECTED',
              comment: '기한을 넘겼습니다.',
              reviewedAt: '2026-07-30T00:00:00.000Z',
            },
          }),
          cell('d2', { isSubmitted: false, submittedAt: null }),
        ]),
      ]),
    );
    await render();

    const cells = Array.from(container.querySelectorAll('tbody td'));
    expect(cells[1]?.textContent).toContain('반려');
    expect(cells[2]?.textContent).toContain('미제출');
  });
});
