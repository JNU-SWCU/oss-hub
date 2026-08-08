import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import {
  buildMilestoneDocumentCollectionSearchParams,
  getMilestoneDocumentCollection,
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
