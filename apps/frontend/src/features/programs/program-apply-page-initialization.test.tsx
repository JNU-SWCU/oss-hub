// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadProgramApplyContext,
  type ProgramApplyContext,
} from './load-program-apply-context';
import { createTeam, joinTeam } from './api';
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

vi.mock('./api', () => ({
  createApplication: vi.fn(),
  createTeam: vi.fn(),
  joinTeam: vi.fn(),
}));

const loadProgramApplyContextMock = vi.mocked(loadProgramApplyContext);
const createTeamMock = vi.mocked(createTeam);
const joinTeamMock = vi.mocked(joinTeam);
const sessionUser = {
  name: '합성 학생',
  nickname: 'synthetic-student',
} as const;

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

type ReadyContext = Extract<ProgramApplyContext, { readonly kind: 'ready' }>;

function readyContext(
  programId: string,
  initialSummary: string,
  teamId: string | null = null,
): ReadyContext {
  return {
    kind: 'ready',
    mode: 'create',
    program: {
      id: programId,
      name: `${programId} 프로그램`,
      organizer: '합성 운영처',
      trackType: 'EXTRACURRICULAR',

      applicationTemplateKey: 'basic',
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
      summary: initialSummary,
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
    createTeamMock.mockReset();
    joinTeamMock.mockReset();
    loadProgramApplyContextMock.mockReset();
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
      root.render(
        <ProgramApplyPage
          programId={programId}
          sessionUser={sessionUser}
          teamId={teamId}
        />,
      );
      await Promise.resolve();
    });
  }

  function summaryInput(): HTMLTextAreaElement {
    const input = container.querySelector('textarea[name="summary"]');
    if (!(input instanceof HTMLTextAreaElement)) {
      throw new TypeError('Summary input not found');
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

  async function enterSummary(value: string): Promise<void> {
    await act(async () => {
      let input = container.querySelector('textarea[name="summary"]');
      if (!(input instanceof HTMLTextAreaElement)) {
        const continueButton = [...container.querySelectorAll('button')].find(
          (button) => button.textContent?.includes('팀 없이 계속'),
        );
        continueButton?.click();
        await Promise.resolve();
        input = summaryInput();
      }
      const textarea =
        input instanceof HTMLTextAreaElement ? input : summaryInput();
      textarea.value = value;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function enterText(selector: string, value: string): Promise<void> {
    const input = container.querySelector(selector);
    if (!(input instanceof HTMLInputElement)) {
      throw new TypeError(`Input not found: ${selector}`);
    }
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function button(name: string): HTMLButtonElement {
    const target = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === name,
    );
    if (!(target instanceof HTMLButtonElement)) {
      throw new TypeError(`Button not found: ${name}`);
    }
    return target;
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
    await enterSummary('사용자가 작성한 요약');

    await resolve(stale, readyContext('program-stale', '늦은 기본값'));

    expect(container.querySelector('h1')?.textContent).toBe(
      'program-current 프로그램 신청',
    );
    expect(summaryInput().value).toBe('사용자가 작성한 요약');
  });

  it('program과 team identity가 바뀌면 이전 입력 여부와 무관하게 새 context 기본값으로 초기화한다', async () => {
    const previous = deferredContext();
    const current = deferredContext();
    loadProgramApplyContextMock
      .mockReturnValueOnce(previous.promise)
      .mockReturnValueOnce(current.promise);

    await renderPage('program-previous');
    await resolve(previous, readyContext('program-previous', '이전 기본값'));
    await enterSummary('이전 화면에서 작성한 요약');

    await renderPage('program-current', 'team-current');
    await resolve(
      current,
      readyContext('program-current', '새 기본값', 'team-current'),
    );

    expect(loadProgramApplyContextMock).toHaveBeenLastCalledWith(
      'program-current',
      'team-current',
      sessionUser,
    );
    await act(async () => {
      const continueButton = [...container.querySelectorAll('button')].find(
        (button) => button.textContent?.includes('팀 없이 계속'),
      );
      continueButton?.click();
      await Promise.resolve();
    });
    expect(summaryInput().value).toBe('새 기본값');
  });

  it('팀을 만든 뒤 context를 다시 읽어도 신청서 단계에 머문다', async () => {
    loadProgramApplyContextMock
      .mockResolvedValueOnce(readyContext('program-create', '처음 값'))
      .mockResolvedValueOnce(
        readyContext('program-create', '다시 읽은 값', 'team-created'),
      );
    createTeamMock.mockResolvedValue({
      id: 'team-created',
      name: '합성 팀',
      joinCode: 'SYNTH123',
      memberCount: 1,
    });
    await renderPage('program-create');
    await enterText('#apply-team-name', '합성 팀');

    await act(async () => {
      button('팀 만들기').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createTeamMock).toHaveBeenCalledWith('program-create', {
      name: '합성 팀',
    });
    expect(container.querySelector('textarea[name="summary"]')).not.toBeNull();
  });

  it('참여 코드로 합류한 뒤 context를 다시 읽어도 신청서 단계에 머문다', async () => {
    loadProgramApplyContextMock
      .mockResolvedValueOnce(readyContext('program-join', '처음 값'))
      .mockResolvedValueOnce(
        readyContext('program-join', '다시 읽은 값', 'team-joined'),
      );
    joinTeamMock.mockResolvedValue({
      id: 'team-joined',
      name: '합성 팀',
      memberCount: 2,
      minMembers: 1,
      maxMembers: 4,
      locked: false,
      isLeader: false,
      members: [],
    });
    await renderPage('program-join');
    await enterText('#apply-team-code', 'SYNTH123');

    await act(async () => {
      button('합류하기').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(joinTeamMock).toHaveBeenCalledWith('program-join', {
      joinCode: 'SYNTH123',
    });
    expect(container.querySelector('textarea[name="summary"]')).not.toBeNull();
  });

  it('혼자 신청하는 선택지에 내부 저장 구조인 1인 팀 용어를 노출하지 않는다', async () => {
    loadProgramApplyContextMock.mockResolvedValue(
      readyContext('program-solo', '처음 값'),
    );

    await renderPage('program-solo');

    expect(container.textContent).not.toContain('1인 팀');
    expect(button('팀 없이 계속')).toBeTruthy();
  });

  it('신청서 단계는 페이지 제목과 main landmark를 중복하지 않는다', async () => {
    loadProgramApplyContextMock.mockResolvedValue(
      readyContext('program-landmark', '처음 값'),
    );

    await renderPage('program-landmark');
    await act(async () => {
      button('팀 없이 계속').click();
      await Promise.resolve();
    });

    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });

  it('구버전 템플릿의 제목 필드를 신청서에 다시 노출하지 않는다', async () => {
    loadProgramApplyContextMock.mockResolvedValue(
      readyContext('program-legacy-template', '처음 값'),
    );

    await renderPage('program-legacy-template');
    await act(async () => {
      button('팀 없이 계속').click();
      await Promise.resolve();
    });

    expect(container.querySelector('input[name="title"]')).toBeNull();
    expect(container.textContent).not.toContain('제목 *');
  });
});
