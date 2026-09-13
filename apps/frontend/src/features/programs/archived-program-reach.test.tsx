// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiPath } from '@/lib/api-client';
import type { ProgramDetail } from './types';

/**
 * 내린 프로그램의 상세가 **불러오기째** 학생에게 신청을 권하지 않는가(#1092).
 *
 * `program-detail.test.tsx`는 `lifecycle: 'ARCHIVED'` 리터럴을 뷰에 직접 넘긴다.
 * `program-list.test.ts`는 목록 항목만으로 종료 판정을 본다. 둘 다 로더가 게시 축을
 * 그만 읽거나 응답을 뷰에 넘기지 않도록 바뀌어도 초록불이다. 이 파일은 네트워크
 * 경계만 가짜로 두고 로더·판정·화면을 진짜로 돌린다. 신청 기간 안쪽 시각은 Date만
 * 고정하고 waitFor 타이머는 그대로 둔다.
 */

const PROGRAM_ID = 'program-archived-internship';

/**
 * 신청 기간 **안쪽** 한 순간. 벽시계를 쓰지 않으므로 달력이 지나도
 * 「기간은 열려 있는데 내려서 종료」라는 대조가 변하지 않는다.
 */
const INSIDE_APPLICATION_PERIOD = new Date('2026-06-01T00:00:00.000Z');

const ARCHIVED_DETAIL = {
  id: PROGRAM_ID,
  name: '합성 내린 인턴십',
  organizer: '합성 운영기관',
  trackType: 'EXTRACURRICULAR',
  applicationTemplateKey: 'basic',
  lifecycle: 'ARCHIVED',
  description: '기간은 열려 있으나 게시 축이 내린 합성 프로그램.',
  repositoryProvisioningEnabled: false,
  applicationPeriod: {
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2026-12-31T23:59:59.000Z',
  },
  viewer: { role: 'STUDENT', applicationStatus: null },
  milestones: [],
} as const satisfies ProgramDetail;

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

import { ProgramDetailPage } from './program-detail-page';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function detailFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(String(input), 'http://127.0.0.1');
  const method = init?.method ?? 'GET';
  if (method !== 'GET') {
    throw new Error(`unexpected ${method} ${url.pathname}`);
  }
  if (url.pathname === apiPath(`programs/${PROGRAM_ID}/viewer`)) {
    return Promise.resolve(jsonResponse(ARCHIVED_DETAIL));
  }
  if (url.pathname === apiPath(`programs/${PROGRAM_ID}/overview`)) {
    return Promise.resolve(
      jsonResponse({
        programId: PROGRAM_ID,
        name: ARCHIVED_DETAIL.name,
        trackType: ARCHIVED_DETAIL.trackType,
        lifecycle: ARCHIVED_DETAIL.lifecycle,
        milestoneCount: 0,
        boardPostCount: 0,
        participantCount: 0,
        teamCount: 0,
        connectedRepositoryCount: 0,
        viewerRole: 'STUDENT',
        viewerDocumentsCompleted: 0,
        viewerDocumentsTotal: 0,
        fullySubmittedParticipantCount: null,
        remainingMilestones: [],
        milestoneDocuments: [],
      }),
    );
  }
  throw new Error(`unexpected request ${url.pathname}`);
}

describe('내린 프로그램의 상세 화면이 신청을 권하지 않는다', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(INSIDE_APPLICATION_PERIOD);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.stubGlobal('fetch', vi.fn(detailFetch));
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function openDetail(): Promise<void> {
    await act(async () => {
      root.render(<ProgramDetailPage programId={PROGRAM_ID} />);
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector('[data-slot="page-header-title"]'),
      ).not.toBeNull();
    });
  }

  it('제목 옆 배지가 「종료」다', async () => {
    await openDetail();

    const badge = container.querySelector(
      '[data-slot="page-header-title"] [data-slot="status-badge"]',
    );
    expect(badge?.textContent).toBe('종료');
    expect(badge?.getAttribute('data-variant')).toBe('closed');
  });

  it('신청 버튼이 남아 있되 비활성이고, 왜 못 누르는지가 같은 자리에 적힌다', async () => {
    await openDetail();

    const applyButtons = [...container.querySelectorAll('button')].filter(
      (button) => button.textContent?.trim() === '신청하기',
    );
    expect(applyButtons).toHaveLength(1);
    const applyButton = applyButtons[0] as HTMLButtonElement;
    expect(applyButton.disabled).toBe(true);

    expect(
      [...container.querySelectorAll('a')].filter(
        (anchor) => anchor.textContent?.trim() === '신청하기',
      ),
    ).toEqual([]);

    const reasonId = applyButton.getAttribute('aria-describedby');
    expect(reasonId).not.toBeNull();
    const reason = container.querySelector(`[id="${reasonId ?? ''}"]`);
    expect(reason?.textContent).toContain(
      '종료된 프로그램이라 신청을 받지 않습니다.',
    );
  });
});
