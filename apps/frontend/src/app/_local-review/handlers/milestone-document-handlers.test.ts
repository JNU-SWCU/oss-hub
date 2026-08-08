import { describe, expect, it } from 'vitest';
import type { MilestoneDocument } from '@/features/programs/milestone-document-api';
import type { MilestoneDocumentCollection } from '@/features/programs/milestone-document-collection-api';
import type { LocalReviewFixtureId } from '../fixture-contract';
import {
  isAuthenticatedFixture,
  roleForFixture,
  type LocalReviewContext,
  type LocalReviewResponsePlan,
} from '../handler-kit';
import { MILESTONE_DOCUMENT_HANDLERS } from './milestone-document-handlers';

/** 서류 3장·팀 3개짜리 교직원 마일스톤(milestone-document-fixtures.ts). */
const MILESTONE_ID = 'milestone-basic-orientation';
const DOCUMENT_IDS = [
  'synthetic-document-orientation-plan',
  'synthetic-document-orientation-pledge',
  'synthetic-document-orientation-note',
];

function resolve(
  method: string,
  path: string,
  options: {
    readonly search?: string;
    readonly body?: unknown;
    readonly fixture?: LocalReviewFixtureId;
  } = {},
): LocalReviewResponsePlan | null {
  const fixture = options.fixture ?? 'staff';
  const context: LocalReviewContext = {
    fixture,
    method,
    path,
    searchParams: new URLSearchParams(options.search ?? ''),
    role: roleForFixture(fixture),
    isAuthenticated: isAuthenticatedFixture(fixture),
    body: options.body,
  };
  for (const handler of MILESTONE_DOCUMENT_HANDLERS) {
    const plan = handler(context);
    if (plan !== null) return plan;
  }
  return null;
}

function jsonBody(plan: LocalReviewResponsePlan | null): unknown {
  expect(plan?.kind).toBe('json');
  return (plan as { readonly body: unknown }).body;
}

function statusOf(plan: LocalReviewResponsePlan | null): number {
  expect(plan?.kind).toBe('json');
  return (plan as { readonly status: number }).status;
}

describe('PATCH .../documents/order', () => {
  /**
   * `order`는 고정 세그먼트라 `:documentId` 패턴에도 **그냥 걸린다**. 핸들러 배열에서
   * 순서 핸들러가 수정 핸들러 뒤로 밀리면, 순서 바꾸기 요청이 조용히 「`order`라는
   * 서류를 수정」으로 처리되어 화면은 성공을 받고 순서는 그대로다. 백엔드 컨트롤러가
   * `@Patch('order')`를 `@Patch(':documentId')` 위에 두는 것과 같은 함정이다.
   */
  it('`:documentId` 수정 핸들러에 먹히지 않는다', () => {
    const body = jsonBody(
      resolve('PATCH', `milestones/${MILESTONE_ID}/documents/order`, {
        body: { documentIds: [...DOCUMENT_IDS].reverse() },
      }),
    );

    expect(Array.isArray(body)).toBe(true);
    // 수정 핸들러가 잡았다면 id가 'order'인 객체 하나가 돌아온다.
    expect(body).not.toMatchObject({ id: 'order' });
  });

  it('받은 순서대로 sortOrder를 1부터 다시 매긴다', () => {
    const reversed = [...DOCUMENT_IDS].reverse();
    const body = jsonBody(
      resolve('PATCH', `milestones/${MILESTONE_ID}/documents/order`, {
        body: { documentIds: reversed },
      }),
    ) as readonly MilestoneDocument[];

    expect(body.map((item) => item.id)).toEqual(reversed);
    expect(body.map((item) => item.sortOrder)).toEqual([1, 2, 3]);
  });

  // 부분 목록을 조용히 받아 주면, 화면이 실제 백엔드에서만 실패하는 요청을 만들어도
  // 로컬 검토에서는 성공으로 보인다.
  it('전체 집합이 아니면 400(MSD_019)이다', () => {
    for (const documentIds of [
      [DOCUMENT_IDS[0]], // 누락
      [DOCUMENT_IDS[0], DOCUMENT_IDS[0], DOCUMENT_IDS[1]], // 중복
      [...DOCUMENT_IDS.slice(0, 2), 'synthetic-document-approved'], // 타 마일스톤
    ]) {
      const plan = resolve(
        'PATCH',
        `milestones/${MILESTONE_ID}/documents/order`,
        { body: { documentIds } },
      );

      expect(statusOf(plan)).toBe(400);
      expect(jsonBody(plan)).toMatchObject({ code: 'MSD_019' });
    }
  });

  it('학생은 교직원 가드에 막힌다', () => {
    const plan = resolve(
      'PATCH',
      `milestones/${MILESTONE_ID}/documents/order`,
      { body: { documentIds: DOCUMENT_IDS }, fixture: 'student' },
    );

    expect(statusOf(plan)).toBe(403);
    expect(jsonBody(plan)).toMatchObject({ code: 'MSD_001' });
  });
});

