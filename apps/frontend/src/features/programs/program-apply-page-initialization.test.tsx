// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadProgramApplyContext,
  type ProgramApplyContext,
} from './load-program-apply-context';
import { ProgramApplyPage } from './program-apply-page';

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
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('./load-program-apply-context', () => ({
  loadProgramApplyContext: vi.fn(),
}));

const loadProgramApplyContextMock = vi.mocked(loadProgramApplyContext);

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

type ReadyContext = Extract<ProgramApplyContext, { readonly kind: 'ready' }>;

function readyContext(
  programId: string,
  initialTitle: string,
  teamId: string | null = null,
): ReadyContext {
  return {
    kind: 'ready',
    mode: 'create',
    program: {
      id: programId,
      name: `${programId} 프로그램`,
      organizer: '합성 운영처',
      category: 'BASIC',
      description: '합성 설명',
      repositoryProvisioningEnabled: true,
      applicationPeriod: {
        startsAt: '2026-08-01T00:00:00.000Z',
        endsAt: '2026-08-31T00:00:00.000Z',
      },
      viewer: { role: 'STUDENT', applicationStatus: null },
      milestones: [],
    },
    template: {
      key: 'basic',
      version: 1,
      name: '기본 신청서',
      participation: 'individual',
      fields: [
        { key: 'applicantName', type: 'auto', label: '신청자', required: true },
        { key: 'title', type: 'text', label: '제목', required: true },
        { key: 'summary', type: 'textarea', label: '요약', required: true },
      ],
    },
    applicantName: '합성 학생',
    githubHandle: 'synthetic-student',
    teamId,
    teamMinimum: null,
    team: null,
    applicationId: null,
    canManage: false,
    initialValues: {
      title: initialTitle,
      summary: '',
      isRepositoryPublicationPlanned: true,
      repositoryConnectionMode: 'new',
      repositoryUrl: '',
      personalDataConsent: false,
    },
  };
}

function deferredContext() {
  let resolvePromise: ((context: ProgramApplyContext) => void) | null = null;
  const promise = new Promise<ProgramApplyContext>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve(context: ProgramApplyContext): void {
      if (resolvePromise === null) {
        throw new TypeError('Deferred context resolver is unavailable');
      }
      resolvePromise(context);
    },
  } as const;
}

describe('ProgramApplyPage 비동기 초기화', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function renderPage(programId: string, teamId: string | null = null) {
    await act(async () => {
      root.render(<ProgramApplyPage programId={programId} teamId={teamId} />);
      await Promise.resolve();
    });
  }

  function titleInput(): HTMLInputElement {
    const input = container.querySelector('input[name="title"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new TypeError('Title input not found');
    }
    return input;
  }

  async function resolve(
    deferred: ReturnType<typeof deferredContext>,
    context: ProgramApplyContext,
  ): Promise<void> {
    await act(async () => {
      deferred.resolve(context);
      await deferred.promise;
    });
  }

  async function enterTitle(value: string): Promise<void> {
    await act(async () => {
      const input = titleInput();
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('새 신청서에 입력한 뒤 이전 identity의 context가 늦게 도착해도 현재 입력과 화면을 유지한다', async () => {
    const stale = deferredContext();
    const current = deferredContext();
    loadProgramApplyContextMock
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);

    await renderPage('program-stale');
    await renderPage('program-current', 'team-current');
    await resolve(
      current,
      readyContext('program-current', '현재 기본값', 'team-current'),
    );
    await enterTitle('사용자가 작성한 제목');

    await resolve(stale, readyContext('program-stale', '늦은 기본값'));

    expect(container.querySelector('h1')?.textContent).toBe(
      'program-current 프로그램 신청',
    );
    expect(titleInput().value).toBe('사용자가 작성한 제목');
  });

  it('program과 team identity가 바뀌면 이전 입력 여부와 무관하게 새 context 기본값으로 초기화한다', async () => {
    const previous = deferredContext();
    const current = deferredContext();
    loadProgramApplyContextMock
      .mockReturnValueOnce(previous.promise)
      .mockReturnValueOnce(current.promise);

    await renderPage('program-previous');
    await resolve(previous, readyContext('program-previous', '이전 기본값'));
    await enterTitle('이전 화면에서 작성한 제목');

    await renderPage('program-current', 'team-current');
    await resolve(
      current,
      readyContext('program-current', '새 기본값', 'team-current'),
    );

    expect(loadProgramApplyContextMock).toHaveBeenLastCalledWith(
      'program-current',
      'team-current',
    );
    expect(titleInput().value).toBe('새 기본값');
  });
});
