// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { MilestoneDocumentCollectionScreen } from './milestone-document-collection-screen';
import type {
  MilestoneDocumentCollection,
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

const { getMilestoneDocumentCollectionMock } = vi.hoisted(() => ({
  getMilestoneDocumentCollectionMock: vi.fn(),
}));

// 조회 함수만 갈아 끼운다 — 필터 목록·경로 생성 같은 계약 상수는 화면이 실제 값을 쓴다.
vi.mock('./milestone-document-collection-api', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('./milestone-document-collection-api')
  >()),
  getMilestoneDocumentCollection: getMilestoneDocumentCollectionMock,
}));

function row(
  applicationId: string,
  teamName: string,
): MilestoneDocumentCollectionRow {
  return {
    applicationId,
    teamName,
    applicantName: '김철수',
    memberNicknames: ['chulsoo'],
    cells: [
      {
        documentId: 'd1',
        isSubmitted: false,
        // 상태도 판정도 제출에 붙는다 — 안 낸 칸에는 둘 다 없다.
        status: null,
        submittedAt: null,
        file: null,
        content: null,
        review: null,
      },
    ],
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
    ],
    rows,
    page: 1,
    pageSize: 20,
    total: rows.length,
    filterCounts: { all: 47, hasMissing: 12, zeroSubmission: 5 },
    documentTotals: [{ documentId: 'd1', submitted: 30, total: 47 }],
    ...overrides,
  };
}

function loadFailure(): ApiError {
  return new ApiError({
    type: 'about:blank',
    title: 'Internal Server Error',
    status: 500,
    detail: '표를 만드는 중 문제가 생겼습니다.',
    instance: '/milestones/milestone-1/documents/collection',
    code: 'MSD_999',
  });
}

describe('서류 수합 표의 조회 조건과 응답', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = window.document.createElement('div');
    window.document.body.append(container);
    root = createRoot(container);
    getMilestoneDocumentCollectionMock.mockReset();
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

  async function click(name: string) {
    const found = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim().startsWith(name),
    );
    if (!(found instanceof HTMLButtonElement)) {
      throw new TypeError(`버튼을 찾지 못했습니다: ${name}`);
    }
    await act(async () => {
      found.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('첫 조회는 전체 필터 1페이지를 부른다', async () => {
    getMilestoneDocumentCollectionMock.mockResolvedValue(
      collection([row('a', '가팀')]),
    );

    await render();

    expect(getMilestoneDocumentCollectionMock).toHaveBeenCalledWith(
      'milestone-1',
      { page: 1, pageSize: 20, filter: 'ALL' },
    );
    expect(container.textContent).toContain('가팀');
  });

  /**
   * 필터를 바꾼 요청이 실패했을 때가 문제였다. 이전 응답이 손에 그대로 남아, 화면은
   * 새로 고른 필터 이름 아래에 옛 행과 옛 합계를 오류 문구와 나란히 그렸다. 운영 표에서
   * 그것은 「이 조건에 이 팀들이 걸렸다」는 거짓말이 된다.
   */
  it('필터를 바꾼 조회가 실패하면 옛 행을 새 조건 아래에 남기지 않는다', async () => {
    getMilestoneDocumentCollectionMock.mockResolvedValueOnce(
      collection([row('a', '가팀')]),
    );
    getMilestoneDocumentCollectionMock.mockRejectedValueOnce(loadFailure());

    await render();
    expect(container.textContent).toContain('가팀');

    await click('필수 서류 미제출');

    expect(getMilestoneDocumentCollectionMock).toHaveBeenLastCalledWith(
      'milestone-1',
      { page: 1, pageSize: 20, filter: 'HAS_MISSING' },
    );
    expect(container.textContent).toContain(
      '표를 만드는 중 문제가 생겼습니다.',
    );
    expect(container.textContent).not.toContain('가팀');
    // 옛 합계도 함께 사라져야 한다 — 수만 남으면 조건이 바뀐 줄 모른다.
    expect(container.textContent).not.toContain('제출 30 / 전체 47');
  });

  it('페이지를 바꾼 조회가 실패해도 마찬가지다', async () => {
    getMilestoneDocumentCollectionMock.mockResolvedValueOnce(
      collection([row('a', '가팀')], { page: 1, total: 47 }),
    );
    getMilestoneDocumentCollectionMock.mockRejectedValueOnce(loadFailure());

    await render();
    await click('다음');

    expect(getMilestoneDocumentCollectionMock).toHaveBeenLastCalledWith(
      'milestone-1',
      { page: 2, pageSize: 20, filter: 'ALL' },
    );
    expect(container.textContent).not.toContain('가팀');
  });

  it('실패한 조건을 다시 시도해 성공하면 그 조건의 표가 선다', async () => {
    getMilestoneDocumentCollectionMock.mockResolvedValueOnce(
      collection([row('a', '가팀')]),
    );
    getMilestoneDocumentCollectionMock.mockRejectedValueOnce(loadFailure());
    getMilestoneDocumentCollectionMock.mockResolvedValueOnce(
      collection([row('b', '나팀')]),
    );

    await render();
    await click('필수 서류 미제출');
    await click('다시 시도');

    expect(getMilestoneDocumentCollectionMock).toHaveBeenLastCalledWith(
      'milestone-1',
      { page: 1, pageSize: 20, filter: 'HAS_MISSING' },
    );
    expect(container.textContent).toContain('나팀');
    expect(container.textContent).not.toContain('가팀');
  });
});
