import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import {
  buildMilestoneDocumentCollectionSearchParams,
  getMilestoneDocumentHistory,
  getMilestoneDocumentCollection,
  milestoneDocumentCollectionArchiveHref,
  milestoneDocumentCollectionDocumentArchiveHref,
  milestoneDocumentSubmissionFileHref,
  MILESTONE_DOCUMENT_COLLECTION_FILTERS,
  MILESTONE_DOCUMENT_COLLECTION_PAGE_SIZE,
  type MilestoneDocumentCollection,
} from './milestone-document-collection-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildMilestoneDocumentCollectionSearchParams', () => {
  it('page·pageSize·filter를 언제나 함께 싣는다', () => {
    expect(
      buildMilestoneDocumentCollectionSearchParams({
        page: 2,
        pageSize: 20,
        filter: 'HAS_MISSING',
      }).toString(),
    ).toBe('page=2&pageSize=20&filter=HAS_MISSING');
  });

  it('필터 값은 백엔드 enum 그대로 나간다', () => {
    for (const filter of MILESTONE_DOCUMENT_COLLECTION_FILTERS) {
      expect(
        buildMilestoneDocumentCollectionSearchParams({
          page: 1,
          pageSize: MILESTONE_DOCUMENT_COLLECTION_PAGE_SIZE,
          filter,
        }).get('filter'),
      ).toBe(
        ['LATE', 'COMPLETE', 'NO_REQUIRED_ITEMS'].includes(filter)
          ? 'ALL'
          : filter,
      );
      const params = buildMilestoneDocumentCollectionSearchParams({
        page: 1,
        pageSize: 20,
        filter,
      });
      expect(params.get('deliveryStatus')).toBe(
        ['LATE', 'COMPLETE', 'NO_REQUIRED_ITEMS'].includes(filter)
          ? filter
          : null,
      );
    }
  });
});

describe('getMilestoneDocumentCollection', () => {
  it('조회 조건을 쿼리로 붙여 collection 경로를 부른다', async () => {
    const body: MilestoneDocumentCollection = {
      milestone: {
        id: 'milestone-1',
        programId: 'program-capstone',
        name: '기획서 제출',
        dueAt: '2026-07-15',
      },

      documents: [
        {
          id: 'd1',
          name: '기획서',
          isRequired: true,
          sortOrder: 1,
        },
      ],
      rows: [],
      page: 3,
      pageSize: 20,
      total: 47,
      deliveryCounts: { missing: 0, late: 0, complete: 0, noRequiredItems: 0 },
      filterCounts: { all: 47, hasMissing: 12, zeroSubmission: 5 },
      documentTotals: [],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getMilestoneDocumentCollection('milestone-1', {
        page: 3,
        pageSize: 20,
        filter: 'ZERO_SUBMISSION',
      }),
    ).resolves.toEqual(body);

    expect(fetchMock).toHaveBeenCalledWith(
      apiPath(
        'milestones/milestone-1/documents/collection?page=3&pageSize=20&filter=ZERO_SUBMISSION',
      ),
      undefined,
    );
  });
});

describe('milestoneDocumentSubmissionFileHref', () => {
  it('apiPath를 통해 제출 파일 다운로드 경로를 만든다', () => {
    expect(
      milestoneDocumentSubmissionFileHref('milestone-1', 'd1', 'app-1'),
    ).toBe(
      apiPath('milestones/milestone-1/documents/d1/applications/app-1/file'),
    );
  });
});

describe('getMilestoneDocumentHistory', () => {
  it('requests a bounded cursor page from the selected team and document', async () => {
    const body = { items: [], nextCursor: 'history-20' };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getMilestoneDocumentHistory('milestone-1', 'd1', 'app-1', 'history-40'),
    ).resolves.toEqual(body);

    expect(fetchMock).toHaveBeenCalledWith(
      apiPath(
        'milestones/milestone-1/documents/d1/applications/app-1/history?limit=20&cursor=history-40',
      ),
      undefined,
    );
  });
});

