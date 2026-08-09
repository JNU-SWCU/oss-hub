import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import {
  buildMilestoneDocumentCollectionSearchParams,
  getMilestoneDocumentCollection,
  milestoneDocumentCollectionArchiveHref,
  milestoneDocumentSubmissionFileHref,
  MILESTONE_DOCUMENT_COLLECTION_FILTERS,
  MILESTONE_DOCUMENT_COLLECTION_PAGE_SIZE,
  type MilestoneDocumentCollection,
} from './milestone-document-collection-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildMilestoneDocumentCollectionSearchParams', () => {
  // 서버 기본값에 기대지 않는다 — 기본값이 바뀌면 화면이 조용히 다른 페이지를 본다.
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
      ).toBe(filter);
    }
  });
});

describe('getMilestoneDocumentCollection', () => {
  it('조회 조건을 쿼리로 붙여 collection 경로를 부른다', async () => {
    // 계약 타입을 붙여 둔다 — 응답 필드 이름이 바뀌면 여기서 먼저 걸린다.
    const body: MilestoneDocumentCollection = {
      milestone: {
        id: 'milestone-1',
        programId: 'program-capstone',
        name: '기획서 제출',
        dueAt: '2026-07-15',
      },
      // 필수 여부는 이 응답에서 `isRequired`다(목록 조회의 `required`와 다른 계약).
      documents: [
        {
          id: 'd1',
          name: '기획서',
          isRequired: true,
          sortOrder: 1,
          submissionType: 'FILE',
        },
      ],
      rows: [],
      page: 3,
      pageSize: 20,
      total: 47,
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

describe('milestoneDocumentCollectionArchiveHref', () => {
  it('apiPath를 통해 전체 ZIP 경로를 만든다', () => {
    expect(milestoneDocumentCollectionArchiveHref('milestone-1', 'TEAM')).toBe(
      apiPath(
        'milestones/milestone-1/documents/collection/archive?groupBy=TEAM',
      ),
    );
  });

  /**
   * 서버 기본값에 기대지 않는다 — 조회 쿼리에서 `page`·`pageSize`·`filter`를 언제나
   * 함께 싣는 것과 같은 규칙이다. 기본값이 바뀌는 날, 화면은 아무것도 고치지 않았는데
   * 다른 구조의 ZIP을 내려준다.
   */
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

  // 담는 파일은 같고 ZIP 안의 경로만 뒤집힌다 — 경로 자체는 한 곳이어야 한다.
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

  /**
   * 마일스톤 id에 `/`·`#`·`&`나 한글이 들어와도 경로가 갈라지거나 쿼리가 늘어나면 안 된다.
   * 손으로 문자열을 이으면 `#` 뒤가 통째로 fragment가 되어 서버는 id를 짧게 받는다.
   */
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
