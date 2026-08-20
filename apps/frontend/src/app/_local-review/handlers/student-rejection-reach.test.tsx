// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiPath } from '@/lib/api-client';
import { REJECTION_REASON_MAX_LINES } from '@/lib/display-text';
import type { LocalReviewFixtureId } from '../fixture-contract';
import { resolveLocalReviewResponse } from '../fixture-response';
import { MY_APPLICATION_FIXTURES } from './student-program-fixtures';

/**
 * 반려 사유가 **화면에 실제로 나타나는가**(#722·#733).
 *
 * 왜 이 파일이 따로 필요한가. 사유를 그리는 조각(`RejectionReasonAlert`)에는 이미 단위
 * 테스트가 있었고(`features/programs/program-apply-page.test.tsx`), 픽스처가 사유를 실어
 * 준다는 테스트도 있었다(`student-handlers.test.ts`). 그런데 그 둘 사이 — **불러오기가
 * 그 조각까지 이어지는가** — 를 확인하는 것은 없었다. `student-handlers.test.ts`에는
 * "화면이 사유를 그리는 조건을 만족한다"는 이름의 테스트가 있었지만 화면을 렌더하지
 * 않고 응답 필드만 봤다. 불러오기가 내 신청서 조회를 그만두거나 `BlockedView`에
 * 신청서를 넘기지 않도록 바뀌어도 그 테스트는 초록불이고 화면만 비었을 것이다.
 * 같은 형태의 결함이 역할 요청 쪽에서 실제로 났고(#673), 그때 세운 대응이
 * `app/_shell/onboarding-rejection-reach.test.tsx`다. 이 파일은 신청 반려 갈래의 같은 자리다.
 *
 * 그래서 여기서는 학생 대시보드의 반려 카드가 보내는 목적지(`/programs/{id}/apply`)의
 * 화면을 **불러오기째 마운트**하고, 사유 원문이 DOM에 있는지를 단언한다. 가짜는 네트워크
 * 경계 하나에만 세운다 — 그 위(불러오기·판정·화면)는 전부 진짜로 돌아야 "도달"을 검사한
 * 것이 된다. 네트워크가 돌려주는 값은 로컬 검토 픽스처 규칙 그대로라, 검토자가 브라우저로
 * 보는 것과 같은 응답을 화면이 받는다.
 */

const FIXTURE: LocalReviewFixtureId = 'student';
/** 반려된 신청 픽스처가 있는 프로그램. 사유는 이 프로그램 응답에만 실려 온다. */
const PROGRAM_ID = 'program-sw-value';
const SESSION_USER = {
  name: '합성 학생',
  nickname: 'synthetic-student',
} as const;

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

import { ProgramApplyPage } from '@/features/programs/program-apply-page';

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

/**
 * 불러오기가 여러 단계로 이어져 있어(`Promise.all` 뒤에 내 신청서 조회가 한 번 더 온다)
 * 한 번의 flush로는 끝까지 가지 않는다.
 *
 * ⚠ 고정 횟수로 마이크로태스크를 돌리지 않는다 — 단계가 하나 늘면 **화면이 멀쩡한데도**
 * 단언이 골격 상태에서 돌아 엉뚱하게 실패한다. 저장소 관례대로(`milestone-document-list`
 * 등) 보고 싶은 상태가 될 때까지 기다린다.
 */
async function settleUntil(assert: () => void): Promise<void> {
  await vi.waitFor(() => {
    assert();
  });
}

describe('반려된 신청의 사유가 신청 상세 화면에 도달한다', () => {
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

  it('신청 상세 화면이 사유 원문을 한 글자도 잃지 않고 보여 준다', async () => {
    // Given: 검토자가 브라우저에서 받는 것과 같은 반려 사유
    const reason = MY_APPLICATION_FIXTURES[PROGRAM_ID]?.rejectionReason;
    if (reason === undefined || reason === null) {
      throw new Error('반려 사유가 실린 신청 픽스처가 필요합니다.');
    }

    // When: 반려 카드·반려 알림이 보내는 목적지 화면을 불러오기째 연다
    await act(async () => {
      root.render(
        <ProgramApplyPage
          programId={PROGRAM_ID}
          sessionUser={SESSION_USER}
          teamId={null}
        />,
      );
    });
    await settleUntil(() => {
      expect(container.textContent ?? '').toContain('반려 사유');
    });

    // Then: 라벨만이 아니라 사유 본문이 통째로 보인다.
    const text = container.textContent ?? '';
    expect(text).toContain('반려 사유');
    expect(text).toContain(reason);

    // And: 이 화면은 자르지 않는다 — 재신청 마감 같은 마지막 줄이 살아 있어야 한다.
    // 역할 요청 쪽 상한을 넘는 길이여야 그 계약을 눈으로도 확인할 수 있다.
    const lines = reason.split('\n');
    expect(lines.length).toBeGreaterThan(REJECTION_REASON_MAX_LINES);
    expect(text).toContain(lines[lines.length - 1]);
    expect(text).not.toContain('…');
  });

  it('판정이 끝난 신청이라 수정·취소로 갈리지 않는다', async () => {
    // Given / When
    await act(async () => {
      root.render(
        <ProgramApplyPage
          programId={PROGRAM_ID}
          sessionUser={SESSION_USER}
          teamId={null}
        />,
      );
    });
    await settleUntil(() => {
      expect(container.textContent ?? '').toContain(
        '수정할 수 없는 신청입니다',
      );
    });

    // Then: 신청 양식으로 갈렸다면 사유 상자는 애초에 그려지지 않는다.
    // 막힌 화면에 도착했다는 것과, 양식 화면이 아니라는 것을 각각 고정한다.
    const text = container.textContent ?? '';
    expect(text).toContain('수정할 수 없는 신청입니다');
    expect(text).not.toContain('신청서 수정·취소 안내');
  });
});