describe('milestoneDocumentCollectionArchiveHref', () => {
  it('apiPath를 통해 전체 ZIP 경로를 만든다', () => {
    expect(milestoneDocumentCollectionArchiveHref('milestone-1', 'TEAM')).toBe(
      apiPath(
        'milestones/milestone-1/documents/collection/archive?groupBy=TEAM',
      ),
    );
  });

  it('groupBy를 두 값 모두 명시해서 싣는다', () => {
    for (const grouping of ['TEAM', 'DOCUMENT'] as const) {
      const href = milestoneDocumentCollectionArchiveHref(
        'milestone-1',
        grouping,
      );

      expect(
        new URL(href, 'https://example.test').searchParams.get('groupBy'),
      ).toBe(grouping);
    }
  });

  it('두 구조가 같은 endpoint를 가리킨다', () => {
    const team = new URL(
      milestoneDocumentCollectionArchiveHref('milestone-1', 'TEAM'),
      'https://example.test',
    );
    const byDocument = new URL(
      milestoneDocumentCollectionArchiveHref('milestone-1', 'DOCUMENT'),
      'https://example.test',
    );

    expect(byDocument.pathname).toBe(team.pathname);
  });

  it('한글·특수문자 id를 인코딩해 경로와 쿼리를 깨뜨리지 않는다', () => {
    expect(
      milestoneDocumentCollectionArchiveHref('기획/서 #1&x', 'DOCUMENT'),
    ).toBe(
      apiPath(
        'milestones/%EA%B8%B0%ED%9A%8D%2F%EC%84%9C%20%231%26x/documents/collection/archive?groupBy=DOCUMENT',
      ),
    );
  });
});

describe('milestoneDocumentCollectionDocumentArchiveHref', () => {
  it('apiPath를 통해 서류 하나짜리 ZIP 경로를 만든다', () => {
    expect(
      milestoneDocumentCollectionDocumentArchiveHref('milestone-1', 'd1'),
    ).toBe(
      apiPath(
        'milestones/milestone-1/documents/collection/archive?documentId=d1',
      ),
    );
  });

  it('groupBy를 싣지 않는다 — 함께 보내면 서버가 400으로 막는다', () => {
    const url = new URL(
      milestoneDocumentCollectionDocumentArchiveHref('milestone-1', 'd1'),
      'https://example.test',
    );

    expect(url.searchParams.get('documentId')).toBe('d1');
    expect(url.searchParams.get('groupBy')).toBeNull();
    expect([...url.searchParams.keys()]).toEqual(['documentId']);
  });

  it('전체 ZIP과 같은 endpoint를 가리킨다', () => {
    const all = new URL(
      milestoneDocumentCollectionArchiveHref('milestone-1', 'TEAM'),
      'https://example.test',
    );
    const one = new URL(
      milestoneDocumentCollectionDocumentArchiveHref('milestone-1', 'd1'),
      'https://example.test',
    );

    expect(one.pathname).toBe(all.pathname);
  });

  it('한글·특수문자 id를 인코딩해 경로와 쿼리를 깨뜨리지 않는다', () => {
    const href = milestoneDocumentCollectionDocumentArchiveHref(
      '기획/서 #1&x',
      '사업/계획서 #2&groupBy=DOCUMENT',
    );
    const url = new URL(href, 'https://example.test');

    expect(url.pathname).toBe(
      apiPath(
        'milestones/%EA%B8%B0%ED%9A%8D%2F%EC%84%9C%20%231%26x/documents/collection/archive',
      ),
    );

    expect([...url.searchParams.keys()]).toEqual(['documentId']);
    expect(url.searchParams.get('documentId')).toBe(
      '사업/계획서 #2&groupBy=DOCUMENT',
    );
    expect(url.searchParams.get('groupBy')).toBeNull();
  });
});
