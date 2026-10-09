import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiPath } from '@/lib/api-client';
import type { ProgramDetail } from './types';

const PROGRAM_ID = 'program-public';

const PUBLIC_DETAIL = {
  id: PROGRAM_ID,
  name: '합성 공개 프로그램',
  organizer: '합성 운영기관',
  trackType: 'EXTRACURRICULAR',
  applicationTemplateKey: 'basic',
  lifecycle: 'PUBLISHED',
  description: '누구나 볼 수 있는 합성 프로그램.',
  repositoryProvisioningEnabled: false,
  applicationPeriod: {
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2026-12-31T23:59:59.000Z',
  },
  viewer: { role: null, applicationStatus: null },
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
  usePathname: () => `/programs/${PROGRAM_ID}`,
  useSearchParams: () => new URLSearchParams(),
}));

import { ProgramDetailPage } from './program-detail-page';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type':
        status >= 400 ? 'application/problem+json' : 'application/json',
    },
  });
}

function problem(status: number, instance: string): Response {
  return json(
    {
      type: 'about:blank',
      title: 'UNAUTHORIZED',
      status,
      detail: '인증이 필요합니다.',
      instance,
      code: 'AUT_003',
    },
    status,
  );
}

function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  if (url === apiPath(`programs/${PROGRAM_ID}`))
    return Promise.resolve(json(PUBLIC_DETAIL));
  if (url === apiPath(`programs/${PROGRAM_ID}/viewer`))
    return Promise.resolve(problem(401, `/programs/${PROGRAM_ID}/viewer`));
  if (url === apiPath(`programs/${PROGRAM_ID}/overview`))
    return Promise.resolve(problem(401, `/programs/${PROGRAM_ID}/overview`));
  return Promise.reject(new Error(`unexpected request: ${url}`));
}

describe('ProgramDetailPage — 세션 유무별 호출', () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    fetchMock = vi.fn(fakeFetch);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  function requestedPaths(): string[] {
    return fetchMock.mock.calls.map((call) => String(call[0]));
  }

  it('비로그인이면 공개 상세만 부르고 viewer·overview는 부르지 않는다', async () => {
    await act(() => {
      root.render(
        <ProgramDetailPage programId={PROGRAM_ID} session="anonymous" />,
      );

      return Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain('합성 공개 프로그램');
    });

    expect(requestedPaths()).toEqual([apiPath(`programs/${PROGRAM_ID}`)]);
  });

  it('세션을 아직 모르면 아무것도 부르지 않고 뼈대만 그린다', async () => {
    await act(() => {
      root.render(
        <ProgramDetailPage programId={PROGRAM_ID} session="unknown" />,
      );

      return Promise.resolve();
    });

    expect(requestedPaths()).toEqual([]);
    expect(
      container.querySelector('main[aria-label="프로그램 상세 불러오는 중"]'),
    ).not.toBeNull();
  });

  it('세션이 있으면 viewer를 먼저 부르고 401이면 공개 상세로 내려간다', async () => {
    await act(() => {
      root.render(
        <ProgramDetailPage programId={PROGRAM_ID} session="present" />,
      );

      return Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain('합성 공개 프로그램');
    });

    expect(requestedPaths()).toEqual([
      apiPath(`programs/${PROGRAM_ID}/viewer`),
      apiPath(`programs/${PROGRAM_ID}`),
      apiPath(`programs/${PROGRAM_ID}/overview`),
    ]);
  });
});
