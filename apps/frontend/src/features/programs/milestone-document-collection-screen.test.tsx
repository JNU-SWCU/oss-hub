// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiPath } from '@/lib/api-client';
import { MilestoneDocumentCollectionScreen } from './milestone-document-collection-screen';
import type {
  MilestoneDocumentCollection,
  MilestoneDocumentCollectionArchiveGrouping,
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

const { getMilestoneDocumentCollectionMock, getMilestoneDocumentHistoryMock } =
  vi.hoisted(() => ({
    getMilestoneDocumentCollectionMock: vi.fn(),
    getMilestoneDocumentHistoryMock: vi.fn(),
  }));

// 조회 함수만 갈아 끼운다 — 필터 목록·경로 생성 같은 계약 상수는 화면이 실제 값을 쓴다.
vi.mock('./milestone-document-collection-api', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('./milestone-document-collection-api')
  >()),
  getMilestoneDocumentCollection: getMilestoneDocumentCollectionMock,
  getMilestoneDocumentHistory: getMilestoneDocumentHistoryMock,
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
        // 상태도 판정도 제출에 붙는다 — 안 낸 칸에는 셋 다 없다.
        status: null,
        revision: null,
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

/**
 * 기대하는 전체 ZIP 링크. `/api/v1`은 `apiPath`만 소유하므로 그것으로 시작하되, 그 뒤의
 * 경로와 쿼리는 손으로 적는다 — 화면이 쓰는 생성 함수를 그대로 불러 견주면 그 함수가
 * 무슨 경로를 만들든 이 단언은 언제나 통과한다(경로 자체는 api 테스트가 본다).
 */
function archiveHrefOf(
  grouping: MilestoneDocumentCollectionArchiveGrouping,
): string {
  return apiPath(
    `milestones/milestone-1/documents/collection/archive?groupBy=${grouping}`,
  );
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
    getMilestoneDocumentHistoryMock.mockReset();
    getMilestoneDocumentHistoryMock.mockResolvedValue({
      items: [],
      nextCursor: null,
      isComplete: true,
    });
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

  /** 지금 화면에 걸린 전체 ZIP 링크. 없으면 그 자체가 실패다. */
  function archiveHref(): string {
    const found = Array.from(container.querySelectorAll('a')).find(
      (candidate) => candidate.textContent?.includes('전체 내려받기'),
    );
    if (!(found instanceof HTMLAnchorElement)) {
      throw new TypeError('전체 내려받기(ZIP) 링크를 찾지 못했습니다.');
    }
    return found.getAttribute('href') ?? '';
  }

  async function toggleArchiveGrouping() {
    const found = container.querySelector('input[type="checkbox"]');
    if (!(found instanceof HTMLInputElement)) {
      throw new TypeError('서류 종류별로 묶기 토글을 찾지 못했습니다.');
    }
    await act(async () => {
      found.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  /**
   * 폴더 구조는 **표시 전용 상태**다. 토글이 링크에 닿지 않으면 교직원은 「서류 종류별」을
   * 켠 채 팀 기준 ZIP을 받고, 무엇을 받았는지 열어 보기 전까지 알 수 없다.
   */
  it('서류 종류별로 묶기를 켜면 ZIP 링크가 그 자리에서 바뀐다', async () => {
    getMilestoneDocumentCollectionMock.mockResolvedValue(
      collection([row('a', '가팀')]),
    );

    await render();
    expect(archiveHref()).toBe(archiveHrefOf('TEAM'));

    await toggleArchiveGrouping();

    expect(archiveHref()).toBe(archiveHrefOf('DOCUMENT'));

    // 다시 끄면 팀 기준으로 되돌아온다 — 한 방향으로만 걸리면 절반만 작동한다.
    await toggleArchiveGrouping();

    expect(archiveHref()).toBe(archiveHrefOf('TEAM'));
  });

  /**
   * 담기는 파일은 그대로고 ZIP 안의 경로만 뒤집힌다 — 다시 부를 것이 없다. 조회 조건에
   * 섞어 두면 토글 한 번마다 표가 통째로 다시 서고 열어 둔 판정 패널까지 닫힌다.
   */
  it('폴더 구조를 바꿔도 표를 다시 부르지 않는다', async () => {
    getMilestoneDocumentCollectionMock.mockResolvedValue(
      collection([row('a', '가팀')]),
    );

    await render();
    expect(getMilestoneDocumentCollectionMock).toHaveBeenCalledTimes(1);

    await toggleArchiveGrouping();

    expect(getMilestoneDocumentCollectionMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('가팀');
  });

  it('필터와 페이지를 바꿔도 전체 ZIP 요청은 바뀌지 않는다', async () => {
    getMilestoneDocumentCollectionMock.mockResolvedValue(
      collection([row('a', '가팀')], { total: 47 }),
    );

    await render();
    const initialHref = archiveHref();

    await click('필수 서류 미제출');
    expect(archiveHref()).toBe(initialHref);

    await click('다음');
    expect(archiveHref()).toBe(initialHref);

    expect(getMilestoneDocumentCollectionMock).toHaveBeenLastCalledWith(
      'milestone-1',
      { page: 2, pageSize: 20, filter: 'HAS_MISSING' },
    );
    const archiveUrl = new URL(initialHref, 'https://example.test');
    expect([...archiveUrl.searchParams.keys()]).toEqual(['groupBy']);
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