describe('GET .../documents/collection', () => {
  function collection(search: string): MilestoneDocumentCollection {
    return jsonBody(
      resolve('GET', `milestones/${MILESTONE_ID}/documents/collection`, {
        search,
      }),
    ) as MilestoneDocumentCollection;
  }

  it('page·pageSize를 읽어 그 페이지만 준다', () => {
    const first = collection('page=1&pageSize=2&filter=ALL');
    const second = collection('page=2&pageSize=2&filter=ALL');

    expect(first.page).toBe(1);
    expect(first.pageSize).toBe(2);
    expect(first.rows).toHaveLength(2);
    expect(second.rows).toHaveLength(1);
    expect(second.total).toBe(3);
  });

  it('filter를 읽어 서버가 거른 행만 준다', () => {
    const zero = collection('page=1&pageSize=20&filter=ZERO_SUBMISSION');

    expect(zero.total).toBe(zero.rows.length);
    expect(
      zero.rows.every((row) => row.cells.every((cell) => !cell.isSubmitted)),
    ).toBe(true);
  });

  /**
   * 이 픽스처의 세 번째 서류는 **선택**(required: false)이다. 필수만 세는 규칙이
   * 느슨해지면 선택 서류만 빠뜨린 팀까지 걸려 hasMissing이 부풀어 오른다.
   */
  it('HAS_MISSING은 필수 서류만 센다', () => {
    const all = collection('page=1&pageSize=20&filter=ALL');
    const hasMissing = collection('page=1&pageSize=20&filter=HAS_MISSING');

    expect(hasMissing.total).toBe(all.filterCounts.hasMissing);
    expect(hasMissing.total).toBeLessThan(all.filterCounts.all);
  });

  /**
   * 집계 두 필드는 필터·페이지와 **무관하게 전체 기준**이다. 필터를 따라가게 만들면
   * ZERO_SUBMISSION에서 모든 열이 「제출 0」이 되어 합계 행이 뜻을 잃는다.
   */
  it('filterCounts·documentTotals는 필터·페이지를 타지 않는다', () => {
    const all = collection('page=1&pageSize=20&filter=ALL');
    const filtered = collection('page=2&pageSize=2&filter=ZERO_SUBMISSION');

    expect(filtered.filterCounts).toEqual(all.filterCounts);
    expect(filtered.documentTotals).toEqual(all.documentTotals);
    expect(all.documentTotals.every((total) => total.total === 3)).toBe(true);
  });

  /**
   * 화면은 이 값을 경로의 programId와 대조해 어긋난 주소를 잡는다. 픽스처가 소유
   * 프로그램을 지어내거나 경로에서 되받아 오면 그 대조가 로컬 검토에서 언제나 통과해
   * 아무것도 검증하지 못한다 — 여기 마일스톤은 기초 스터디 프로그램의 것이다.
   */
  it('마일스톤을 소유한 프로그램 id를 함께 싣는다', () => {
    expect(collection('').milestone.programId).toBe('program-basic-study');
  });

  it('쿼리가 없으면 기본값(1·20·ALL)으로 답한다', () => {
    const fallback = collection('');

    expect(fallback.page).toBe(1);
    expect(fallback.pageSize).toBe(20);
    expect(fallback.total).toBe(fallback.filterCounts.all);
  });
});
