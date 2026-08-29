import { describe, expect, it } from 'vitest';
import type { MilestoneDocument } from '@/features/programs/milestone-document-api';
import type {
  MilestoneDocumentCollection,
  MilestoneDocumentHistoryPage,
} from '@/features/programs/milestone-document-collection-api';
import type { LocalReviewFixtureId } from '@/lib/local-review-runtime';
import {
  isAuthenticatedFixture,
  roleForFixture,
  type LocalReviewContext,
  type LocalReviewResponsePlan,
} from '../handler-kit';
import { MILESTONE_DOCUMENT_HANDLERS } from './milestone-document-handlers';

/** 서류 4장·팀 3개짜리 교직원 마일스톤(milestone-document-fixtures.ts). */
const MILESTONE_ID = 'milestone-basic-orientation';
const DOCUMENT_IDS = [
  'synthetic-document-orientation-plan',
  'synthetic-document-orientation-pledge',
  'synthetic-document-orientation-note',
  'synthetic-document-orientation-summary',
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

describe('GET .../documents', () => {
  it('clean list DTO does not leak the fixture-only content discriminator', () => {
    const body = jsonBody(
      resolve('GET', `milestones/${MILESTONE_ID}/documents`),
    ) as readonly MilestoneDocument[];

    expect(body).toHaveLength(4);
    for (const document of body) {
      expect(Object.hasOwn(document, 'submissionType')).toBe(false);
      expect(document).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        required: expect.any(Boolean),
        sortOrder: expect.any(Number),
      });
    }
  });
});

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
    expect(body.map((item) => item.sortOrder)).toEqual([1, 2, 3, 4]);
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

describe('PATCH .../documents/:documentId', () => {
  /**
   * 순서는 order endpoint가 소유한다 — 실제 백엔드는 수정 요청의 sortOrder를 무시한다.
   * 이 어댑터가 본문 값을 되받아 주면 로컬 검토에서만 「고치면 순서가 바뀐다」로 보여,
   * 화면이 그 전제 위에 얹혀도 여기서는 드러나지 않는다.
   */
  it('본문의 sortOrder를 따르지 않고 시드가 가진 자리를 그대로 준다', () => {
    const body = jsonBody(
      resolve(
        'PATCH',
        `milestones/${MILESTONE_ID}/documents/${DOCUMENT_IDS[1]}`,
        {
          body: {
            name: '합성 참여 서약서(수정)',
            required: true,
            sortOrder: 99,
          },
        },
      ),
    ) as MilestoneDocument;

    expect(body.name).toBe('합성 참여 서약서(수정)');
    // 시드에서 이 서류는 두 번째다(milestone-document-fixtures.ts).
    expect(body.sortOrder).toBe(2);
  });

  it('폐기된 submissionType 필드는 400 SYS_003으로 거절한다', () => {
    const plan = resolve(
      'PATCH',
      `milestones/${MILESTONE_ID}/documents/${DOCUMENT_IDS[1]}`,
      { body: { name: '합성 서류', required: true, submissionType: 'TEXT' } },
    );
    expect(statusOf(plan)).toBe(400);
    expect(jsonBody(plan)).toMatchObject({ code: 'SYS_003' });
  });
});

