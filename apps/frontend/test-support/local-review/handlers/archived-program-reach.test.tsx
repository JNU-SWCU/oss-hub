// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProgramRecruitmentState } from '@/features/programs/program-list';
import type {
  ProgramDetail,
  ProgramListItem,
  ProgramListPage,
} from '@/features/programs/types';
import { apiPath } from '@/lib/api-client';
import type { LocalReviewFixtureId } from '@/lib/local-review-runtime';
import { resolveLocalReviewResponse } from '../fixture-response';

/**
 * **내린 프로그램의 상세가 학생에게 신청을 권하지 않는가**(#1092).
 *
 * 왜 이 파일이 따로 필요한가. 고친 화면 조각에는 이미 단위 테스트가 있다
 * (`features/programs/program-detail.test.tsx`가 `lifecycle: 'ARCHIVED'` 리터럴을
 * 직접 넘긴다). 그런데 **로컬 검토 픽스처에는 내린 프로그램이 한 건도 없었다** —
 * 검토자가 하네스를 켜고 브라우저로 이 수정을 확인하려 해도 볼 대상이 없었고,
 * PR에 붙일 After 캡처를 찍을 화면도 없었다. 이 파일은 그 공백을 메운 픽스처
 * (`program-archived-internship`)가 실제로 그 화면까지 도달하는지를 고정한다.
 *
 * 그래서 여기서는 **목록과 상세를 함께** 본다. 이 결함의 정체가 「같은 프로그램이
 * 목록에서는 종료인데 상세에서는 모집중」이었기 때문이다. 한쪽만 보면 두 화면이
 * 다시 갈라져도 초록불이다.
 *
 * 상세는 화면을 **불러오기째 마운트**한다. 응답 필드만 보는 검사는 불러오기가
 * 게시 축을 그만 읽도록 바뀌어도 초록불이고 화면만 옛 모습으로 돌아간다 —
 * `student-rejection-reach.test.tsx`가 같은 이유로 세워진 파일이다. 가짜는 네트워크
 * 경계 하나에만 세우고, 그 위(불러오기·판정·화면)는 전부 진짜로 돌린다.
 */

const FIXTURE: LocalReviewFixtureId = 'student';
/** 내린 프로그램 픽스처. 목록·상세 양쪽에 같은 id로 실려 있어야 한다. */
const PROGRAM_ID = 'program-archived-internship';

/**
 * 이 프로그램의 신청 기간 **안쪽** 한 순간. 벽시계(`new Date()`)를 쓰지 않으므로
 * 달력이 지나도 이 검사의 뜻이 변하지 않는다 — 「기간은 열려 있는데 내려서 종료」라는
 * 대조를 고정하는 것이 목적이지, 오늘이 그 기간 안인지를 묻는 것이 아니다.
 */
const INSIDE_APPLICATION_PERIOD = new Date('2026-06-01T00:00:00.000Z');

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.ComponentProps<'a'> & { readonly href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
}));

import { ProgramDetailPage } from '@/features/programs/program-detail-page';

function jsonBody(
  fixture: LocalReviewFixtureId,
  path: string,
  search = '',
): unknown {
  const plan = resolveLocalReviewResponse({
    fixture,
    method: 'GET',
    path,
    searchParams: new URLSearchParams(search),
  });
  if (plan.kind !== 'json' || plan.status !== 200) {
    throw new Error(`200 json 응답이 필요합니다: ${path}`);
  }
  return plan.body;
}

/** 공개 목록 — 비로그인 검토자가 `/programs`에서 받는 것과 같은 응답이다. */
function programListPage(search: string): ProgramListPage {
  return jsonBody('anonymous', 'programs', search) as ProgramListPage;
}

function listedProgram(programId: string): ProgramListItem {
  const found = programListPage('page=1&pageSize=50&status=all').items.find(
    (item) => item.id === programId,
  );
  if (found === undefined) {
    throw new Error(`공개 목록에 없는 프로그램입니다: ${programId}`);
  }
  return found;
}

/**
 * 같은 항목에서 **게시 축만** 뺀 값. 날짜는 그대로 두므로, 이 값이 「모집중」이면
 * 이 프로그램을 종료로 만드는 것이 날짜가 아니라 `lifecycle`이라는 뜻이다.
 */
function withoutLifecycle(item: ProgramListItem): ProgramListItem {
  return {
    id: item.id,
    name: item.name,
    organizer: item.organizer,
    category: item.category,
    applicationStartAt: item.applicationStartAt,
    applicationEndAt: item.applicationEndAt,
    endAt: item.endAt,
    description: item.description,
  };
}

