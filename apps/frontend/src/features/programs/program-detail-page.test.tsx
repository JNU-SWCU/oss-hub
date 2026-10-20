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

const navigation = vi.hoisted(() => ({ search: new URLSearchParams() }));

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
  useSearchParams: () => navigation.search,
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

async function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  if (url === apiPath(`programs/${PROGRAM_ID}`)) return json(PUBLIC_DETAIL);
  if (url === apiPath(`programs/${PROGRAM_ID}/viewer`))
    return problem(401, `/programs/${PROGRAM_ID}/viewer`);
  if (url === apiPath(`programs/${PROGRAM_ID}/overview`))
    return problem(401, `/programs/${PROGRAM_ID}/overview`);
  throw new Error(`unexpected request: ${url}`);
}

describe('ProgramDetailPage — 세션 유무별 호출', () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    navigation.search = new URLSearchParams();
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

  it('학생 상세의 늦은 응답이 이미 전환한 운영 화면을 덮어쓰지 않는다', async () => {
    let resolveStudent: (response: Response) => void = () => {
      throw new Error('student request not started');
    };
    const delayedStudent = new Promise<Response>((resolve) => {
      resolveStudent = resolve;
    });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/viewer')) return delayedStudent;
      if (url.endsWith('/viewer?view=operations'))
        return json({
          ...PUBLIC_DETAIL,
          name: '운영 화면 결과',
          viewer: { role: 'STAFF', applicationStatus: null },
        });
      return problem(401, url);
    });
    await act(async () =>
      root.render(
        <ProgramDetailPage programId={PROGRAM_ID} session="present" />,
      ),
    );
    navigation.search = new URLSearchParams('view=operations');
    await act(async () =>
      root.render(
        <ProgramDetailPage programId={PROGRAM_ID} session="present" />,
      ),
    );
    expect(container.textContent).toContain('운영 화면 결과');
    await act(async () =>
      resolveStudent(
        json({
          ...PUBLIC_DETAIL,
          name: '이전 학생 화면',
          viewer: { role: 'STUDENT', applicationStatus: 'APPROVED' },
        }),
      ),
    );
    expect(container.textContent).toContain('운영 화면 결과');
    expect(container.textContent).not.toContain('이전 학생 화면');
  });

  it('제출 후 요약과 단계 상태를 갱신하면서 열린 상세 DOM을 유지한다', async () => {
    let submitted = false;
    let failRefresh = false;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/viewer')) {
        if (failRefresh) return problem(503, url);
        return json({
          ...PUBLIC_DETAIL,
          viewer: { role: 'STUDENT', applicationStatus: 'APPROVED' },
          milestones: [
            {
              id: 'plan',
              name: '계획서',
              dueAt: '2099-01-01T00:00:00.000Z',
              dDay: 1,
              deadlineLabel: 'D-1',
              description: null,
              submissionType: 'TEXT',
              submissionItemCount: 0,
              viewerSubmissionStatus: submitted ? 'SUBMITTED' : 'NOT_SUBMITTED',
              applicationSubmissionSummary: null,
            },
          ],
        });
      }
      if (url.endsWith('/overview'))
        return json({
          programId: PROGRAM_ID,
          viewerRole: 'STUDENT',
          participantCount: 1,
          teamCount: 1,
          connectedRepositoryCount: 0,
          viewerDocumentsCompleted: submitted ? 1 : 0,
          viewerDocumentsTotal: 1,
        });
      return problem(404, url);
    });
    await act(async () =>
      root.render(
        <ProgramDetailPage programId={PROGRAM_ID} session="present" />,
      ),
    );
    expect(container.textContent).toContain('0 / 1 서류');
    expect(container.textContent).toContain('미제출');
    const group = container.querySelector('[data-testid="milestone-group"]');
    submitted = true;
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent('oss-hub:milestone-document-submitted', {
          detail: { milestoneId: 'other-program' },
        }),
      ),
    );
    expect(container.textContent).toContain('0 / 1 서류');
    expect(
      requestedPaths().filter((path) => path.endsWith('/viewer')),
    ).toHaveLength(1);
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent('oss-hub:milestone-document-submitted', {
          detail: { milestoneId: 'plan' },
        }),
      ),
    );
    expect(container.textContent).toContain('1 / 1 서류');
    expect(container.textContent).not.toContain('미제출');
    expect(container.querySelector('[data-testid="milestone-group"]')).toBe(
      group,
    );
    failRefresh = true;
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent('oss-hub:milestone-document-submitted', {
          detail: { milestoneId: 'plan' },
        }),
      ),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '집계',
    );
    expect(container.querySelector('[data-testid="milestone-group"]')).toBe(
      group,
    );
    failRefresh = false;
    const retry = container.querySelector('[role="alert"] button');
    if (!(retry instanceof HTMLButtonElement))
      throw new TypeError('retry button missing');
    await act(async () => retry.click());
    expect(container.textContent).not.toContain(
      '제출은 저장되었지만 집계를 갱신하지 못했습니다.',
    );
    expect(container.textContent).toContain('1 / 1 서류');
  });

  it('비로그인이면 공개 상세만 부르고 viewer·overview는 부르지 않는다', async () => {
    await act(async () => {
      root.render(
        <ProgramDetailPage programId={PROGRAM_ID} session="anonymous" />,
      );
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain('합성 공개 프로그램');
    });

    expect(requestedPaths()).toEqual([apiPath(`programs/${PROGRAM_ID}`)]);
  });

  it('세션을 아직 모르면 아무것도 부르지 않고 뼈대만 그린다', async () => {
    await act(async () => {
      root.render(
        <ProgramDetailPage programId={PROGRAM_ID} session="unknown" />,
      );
    });

    expect(requestedPaths()).toEqual([]);
    expect(
      container.querySelector('main[aria-label="프로그램 상세 불러오는 중"]'),
    ).not.toBeNull();
  });

  it('세션이 있으면 viewer를 먼저 부르고 401이면 공개 상세로 내려간다', async () => {
    await act(async () => {
      root.render(
        <ProgramDetailPage programId={PROGRAM_ID} session="present" />,
      );
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