describe('POST .../documents', () => {
  it.each(['submissionType', 'unexpected'])(
    '허용하지 않은 %s 필드는 400 SYS_003으로 거절한다',
    (unknownKey) => {
      const plan = resolve('POST', `milestones/${MILESTONE_ID}/documents`, {
        body: {
          name: '합성 새 서류',
          required: false,
          sortOrder: 5,
          [unknownKey]: 'TEXT',
        },
      });
      expect(statusOf(plan)).toBe(400);
      expect(jsonBody(plan)).toMatchObject({ code: 'SYS_003' });
    },
  );
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
   * 수합 표의 열은 `isRequired`로 온다 — 목록 조회(`GET .../documents`)가 쓰는
   * `required`와 **다른 계약**이다. 픽스처가 옛 이름으로 실으면 값이 `undefined`가 되어
   * 화면의 필수 별표도, 아래 「필수 서류 미제출」 필터도 오류 하나 없이 조용히 꺼진다.
   */
  it('열의 필수 여부는 isRequired로 싣는다 — 옛 required가 아니다', () => {
    const { documents } = collection('');

    expect(documents).toHaveLength(4);
    for (const item of documents) {
      expect(Object.hasOwn(item, 'isRequired')).toBe(true);
      expect(Object.hasOwn(item, 'required')).toBe(false);
      expect(typeof item.isRequired).toBe('boolean');
    }
    // 필수·선택이 섞여 있어야 아래 HAS_MISSING 검사가 뜻을 갖는다.
    expect(documents.map((item) => item.isRequired)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(
      documents.every((item) => !Object.hasOwn(item, 'submissionType')),
    ).toBe(true);
  });

  /**
   * 이 픽스처의 세 번째 서류는 **선택**(`isRequired: false`)이다. 필수만 세는 규칙이
   * 느슨해지면 선택 서류만 빠뜨린 팀까지 걸려 hasMissing이 부풀어 오른다.
   *
   * ⚠ 수를 못 박아 둔다. 「전체보다 적다」 정도의 헐거운 단언만 두면 필수 판정이 아예
   * 무너져 **0팀**이 되는 경우도 그대로 통과한다 — 필터가 조용히 텅 비는 쪽이 부풀어
   * 오르는 쪽보다 흔한 실패다(옛 이름 `required`를 보면 `undefined`가 되어 그렇게 된다).
   */
  it('HAS_MISSING은 필수 서류를 안 낸 팀만, 그러나 빠짐없이 센다', () => {
    const all = collection('page=1&pageSize=20&filter=ALL');
    const hasMissing = collection('page=1&pageSize=20&filter=HAS_MISSING');

    // 3팀 중 첫 팀만 네 장을 다 냈다 — 나머지 두 팀은 필수 서류가 빈다.
    expect(all.filterCounts.all).toBe(3);
    expect(all.filterCounts.hasMissing).toBe(2);
    expect(hasMissing.total).toBe(2);
    expect(hasMissing.rows).toHaveLength(2);
    // 「한 장도 안 낸 팀」(1팀)보다 많다 — 두 필터가 같은 수를 내면 필수 판정이 죽어도 모른다.
    expect(all.filterCounts.hasMissing).toBeGreaterThan(
      all.filterCounts.zeroSubmission,
    );

    // 걸린 팀은 정말로 **필수** 서류가 비어 있다.
    const requiredIndexes = all.documents
      .map((item, index) => (item.isRequired ? index : -1))
      .filter((index) => index >= 0);
    expect(requiredIndexes).toEqual([0, 1]);
    for (const row of hasMissing.rows) {
      expect(
        requiredIndexes.some((index) => row.cells[index]?.isSubmitted !== true),
      ).toBe(true);
    }
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

describe('GET .../applications/:applicationId/history', () => {
  const HISTORY_PATH = `milestones/${MILESTONE_ID}/documents/${DOCUMENT_IDS[0]}/applications/synthetic-application-${MILESTONE_ID}-1/history`;
  const RESUBMISSION_HISTORY_PATH = `milestones/${MILESTONE_ID}/documents/${DOCUMENT_IDS[0]}/applications/synthetic-application-${MILESTONE_ID}-2/history`;
  const TEXT_HISTORY_PATH = `milestones/${MILESTONE_ID}/documents/${DOCUMENT_IDS[2]}/applications/synthetic-application-${MILESTONE_ID}-1/history`;

  it('선택한 칸의 제출·판정 이력을 새 분리 계약으로 돌려준다', () => {
    const body = jsonBody(
      resolve('GET', HISTORY_PATH),
    ) as MilestoneDocumentHistoryPage;

    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]).toMatchObject({ event: 'SUBMITTED', revision: 1 });
    expect(body.nextCursor).toBeNull();
  });

  it('학생은 403 MSD_001로 막는다', () => {
    const plan = resolve('GET', HISTORY_PATH, { fixture: 'student' });

    expect(statusOf(plan)).toBe(403);
    expect(jsonBody(plan)).toMatchObject({ code: 'MSD_001' });
  });

  it('서류가 없거나 다른 마일스톤 소속이면 MSD_004, 신청이 없으면 MSD_022이다', () => {
    for (const path of [
      HISTORY_PATH.replace(DOCUMENT_IDS[0], 'missing-document'),
      HISTORY_PATH.replace(DOCUMENT_IDS[0], 'synthetic-document-approved'),
    ]) {
      expect(statusOf(resolve('GET', path))).toBe(404);
      expect(jsonBody(resolve('GET', path))).toMatchObject({ code: 'MSD_004' });
    }

    const missingApplication = HISTORY_PATH.replace(
      /synthetic-application-[^/]+/,
      'synthetic-application-missing',
    );
    expect(statusOf(resolve('GET', missingApplication))).toBe(404);
    expect(jsonBody(resolve('GET', missingApplication))).toMatchObject({
      code: 'MSD_022',
    });
  });

  it('cursor와 limit을 서버 범위로 제한하고 범위 밖 cursor는 MSD_019로 막는다', () => {
    for (const search of [
      'limit=0',
      'limit=51',
      'limit=one',
      'cursor=outside',
    ]) {
      const plan = resolve('GET', RESUBMISSION_HISTORY_PATH, { search });
      expect(statusOf(plan)).toBe(400);
      expect(jsonBody(plan)).toMatchObject({ code: 'MSD_019' });
    }
  });

  it('cursor 페이지는 각각 시간순이며 nextCursor가 다음 페이지를 잇는다', () => {
    const first = jsonBody(
      resolve('GET', RESUBMISSION_HISTORY_PATH, { search: 'limit=2' }),
    ) as MilestoneDocumentHistoryPage;
    const second = jsonBody(
      resolve('GET', RESUBMISSION_HISTORY_PATH, {
        search: `limit=2&cursor=${first.nextCursor}`,
      }),
    ) as MilestoneDocumentHistoryPage;

    expect(first.nextCursor).not.toBeNull();
    expect(first.items.map((item) => item.event)).toEqual([
      'CHANGES_REQUESTED',
      'RESUBMITTED',
    ]);
    expect(second.items.map((item) => item.event)).toEqual(['SUBMITTED']);
    expect(second.nextCursor).toBeNull();
    for (const page of [first, second]) {
      expect(page.items.map((item) => item.createdAt)).toEqual(
        [...page.items.map((item) => item.createdAt)].sort(),
      );
    }
  });

  it('SUBMITTED 이력에는 본문을, 파일·검토 이력에는 명시적 null 키를 싣는다', () => {
    const textBody = jsonBody(
      resolve('GET', TEXT_HISTORY_PATH),
    ) as MilestoneDocumentHistoryPage;
    const fileBody = jsonBody(
      resolve('GET', RESUBMISSION_HISTORY_PATH),
    ) as MilestoneDocumentHistoryPage;
    const submitted = textBody.items.find((item) => item.event === 'SUBMITTED');
    const review = textBody.items.find(
      (item) => item.event === 'CHANGES_REQUESTED',
    );
    const fileSubmission = fileBody.items.find(
      (item) => item.event === 'SUBMITTED',
    );

    expect(submitted).toMatchObject({
      content: { type: 'TEXT' },
      fileName: null,
    });
    expect(review).toMatchObject({ content: null, fileName: null });
    expect(fileSubmission).toMatchObject({
      content: null,
      fileName: expect.any(String),
    });
    for (const item of [submitted, review, fileSubmission]) {
      expect(Object.keys(item ?? {}).sort()).toEqual([
        'actorNickname',
        'comment',
        'content',
        'createdAt',
        'event',
        'fileName',
        'revision',
      ]);
    }
  });
});

describe('GET .../documents/:documentId/history', () => {
  const HISTORY_PATH = `milestones/${MILESTONE_ID}/documents/${DOCUMENT_IDS[0]}/history`;

  it('학생 자신의 이력만 bounded cursor로 돌리고 교직원 판정자를 가린다', () => {
    const first = jsonBody(
      resolve('GET', HISTORY_PATH, { search: 'limit=2', fixture: 'student' }),
    ) as MilestoneDocumentHistoryPage;
    const second = jsonBody(
      resolve('GET', HISTORY_PATH, {
        search: `limit=2&cursor=${first.nextCursor}`,
        fixture: 'student',
      }),
    ) as MilestoneDocumentHistoryPage;

    expect(first.nextCursor).not.toBeNull();
    expect(first.items.map((item) => item.event)).toEqual([
      'CHANGES_REQUESTED',
      'RESUBMITTED',
    ]);
    expect(first.items[0]?.actorNickname).toBe('담당 교직원');
    expect(first.items[1]?.actorNickname).toBe('synthetic-2-1');
    expect(second.items.map((item) => item.event)).toEqual(['SUBMITTED']);
    expect(second.nextCursor).toBeNull();
  });

  it('staff history와 같은 cursor 범위를 적용한다', () => {
    for (const search of [
      'limit=0',
      'limit=51',
      'limit=one',
      'cursor=outside',
    ]) {
      const plan = resolve('GET', HISTORY_PATH, { search, fixture: 'student' });
      expect(statusOf(plan)).toBe(400);
      expect(jsonBody(plan)).toMatchObject({ code: 'MSD_019' });
    }
  });
});

describe('POST .../submissions', () => {
  const SUBMISSION_PATH = `milestones/${MILESTONE_ID}/documents/${DOCUMENT_IDS[0]}/submissions`;

  it('missing·null·non-object content는 400 SYS_003으로 거절한다', () => {
    for (const body of [{}, { content: null }, { content: 'text' }]) {
      const plan = resolve('POST', SUBMISSION_PATH, {
        body,
        fixture: 'student',
      });
      expect(statusOf(plan)).toBe(400);
      expect(jsonBody(plan)).toMatchObject({ code: 'SYS_003' });
    }
  });

  it('유효한 content 객체가 비었으면 422 MSD_008로 거절한다', () => {
    for (const body of [
      { content: {} },
      { content: { text: null, fileId: null } },
      { content: { text: '  ', fileId: '\n\t' } },
    ]) {
      const plan = resolve('POST', SUBMISSION_PATH, {
        body,
        fixture: 'student',
      });
      expect(statusOf(plan)).toBe(422);
      expect(jsonBody(plan)).toMatchObject({
        code: 'MSD_008',
        detail: '제출 내용을 입력해 주세요.',
      });
    }
  });

  it('text와 file content는 각각 제출을 성공시킨다', () => {
    for (const content of [
      { text: '제출 본문', fileId: null },
      { text: null, fileId: 'synthetic-file' },
    ]) {
      expect(
        statusOf(
          resolve('POST', SUBMISSION_PATH, {
            body: { content },
            fixture: 'student',
          }),
        ),
      ).toBe(201);
    }
  });
});

/**
 * 판정 POST. 로컬 검토가 무조건 성공을 돌려주면 **화면의 사유 필수 검증이 사라져도
 * 아무도 못 본다** — 실제 백엔드에 붙였을 때에야 422가 드러난다. 그래서 여기서도
 * 서버와 같은 순서로(교직원 가드 → 요청 값 → 사유 필수) 가른다.
 */
describe('POST .../applications/:applicationId/reviews', () => {
  const REVIEW_PATH = `milestones/${MILESTONE_ID}/documents/${DOCUMENT_IDS[0]}/applications/synthetic-application-${MILESTONE_ID}-1/reviews`;

  /**
   * 기대 버전 두 값은 화면이 언제나 싣는다 — 여기서도 기본으로 얹어, 각 테스트가 자기가
   * 묻는 갈래(사유 필수·권한)만 다루게 한다. 두 값 자체를 묻는 테스트는 `body`로 덮어쓴다.
   */
  const REVIEW_VERSION = {
    expectedRevision: 1,
    expectedLatestReviewId: null,
  };

  function review(
    body: Record<string, unknown>,
    fixture: LocalReviewFixtureId = 'staff',
  ): LocalReviewResponsePlan | null {
    return resolve('POST', REVIEW_PATH, {
      body: { ...REVIEW_VERSION, ...body },
      fixture,
    });
  }

  /** 기대 버전을 **빼고** 보낸다 — 옛 본문을 그대로 흉내 낸다. */
  function reviewWithoutVersion(
    body: Record<string, unknown>,
  ): LocalReviewResponsePlan | null {
    return resolve('POST', REVIEW_PATH, { body, fixture: 'staff' });
  }

  it('사유를 적은 보완 요청은 201로 판정 한 건을 돌려준다', () => {
    const plan = review({
      decision: 'CHANGES_REQUESTED',
      comment: '표지를 고쳐 주세요.',
    });

    expect(statusOf(plan)).toBe(201);
    expect(jsonBody(plan)).toMatchObject({
      decision: 'CHANGES_REQUESTED',
      comment: '표지를 고쳐 주세요.',
      reviewerNickname: '합성 교직원',
    });
  });

  it('승인은 사유 없이 통과한다', () => {
    const plan = review({ decision: 'APPROVED' });

    expect(statusOf(plan)).toBe(201);
    expect(jsonBody(plan)).toMatchObject({
      decision: 'APPROVED',
      comment: null,
    });
  });

  it('사유 없는 보완 요청·반려는 422 MSD_021로 거절한다', () => {
    for (const decision of ['CHANGES_REQUESTED', 'REJECTED']) {
      const plan = review({ decision });
      expect(statusOf(plan)).toBe(422);
      expect(jsonBody(plan)).toMatchObject({ code: 'MSD_021' });
    }
  });

  // 서버도 `trim()` 후 빈 문자열을 null로 접어 거절한다.
  it('공백만 적은 사유도 같이 거절한다', () => {
    const plan = review({ decision: 'REJECTED', comment: '   ' });

    expect(statusOf(plan)).toBe(422);
    expect(jsonBody(plan)).toMatchObject({ code: 'MSD_021' });
  });

  it('학생은 403 MSD_001로 막는다', () => {
    const plan = review({ decision: 'APPROVED' }, 'student');

    expect(statusOf(plan)).toBe(403);
    expect(jsonBody(plan)).toMatchObject({ code: 'MSD_001' });
  });

  /**
   * 기대 버전을 빼먹은 옛 본문. 여기서 통과시키면 그 화면은 로컬 검토에서만 멀쩡히
   * 저장되고, 실제 백엔드에서는 **판정 저장이 통째로 400으로 실패한다**.
   */
  it('기대 버전 두 값이 없으면 400 MSD_019로 거절한다', () => {
    for (const body of [
      { decision: 'APPROVED' },
      { decision: 'APPROVED', expectedRevision: 1 },
      { decision: 'APPROVED', expectedLatestReviewId: null },
      // 번호를 **문자열로** 실은 본문. 느슨하게 받으면 실제 백엔드에서만 400이 난다.
      {
        decision: 'APPROVED',
        expectedRevision: '1',
        expectedLatestReviewId: null,
      },
      /*
       * 백엔드는 `@IsInt() @Min(1)`로 받는다 — 첫 제출이 1이라 0·음수·소수는 어떤
       * 제출도 가리키지 않는다. 여기서 받아 주면 그런 값을 싣는 화면이 로컬 검토에서만
       * 멀쩡해 보이고, 실제 백엔드에 붙어서야 판정 저장이 통째로 실패한다.
       */
      {
        decision: 'APPROVED',
        expectedRevision: 0,
        expectedLatestReviewId: null,
      },
      {
        decision: 'APPROVED',
        expectedRevision: -1,
        expectedLatestReviewId: null,
      },
      {
        decision: 'APPROVED',
        expectedRevision: 1.5,
        expectedLatestReviewId: null,
      },
    ]) {
      const plan = reviewWithoutVersion(body);
      expect(statusOf(plan)).toBe(400);
      expect(jsonBody(plan)).toMatchObject({ code: 'MSD_019' });
    }
  });

  // 아직 판정이 없던 칸은 **명시된 `null`**로 온다 — 서버가 그것만 허용한다.
  it('expectedLatestReviewId는 문자열도 명시된 null도 받는다', () => {
    expect(
      statusOf(review({ decision: 'APPROVED', expectedLatestReviewId: null })),
    ).toBe(201);
    expect(
      statusOf(
        review({ decision: 'APPROVED', expectedLatestReviewId: 'review-1' }),
      ),
    ).toBe(201);
  });

  it('계약에 없는 판정 값은 400으로 거절한다', () => {
    const plan = review({ decision: 'MAYBE' });

    expect(statusOf(plan)).toBe(400);
    expect(jsonBody(plan)).toMatchObject({ code: 'MSD_019' });
  });

  /**
   * 이 경로는 제출 파일 다운로드(`.../applications/:applicationId/file`)와 세그먼트 수가
   * 같다. 두 핸들러가 서로의 요청을 집으면 판정이 「파일 없음」 404로 조용히 죽는다.
   */
  it('같은 모양의 파일 다운로드 경로를 가로채지 않는다', () => {
    const filePath = REVIEW_PATH.replace(/reviews$/, 'file');

    expect(statusOf(resolve('GET', filePath))).toBe(404);
    expect(jsonBody(resolve('GET', filePath))).toMatchObject({
      code: 'MSD_020',
    });
  });
});

/**
 * 수합 표의 칸에 붙는 상태와 판정. 검토자가 네 배지(검토 대기·승인·보완 요청·반려)와
 * **다시 낸 뒤 검토 대기**까지 한 표에서 다 볼 수 있어야 한다 — 하나라도 빠지면 그 칸이
 * 어떻게 보이는지 아무도 확인하지 못한 채 넘어간다.
 */
describe('수합 표 픽스처의 상태·판정 시드', () => {
  function orientationCollection(): MilestoneDocumentCollection {
    return jsonBody(
      resolve('GET', `milestones/${MILESTONE_ID}/documents/collection`),
    ) as MilestoneDocumentCollection;
  }

  function submittedCells() {
    return orientationCollection()
      .rows.flatMap((row) => row.cells)
      .filter((cell) => cell.isSubmitted);
  }

  /**
   * 상태와 판정을 **짝으로** 본다. 상태만 세면 「다시 낸 칸」이 평범한 검토 대기와
   * 구분되지 않아, 배지를 다시 판정 기준으로 되돌려도 이 시드로는 아무것도 드러나지 않는다.
   */
  it('한 표에서 다섯 갈래가 모두 보인다 — 네 배지와 「다시 낸 뒤 검토 대기」', () => {
    const shapes = submittedCells().map(
      (cell) => `${cell.status}+${cell.review?.decision ?? 'none'}`,
    );

    expect(new Set(shapes)).toEqual(
      new Set([
        'SUBMITTED+none',
        'APPROVED+APPROVED',
        'CHANGES_REQUESTED+CHANGES_REQUESTED',
        'REJECTED+REJECTED',
        'SUBMITTED+CHANGES_REQUESTED',
      ]),
    );
  });

  // 상태도 판정도 제출에 붙는다 — 미제출 칸에 실리면 「안 낸 팀이 승인됨」이 된다.
  it('미제출 칸에는 상태도 판정도 싣지 않는다', () => {
    const cells = orientationCollection().rows.flatMap((row) => row.cells);

    expect(
      cells
        .filter((cell) => !cell.isSubmitted)
        .every((cell) => cell.status === null && cell.review === null),
    ).toBe(true);
  });

  /**
   * 판정 시각이 제출 시각보다 앞서면 「내기 전에 판정했다」로 읽힌다.
   *
   * ⚠ **다시 낸 칸만 반대다.** 상태가 `SUBMITTED`로 돌아왔는데 판정이 남아 있다는 것은
   * 그 지적을 받고 다시 냈다는 뜻이라, 지난 판정이 지금 제출보다 앞서야 앞뒤가 맞는다.
   */
  it('판정 시각은 제출 시각보다 뒤다 — 다시 낸 칸만 앞선다', () => {
    const reviewed = submittedCells().filter(
      (cell) => cell.review !== null && cell.submittedAt !== null,
    );
    const resubmitted = reviewed.filter((cell) => cell.status === 'SUBMITTED');

    expect(reviewed.length).toBeGreaterThan(0);
    expect(resubmitted).toHaveLength(1);
    for (const cell of reviewed) {
      const reviewedAt = Date.parse(cell.review?.reviewedAt ?? '');
      const submittedAt = Date.parse(cell.submittedAt ?? '');
      if (cell.status === 'SUBMITTED') {
        expect(reviewedAt).toBeLessThan(submittedAt);
      } else {
        expect(reviewedAt).toBeGreaterThan(submittedAt);
      }
    }
  });

  /**
   * 판정은 표시값이지 업무 규칙이 아니다. 판정을 붙이면서 제출 여부가 흔들리면 필터·
   * 합계가 조용히 뜻을 바꾼다 — 「미제출」 기준은 여전히 「제출 행이 없다」이다.
   */
  it('판정을 붙여도 합계는 제출 여부만 센다', () => {
    const data = orientationCollection();

    for (const [index, total] of data.documentTotals.entries()) {
      const submitted = data.rows.filter(
        (row) => row.cells[index]?.isSubmitted === true,
      ).length;
      expect(total.submitted).toBe(submitted);
    }
  });
});