/** `/api/v1` 접두사를 떼고 픽스처 규칙에 그대로 넘긴다 — 로컬 검토 route가 하는 일과 같다. */
function localReviewFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(String(input), 'http://127.0.0.1');
  const prefix = apiPath('');
  const plan = resolveLocalReviewResponse({
    fixture: FIXTURE,
    method: init?.method ?? 'GET',
    path: url.pathname.startsWith(prefix)
      ? url.pathname.slice(prefix.length)
      : url.pathname,
    searchParams: url.searchParams,
  });
  if (plan.kind !== 'json') {
    throw new Error(`이 화면은 json 응답만 받는다: ${url.pathname}`);
  }
  return Promise.resolve(
    new Response(JSON.stringify(plan.body), {
      status: plan.status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('내린 프로그램이 학생의 목록과 상세에 도달한다', () => {
  it('공개 목록에서 종료로 걸린다 — 모집중 목록에는 없다', () => {
    // Given / When: 검토자가 사이드바에서 상태를 눌러 거른 결과와 같은 응답이다.
    const ended = programListPage('page=1&pageSize=50&status=ended');
    const recruiting = programListPage('page=1&pageSize=50&status=recruiting');

    // Then
    expect(ended.items.map((item) => item.id)).toContain(PROGRAM_ID);
    expect(recruiting.items.map((item) => item.id)).not.toContain(PROGRAM_ID);
  });

  it('신청 기간은 아직 열려 있다 — 종료로 만드는 것은 날짜가 아니라 게시 축이다', () => {
    // Given
    const item = listedProgram(PROGRAM_ID);

    // Then: 기간이 닫혀 있으면 옛 동작(기간만 보고 판정)으로 되돌아가도 화면이
    // 똑같이 보인다 — 이 프로그램이 검토 대상이 되는 이유가 사라진다.
    expect(item.lifecycle).toBe('ARCHIVED');
    expect(new Date(item.applicationStartAt).getTime()).toBeLessThanOrEqual(
      INSIDE_APPLICATION_PERIOD.getTime(),
    );
    expect(new Date(item.applicationEndAt).getTime()).toBeGreaterThanOrEqual(
      INSIDE_APPLICATION_PERIOD.getTime(),
    );
    // 운영 종료일도 비어 있다 — 그쪽이 지나 있으면 그것만으로도 종료가 된다.
    expect(item.endAt).toBeNull();

    // And: 같은 순간에 게시 축만 빼면 모집중이다.
    expect(
      getProgramRecruitmentState(
        withoutLifecycle(item),
        INSIDE_APPLICATION_PERIOD,
      ),
    ).toBe('recruiting');
    expect(
      getProgramRecruitmentState(item, INSIDE_APPLICATION_PERIOD),
    ).toBe('ended');
  });

  /**
   * 공개 목록과 상세 픽스처는 **다른 파일**에 산다(`fixture-response.ts`와
   * `handlers/student-program-fixtures.ts`). 한쪽만 고치면 검토자는 목록에서 눌러
   * 들어간 자리에서 「프로그램을 찾을 수 없습니다」를 보고 제품 결함으로 읽는다.
   */
  it('공개 목록에 실린 프로그램은 모두 학생 상세 응답을 갖는다', () => {
    // Given / When
    const listed = programListPage('page=1&pageSize=50&status=all').items;

    // Then
    expect(listed.length).toBeGreaterThan(0);
    for (const item of listed) {
      const detail = jsonBody(
        FIXTURE,
        `programs/${item.id}/viewer`,
      ) as ProgramDetail;
      expect(detail.id).toBe(item.id);
    }
  });

  it('상세 응답이 내림과 신청 전 상태를 함께 싣는다', () => {
    // Given / When
    const detail = jsonBody(
      FIXTURE,
      `programs/${PROGRAM_ID}/viewer`,
    ) as ProgramDetail;

    // Then: 신청 전이어야 신청 버튼이 그려지는 갈래를 지나간다 — 이미 신청한
    // 상태면 화면이 신청 입구 자체를 그리지 않아 확인할 대상이 사라진다.
    expect(detail.lifecycle).toBe('ARCHIVED');
    expect(detail.viewer).toEqual({
      role: 'STUDENT',
      applicationStatus: null,
    });
  });
});

describe('내린 프로그램의 상세 화면이 신청을 권하지 않는다', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.stubGlobal('fetch', vi.fn(localReviewFetch));
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  async function openDetail(): Promise<void> {
    await act(async () => {
      root.render(<ProgramDetailPage programId={PROGRAM_ID} />);
    });
    // 불러오기가 상세 → 개요로 이어져 한 번의 flush로는 끝나지 않는다. 고정 횟수로
    // 돌리지 않고 보고 싶은 상태가 될 때까지 기다린다(저장소 관례).
    await vi.waitFor(() => {
      expect(
        container.querySelector('[data-slot="page-header-title"]'),
      ).not.toBeNull();
    });
  }

  it('제목 옆 배지가 「종료」다 — 목록이 말한 것과 같은 상태다', async () => {
    // Given / When
    await openDetail();

    // Then: 마일스톤 줄에도 배지가 있으므로 머리말 안의 배지만 본다.
    const badge = container.querySelector(
      '[data-slot="page-header-title"] [data-slot="status-badge"]',
    );
    expect(badge?.textContent).toBe('종료');
    expect(badge?.getAttribute('data-variant')).toBe('closed');
  });

  it('신청 버튼이 남아 있되 비활성이고, 왜 못 누르는지가 같은 자리에 적힌다', async () => {
    // Given / When
    await openDetail();

    // Then: 버튼을 지우면 학생은 자기가 잘못 들어온 줄 안다 — 남기되 못 누르게 한다.
    const applyButtons = [...container.querySelectorAll('button')].filter(
      (button) => button.textContent?.trim() === '신청하기',
    );
    expect(applyButtons).toHaveLength(1);
    const applyButton = applyButtons[0] as HTMLButtonElement;
    expect(applyButton.disabled).toBe(true);

    // And: 신청 화면으로 가는 링크는 아예 그려지지 않는다.
    expect(
      [...container.querySelectorAll('a')].filter(
        (anchor) => anchor.textContent?.trim() === '신청하기',
      ),
    ).toEqual([]);

    // And: 이유가 화면에 있고 버튼에 묶여 있다. `disabled` 버튼은 포인터 이벤트를
    // 받지 못해 툴팁으로는 이유를 전할 수 없다.
    const reasonId = applyButton.getAttribute('aria-describedby');
    expect(reasonId).not.toBeNull();
    const reason = container.querySelector(`[id="${reasonId ?? ''}"]`);
    expect(reason?.textContent).toContain(
      '종료된 프로그램이라 신청을 받지 않습니다.',
    );
  });
});
