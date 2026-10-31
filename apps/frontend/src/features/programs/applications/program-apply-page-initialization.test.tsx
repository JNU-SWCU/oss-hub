import { act } from 'react';
import { focusManager } from '@tanstack/react-query';
import { createQueryRoot as createRoot } from '../../../../test-support/render-with-query';
type Root = ReturnType<typeof createRoot>;
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadProgramApplyContext,
  type ProgramApplyContext,
} from './load-program-apply-context';
import { createApplication } from './api';
import {
  createApplicationPreparation,
  leaveApplicationPreparation,
  removeMyTeamMember,
} from '../teams/api';
import { ProgramApplyPage } from './program-apply-page';
import {
  cancelMyApplication,
  updateMyApplication,
} from './student-application-api';
import { featureKey, programFeatureKey } from '@/lib/query-keys';
import {
  createInvitation,
  listSentInvitations,
} from '../teams/team-invitation-api';

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

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock('./load-program-apply-context', () => ({
  loadProgramApplyContext: vi.fn(),
}));

vi.mock('./api', () => ({
  createApplication: vi.fn(),
  createApplicationPreparation: vi.fn(),
  leaveApplicationPreparation: vi.fn(),

  removeMyTeamMember: vi.fn(),
}));
vi.mock('../teams/api', () => ({
  createApplication: vi.fn(),
  createApplicationPreparation: vi.fn(),
  leaveApplicationPreparation: vi.fn(),

  removeMyTeamMember: vi.fn(),
}));

vi.mock('./student-application-api', () => ({
  cancelMyApplication: vi.fn(),
  updateMyApplication: vi.fn(),
  getMyApplication: vi.fn(),
}));

vi.mock('../teams/team-invitation-api', () => ({
  listReceivedInvitations: vi.fn(),
  listSentInvitations: vi.fn(),
  searchInvitationCandidates: vi.fn(),
  createInvitation: vi.fn(),
  cancelInvitation: vi.fn(),
  acceptInvitation: vi.fn(),
  declineInvitation: vi.fn(),
}));

const loadProgramApplyContextMock = vi.mocked(loadProgramApplyContext);
const createApplicationPreparationMock = vi.mocked(
  createApplicationPreparation,
);
const createApplicationMock = vi.mocked(createApplication);
const updateMyApplicationMock = vi.mocked(updateMyApplication);
const createInvitationMock = vi.mocked(createInvitation);
const listSentInvitationsMock = vi.mocked(listSentInvitations);
const removeMyTeamMemberMock = vi.mocked(removeMyTeamMember);
const sessionUser = {
  name: '합성 학생',
  nickname: 'synthetic-student',
} as const;

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

type ReadyContext = Extract<ProgramApplyContext, { readonly kind: 'ready' }>;
type Roster = NonNullable<ReadyContext['team']>['members'];

function readyContext(
  programId: string,
  initialTitle: string,
  teamId: string | null = null,
  extras: {
    readonly mode?: 'create' | 'edit';
    readonly preparation?: true;
    readonly memberCount?: number;
    readonly members?: Roster;
    readonly isLeader?: boolean;
  } = {},
): ReadyContext {
  const members: Roster = extras.members ?? [
    {
      userId: 'user-1',
      nickname: 'synthetic-student',
      name: '합성 학생',
      isLeader: true,
    },
  ];
  const isLeader = extras.isLeader ?? true;
  return {
    kind: 'ready',
    mode: extras.mode ?? 'create',
    rejectionReason: null,
    program: {
      id: programId,
      name: `${programId} 프로그램`,
      organizer: '합성 운영처',
      trackType: 'EXTRACURRICULAR',

      applicationTemplateKey: 'basic',
      lifecycle: 'PUBLISHED',
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
      ],
    },
    applicantName: '합성 학생',
    githubHandle: 'synthetic-student',
    teamId,
    teamMinimum: extras.memberCount
      ? { memberCount: extras.memberCount, teamMinSize: 2 }
      : null,
    team:
      teamId === null
        ? null
        : {
            ...(extras.preparation ? { preparation: true } : {}),
            id: teamId,
            name: '합성 팀',
            memberCount: extras.memberCount ?? members.length,
            minMembers: 1,
            maxMembers: 4,
            hasApplication: extras.mode === 'edit',

            canInvite: isLeader,
            canRemoveMembers: isLeader,
            canLeave: true,
            isLeader,
            members,
          },
    applicationId: extras.mode === 'edit' ? 'application-1' : null,
    canManage: extras.mode === 'edit' || isLeader,
    initialValues: {
      title: initialTitle,
      isRepositoryPublicationPlanned: true,
      personalDataConsent: extras.mode === 'edit',
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

function deferredList<T>() {
  let resolvePromise: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value: T): void {
      if (resolvePromise === null) {
        throw new TypeError('Deferred list resolver is unavailable');
      }
      resolvePromise(value);
    },
  } as const;
}

describe('ProgramApplyPage 한 화면 신청', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    createApplicationPreparationMock.mockReset();
    pushMock.mockReset();
    refreshMock.mockReset();
    createApplicationMock.mockReset();
    updateMyApplicationMock.mockReset();
    vi.mocked(cancelMyApplication).mockReset();
    createInvitationMock.mockReset();
    removeMyTeamMemberMock.mockReset().mockResolvedValue(undefined);
    loadProgramApplyContextMock.mockReset();
    listSentInvitationsMock.mockReset().mockResolvedValue([]);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    focusManager.setFocused(undefined);
    vi.useRealTimers();
    container.remove();
    vi.clearAllMocks();
  });

  async function renderPage(programId: string) {
    await act(async () => {
      root.render(
        <ProgramApplyPage programId={programId} sessionUser={sessionUser} />,
      );
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
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      );
      setter?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
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
      );
      setter?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function button(name: string, inDialog = false): HTMLButtonElement {
    const scope = inDialog
      ? document.querySelector('[role="alertdialog"]')
      : container;
    const target = [...(scope?.querySelectorAll('button') ?? [])].find(
      (candidate) => candidate.textContent?.trim() === name,
    );
    if (!(target instanceof HTMLButtonElement)) {
      throw new TypeError(`Button not found: ${name}`);
    }
    return target;
  }

  function inviteTrigger(): HTMLButtonElement {
    const target = container.querySelector('button[aria-label="팀원 초대"]');
    if (!(target instanceof HTMLButtonElement)) {
      throw new TypeError('Invite trigger not found');
    }
    return target;
  }

  function inviteSearchInput(): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>('#invite-search');
  }

  async function settleUntil(
    predicate: () => boolean,
    label: string,
  ): Promise<void> {
    if (predicate()) return;
    await act(
      async () =>
        new Promise<void>((resolve, reject) => {
          const observer = new MutationObserver(check);
          const unsubscribe = root.queryClient.getQueryCache().subscribe(check);
          const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`${label} 조건을 만족하지 못했다.`));
          }, 1000);
          function cleanup() {
            observer.disconnect();
            unsubscribe();
            clearTimeout(timer);
          }
          function check() {
            if (!predicate()) return;
            cleanup();
            resolve();
          }
          observer.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
          });
          check();
        }),
    );
  }

  function applicantName(): string | null {
    const input = container.querySelector<HTMLInputElement>(
      'input[name="applicantName"]',
    );
    return input?.value ?? null;
  }

  async function checkConsent(): Promise<void> {
    await act(async () => {
      const consent = container.querySelector<HTMLInputElement>(
        '#personal-data-consent',
      );
      if (!consent) throw new Error('Required consent control is missing');
      consent.click();
    });
  }

  it('초기 렌더는 아무 요청도 만들지 않고 한 화면 신청서를 보여 준다', async () => {
    loadProgramApplyContextMock.mockResolvedValue(
      readyContext('program-solo', ''),
    );

    await renderPage('program-solo');

    expect(applicantName()).toBe('합성 학생');
    expect(container.querySelector('#apply-team-name')).not.toBeNull();
    expect(container.querySelector('#personal-data-consent')).not.toBeNull();
    expect(button('신청 제출')).toBeTruthy();

    expect(createApplicationPreparationMock).not.toHaveBeenCalled();
    expect(createApplicationMock).not.toHaveBeenCalled();
    expect(listSentInvitationsMock).not.toHaveBeenCalled();
    expect(inviteSearchInput()).toBeNull();
    expect(container.textContent).not.toContain('다음');
    expect(container.textContent).not.toContain('팀 구성·제출');
    expect(container.textContent).not.toContain('팀·초대 새로고침');
    expect(container.textContent).not.toContain('팀에서 제외');
  });

  it('＋를 눌러야 비로소 팀을 한 번 만들고 초대 레이어를 연다', async () => {
    loadProgramApplyContextMock
      .mockResolvedValueOnce(readyContext('program-create', ''))
      .mockResolvedValue(readyContext('program-create', '', 'team-created'));
    createApplicationPreparationMock.mockResolvedValue({
      id: 'team-created',
      name: '합성 팀',
      memberCount: 1,
    });
    await renderPage('program-create');
    await enterText('#apply-team-name', '합성 팀');
    expect(createApplicationPreparationMock).not.toHaveBeenCalled();

    await act(async () => {
      inviteTrigger().click();
      await Promise.resolve();
    });
    await settleUntil(() => inviteSearchInput() !== null, '초대 레이어 열림');

    expect(createApplicationPreparationMock).toHaveBeenCalledExactlyOnceWith(
      'program-create',
      {
        name: '합성 팀',
      },
    );

    expect(createInvitationMock).not.toHaveBeenCalled();
    expect(createApplicationMock).not.toHaveBeenCalled();
  });

  it('팀 생성 직전의 실시간 조회가 대기 중이어도 생성 후 팀을 새로 읽는다', async () => {
    const stale = deferredContext();
    loadProgramApplyContextMock
      .mockResolvedValueOnce(readyContext('program-team-race', ''))
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValue(readyContext('program-team-race', '', 'team-created'));
    createApplicationPreparationMock.mockResolvedValue({
      id: 'team-created',
      name: '합성 팀',
      memberCount: 1,
    });
    await renderPage('program-team-race');
    await enterText('#apply-team-name', '합성 팀');
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await act(async () => inviteTrigger().click());
    expect(loadProgramApplyContextMock).toHaveBeenCalledTimes(3);
    expect(inviteSearchInput()).not.toBeNull();
    await resolve(stale, readyContext('program-team-race', ''));
    expect(inviteSearchInput()).not.toBeNull();
    expect(
      container.querySelector<HTMLInputElement>('#apply-team-name')?.value,
    ).toBe('합성 팀');
  });

  it('팀 이름 없이 ＋를 누르면 팀을 만들지 않고 이름부터 요구한다', async () => {
    loadProgramApplyContextMock.mockResolvedValue(
      readyContext('program-noname', ''),
    );
    await renderPage('program-noname');
    const teamName =
      container.querySelector<HTMLInputElement>('#apply-team-name');
    if (!teamName) throw new TypeError('Team name input not found');
    const scroll = vi.fn();
    teamName.scrollIntoView = scroll;

    await act(async () => {
      inviteTrigger().focus();
      inviteTrigger().click();
      await Promise.resolve();
    });

    expect(createApplicationPreparationMock).not.toHaveBeenCalled();
    expect(inviteSearchInput()).toBeNull();
    expect(container.textContent).toContain('팀 이름을 입력해 주세요.');
    expect(document.activeElement).toBe(teamName);
    expect(scroll).toHaveBeenCalledWith({ block: 'center' });

    await act(async () => {
      inviteTrigger().focus();
      inviteTrigger().click();
    });
    expect(document.activeElement).toBe(teamName);
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it('같은 틱에 ＋를 두 번 눌러도 팀은 한 번만 만든다', async () => {
    loadProgramApplyContextMock.mockResolvedValue(
      readyContext('program-twice', ''),
    );
    createApplicationPreparationMock.mockImplementation(
      () => new Promise(() => undefined),
    );
    await renderPage('program-twice');
    await enterText('#apply-team-name', '합성 팀');

    await act(async () => {
      inviteTrigger().click();
      inviteTrigger().click();
      await Promise.resolve();
    });

    expect(createApplicationPreparationMock).toHaveBeenCalledTimes(1);
  });

  it('이미 팀이 있으면 ＋는 팀을 만들지 않고 레이어만 연다', async () => {
    loadProgramApplyContextMock.mockResolvedValue(
      readyContext('program-existing', '기존 제목', 'team-existing'),
    );
    await renderPage('program-existing');

    const teamName =
      container.querySelector<HTMLInputElement>('#apply-team-name');
    expect(teamName?.value).toBe('합성 팀');
    expect(teamName?.disabled).toBe(true);

    await act(async () => {
      inviteTrigger().click();
      await Promise.resolve();
    });
    await settleUntil(() => inviteSearchInput() !== null, '초대 레이어 열림');

    expect(createApplicationPreparationMock).not.toHaveBeenCalled();
  });

  it('팀 만들기가 실패하면 입력한 이름과 화면을 그대로 두고 이유를 남긴다', async () => {
    loadProgramApplyContextMock.mockResolvedValue(
      readyContext('program-fail', ''),
    );
    createApplicationPreparationMock.mockRejectedValue(new Error('network'));
    await renderPage('program-fail');
    await enterText('#apply-team-name', '실패할 팀');

    await act(async () => {
      inviteTrigger().click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createApplicationPreparationMock).toHaveBeenCalledTimes(1);
    const teamName =
      container.querySelector<HTMLInputElement>('#apply-team-name');
    expect(teamName?.value).toBe('실패할 팀');
    expect(container.textContent).toContain(
      '팀 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    );
    expect(inviteSearchInput()).toBeNull();

    expect(button('신청 제출')).toBeTruthy();
  });

  it('동의와 최종 확인 없이는 신청을 제출하지 않는다', async () => {
    loadProgramApplyContextMock.mockResolvedValue(
      readyContext('program-consent', '제목', 'team-consent'),
    );
    await renderPage('program-consent');
    const consent = container.querySelector<HTMLInputElement>(
      '#personal-data-consent',
    );
    if (!consent) throw new TypeError('Consent input not found');
    const scroll = vi.fn();
    consent.scrollIntoView = scroll;

    await act(async () => {
      button('신청 제출').focus();
      button('신청 제출').click();
    });

    expect(createApplicationMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      '개인정보 수집·이용에 동의해야 지원할 수 있습니다.',
    );
    expect(document.activeElement).toBe(consent);
    expect(scroll).toHaveBeenCalledWith({ block: 'center' });
    expect(consent.getAttribute('aria-invalid')).toBe('true');
    const errorId = consent.getAttribute('aria-describedby');
    expect(errorId).toBeTruthy();
    expect(errorId && document.getElementById(errorId)?.textContent).toBe(
      '개인정보 수집·이용에 동의해야 지원할 수 있습니다.',
    );

    await checkConsent();
    expect(consent.getAttribute('aria-invalid')).toBeNull();
    expect(consent.getAttribute('aria-describedby')).toBeNull();
    await act(async () => {
      button('신청 제출').click();
    });
    expect(createApplicationMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('신청서를 제출하시겠습니까?');
  });

  it('팀 이름이 비어 있으면 최종 확인 자체가 열리지 않는다', async () => {
    loadProgramApplyContextMock.mockResolvedValue(
      readyContext('program-empty-name', ''),
    );
    await renderPage('program-empty-name');
    await checkConsent();
    const teamName =
      container.querySelector<HTMLInputElement>('#apply-team-name');
    if (!teamName) throw new TypeError('Team name input not found');
    const scroll = vi.fn();
    teamName.scrollIntoView = scroll;

    await act(async () => {
      button('신청 제출').focus();
      button('신청 제출').click();
    });

    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(container.textContent).toContain('팀 이름을 입력해 주세요.');
    expect(createApplicationPreparationMock).not.toHaveBeenCalled();
    expect(createApplicationMock).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(teamName);
    expect(scroll).toHaveBeenCalledWith({ block: 'center' });
  });

  it('혼자 신청하는 학생은 별도 팀 생성 없이 마지막 확인 한 번으로 신청을 낸다', async () => {
    loadProgramApplyContextMock
      .mockResolvedValueOnce(readyContext('program-alone', ''))
      .mockResolvedValue(readyContext('program-alone', '', 'team-alone'));
    createApplicationPreparationMock.mockResolvedValue({
      id: 'team-alone',
      name: '나 혼자 팀',
      memberCount: 1,
    });
    createApplicationMock.mockResolvedValue({
      id: 'app-alone',
      programId: 'program-alone',
      status: 'SUBMITTED',
      teamId: 'team-alone',
      submittedAt: '2026-08-15T00:00:00Z',
      isRepositoryPublicationPlanned: true,
    });

    await renderPage('program-alone');
    await enterText('#apply-team-name', '나 혼자 팀');
    await checkConsent();
    await act(async () => {
      button('신청 제출').click();
      await Promise.resolve();
    });
    expect(createApplicationPreparationMock).not.toHaveBeenCalled();

    await act(async () => {
      button('신청서 제출', true).click();
      await Promise.resolve();
    });
    await settleUntil(
      () => container.textContent?.includes('신청이 접수되었습니다') === true,
      '제출 성공 화면',
    );

    expect(createApplicationPreparationMock).not.toHaveBeenCalled();
    expect(createApplicationMock).toHaveBeenCalledWith(
      'program-alone',
      expect.objectContaining({ teamName: '나 혼자 팀' }),
    );
    expect(createApplicationMock).toHaveBeenCalledOnce();
    const myTeamLink = container.querySelector<HTMLAnchorElement>(
      'a[href="/programs/program-alone/team"]',
    );
    expect(myTeamLink?.textContent).toContain('우리 팀 보기');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('신청 응답이 지연되어도 같은 확인 한 번으로 신청이 접수된다', async () => {
    const context = deferredContext();
    const submission =
      deferredList<Awaited<ReturnType<typeof createApplication>>>();
    loadProgramApplyContextMock.mockReturnValue(context.promise);
    createApplicationMock.mockReturnValue(submission.promise);

    await renderPage('program-delayed');
    expect(container.querySelector('#apply-team-name')).toBeNull();
    await resolve(context, readyContext('program-delayed', ''));
    await enterText('#apply-team-name', '지연 팀');
    await checkConsent();
    await act(async () => {
      button('신청 제출').click();
    });
    await act(async () => {
      button('신청서 제출', true).click();
    });
    expect(container.textContent).not.toContain('신청이 접수되었습니다');
    await act(async () => {
      submission.resolve({
        id: 'app-delayed',
        programId: 'program-delayed',
        status: 'SUBMITTED' as const,
        teamId: 'team-delayed',
        submittedAt: '2026-08-15T00:00:00Z',
        isRepositoryPublicationPlanned: true,
      });
      await submission.promise;
    });

    await settleUntil(
      () => container.textContent?.includes('신청이 접수되었습니다') === true,
      '지연 제출 성공 화면',
    );
    expect(createApplicationPreparationMock).not.toHaveBeenCalled();
    expect(createApplicationMock).toHaveBeenCalledWith(
      'program-delayed',
      expect.objectContaining({ teamName: '지연 팀' }),
    );
    expect(createApplicationMock).toHaveBeenCalledOnce();
  });

  it('신청 제출이 실패하면 팀 생성 없이 입력을 지키고 다시 제출한다', async () => {
    loadProgramApplyContextMock
      .mockResolvedValueOnce(readyContext('program-retry', ''))
      .mockResolvedValue(readyContext('program-retry', '', 'team-retry'));
    createApplicationPreparationMock.mockResolvedValue({
      id: 'team-retry',
      name: '재시도 팀',
      memberCount: 1,
    });
    createApplicationMock
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({
        id: 'app-retry',
        programId: 'program-retry',
        status: 'SUBMITTED',
        teamId: 'team-retry',
        submittedAt: '2026-08-15T00:00:00Z',
        isRepositoryPublicationPlanned: true,
      });

    await renderPage('program-retry');
    await enterText('#apply-team-name', '재시도 팀');
    await checkConsent();
    await act(async () => {
      button('신청 제출').click();
      await Promise.resolve();
    });
    await act(async () => {
      button('신청서 제출', true).click();
      await Promise.resolve();
    });
    await settleUntil(
      () => createApplicationMock.mock.calls.length === 1,
      '첫 제출 시도',
    );
    await settleUntil(
      () =>
        container.textContent?.includes('신청서를 제출하지 못했습니다') ===
        true,
      '제출 실패 안내',
    );

    expect(createApplicationPreparationMock).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLInputElement>('#apply-team-name')?.value,
    ).toBe('재시도 팀');
    expect(
      container.querySelector<HTMLInputElement>('#personal-data-consent')
        ?.checked,
    ).toBe(true);

    await act(async () => {
      button('신청 제출').click();
      await Promise.resolve();
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();

    await act(async () => {
      button('신청서 제출', true).click();
      await Promise.resolve();
    });
    await settleUntil(
      () => container.textContent?.includes('신청이 접수되었습니다') === true,
      '재시도 성공 화면',
    );

    expect(createApplicationPreparationMock).not.toHaveBeenCalled();
    expect(createApplicationMock).toHaveBeenCalledTimes(2);
  });

  it('초대를 수락해 합류한 팀원은 팀을 만들지도, 다시 신청하지도 않는다', async () => {
    loadProgramApplyContextMock.mockResolvedValue(
      readyContext('program-member', '', 'team-member', {
        isLeader: false,
        members: [
          {
            userId: 'user-9',
            nickname: 'leader-nick',
            name: '팀장',
            isLeader: true,
          },
          {
            userId: 'user-1',
            nickname: 'synthetic-student',
            name: '합성 학생',
            isLeader: false,
          },
        ],
      }),
    );

    await renderPage('program-member');

    expect(container.textContent).toContain(
      '팀장이 신청서를 제출할 때까지 기다립니다.',
    );
    expect(container.querySelector('#apply-team-name')).toBeNull();
    expect(container.querySelector('#personal-data-consent')).toBeNull();
    expect(
      container.querySelector('button[aria-label="팀원 초대"]'),
    ).toBeNull();
    expect(createApplicationPreparationMock).not.toHaveBeenCalled();
    expect(createApplicationMock).not.toHaveBeenCalled();
    expect(listSentInvitationsMock).not.toHaveBeenCalled();
  });

  it('수정 화면은 초대 조회를 만들지 않고 로스터와 저장·취소만 그린다', async () => {
    loadProgramApplyContextMock.mockResolvedValue(
      readyContext('program-edit', '제출된 제목', 'team-edit', {
        mode: 'edit',
      }),
    );

    await renderPage('program-edit');

    expect(container.textContent).toContain('합성 팀');
    expect(container.textContent).toContain('수정 내용 저장');
    expect(container.textContent).toContain('신청 취소');
    expect(
      container.querySelector('button[aria-label="팀원 초대"]'),
    ).toBeNull();
    expect(inviteSearchInput()).toBeNull();
    expect(container.querySelector('#apply-team-name')).toBeNull();

    expect(listSentInvitationsMock).not.toHaveBeenCalled();

    expect(container.textContent).not.toContain('팀에서 제외');
    expect(container.textContent).not.toContain('팀 나가기');
  });

  it('신청 취소 성공은 프로그램과 대시보드를 무효화하고 대시보드로 이동한다', async () => {
    const dashboardKey = featureKey('student-dashboard');
    const overviewKey = programFeatureKey(
      'program-withdraw',
      'overview',
      false,
    );
    root.queryClient.setQueryDefaults(dashboardKey, { gcTime: Infinity });
    root.queryClient.setQueryDefaults(overviewKey, { gcTime: Infinity });
    root.queryClient.setQueryData(dashboardKey, {
      applications: ['application-1'],
    });
    root.queryClient.setQueryData(overviewKey, {
      applicationStatus: 'SUBMITTED',
    });
    loadProgramApplyContextMock.mockResolvedValue(
      readyContext('program-withdraw', '제출된 제목', 'team-withdraw', {
        mode: 'edit',
      }),
    );
    vi.mocked(cancelMyApplication).mockResolvedValue({ cancelled: true });
    await renderPage('program-withdraw');
    await act(async () => button('신청 취소').click());
    await act(async () => button('신청 취소', true).click());
    expect(vi.mocked(cancelMyApplication)).toHaveBeenCalledWith(
      'program-withdraw',
    );
    expect(root.queryClient.getQueryState(dashboardKey)?.isInvalidated).toBe(
      true,
    );
    expect(root.queryClient.getQueryState(overviewKey)?.isInvalidated).toBe(
      true,
    );
    expect(pushMock).toHaveBeenCalledWith('/dashboard');
  });

  it('새 신청서에 입력한 뒤 이전 identity의 context가 늦게 도착해도 현재 입력과 화면을 유지한다', async () => {
    const stale = deferredContext();
    const current = deferredContext();
    loadProgramApplyContextMock
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);

    await renderPage('program-stale');
    await renderPage('program-current');
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
    await resolve(
      previous,
      readyContext('program-previous', '이전 기본값', 'team-previous'),
    );
    await enterTitle('이전 화면에서 작성한 제목');

    await renderPage('program-current');
    await resolve(
      current,
      readyContext('program-current', '새 기본값', 'team-current'),
    );

    expect(loadProgramApplyContextMock).toHaveBeenLastCalledWith(
      'program-current',
      sessionUser,
      root.queryClient,
    );
    expect(titleInput().value).toBe('새 기본값');
  });

  it('포커스 새로고침은 입력값을 유지한 채 로스터를 갱신한다', async () => {
    const first = readyContext('program-live', '현재 제목', 'team-live', {
      memberCount: 1,
    });
    const second = readyContext('program-live', '서버 제목', 'team-live', {
      memberCount: 2,
      members: [
        {
          userId: 'user-1',
          nickname: 'synthetic-student',
          name: '합성 학생',
          isLeader: true,
        },
        {
          userId: 'user-2',
          nickname: 'member-nick',
          name: '팀원',
          isLeader: false,
        },
      ],
    });
    loadProgramApplyContextMock
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    await renderPage('program-live');
    await enterTitle('사용자가 작성한 제목');
    expect(container.textContent).not.toContain('member-nick');

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(titleInput().value).toBe('사용자가 작성한 제목');
    expect(container.textContent).toContain('member-nick');
    expect(
      container.querySelector('[aria-label="신청 양식 불러오는 중"]'),
    ).toBeNull();
  });

  it('백그라운드 새로고침이 create에서 edit으로 바뀌면 서버 기본값으로 되돌린다', async () => {
    loadProgramApplyContextMock
      .mockResolvedValueOnce(
        readyContext('program-mode', '작성 중', 'team-mode'),
      )
      .mockResolvedValueOnce(
        readyContext('program-mode', '제출된 제목', 'team-mode', {
          mode: 'edit',
        }),
      );

    await renderPage('program-mode');
    await enterTitle('사용자가 작성한 제목');

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(titleInput().value).toBe('제출된 제목');
    expect(container.textContent).toContain('수정 내용 저장');
  });

  it('30초 간격으로 로스터와 보낸 초대를 갱신하되 작성 내용은 유지한다', async () => {
    vi.useFakeTimers();
    focusManager.setFocused(true);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    loadProgramApplyContextMock
      .mockResolvedValueOnce(
        readyContext('program-interval', '서버 제목', 'team-interval'),
      )
      .mockResolvedValue(
        readyContext('program-interval', '다른 제목', 'team-interval', {
          members: [
            {
              userId: 'user-1',
              nickname: sessionUser.nickname,
              name: '합성 학생',
              isLeader: true,
            },
            {
              userId: 'user-2',
              nickname: 'interval-member',
              name: '새 팀원',
              isLeader: false,
            },
          ],
        }),
      );
    await renderPage('program-interval');
    await enterTitle('작성 중인 제목');
    expect(loadProgramApplyContextMock).toHaveBeenCalledTimes(1);
    expect(listSentInvitationsMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(loadProgramApplyContextMock).toHaveBeenCalledTimes(2);
    expect(listSentInvitationsMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('interval-member');
    expect(titleInput().value).toBe('작성 중인 제목');
  });

  it('늦은 팀 만들기 완료는 새 프로그램 화면을 성공으로 바꾸지 않는다', async () => {
    const createDeferred = deferredList<{
      readonly id: string;
      readonly name: string;
      readonly memberCount: number;
    }>();
    loadProgramApplyContextMock
      .mockResolvedValueOnce(readyContext('program-stale', ''))
      .mockResolvedValueOnce(
        readyContext('program-current', '', 'team-current'),
      );
    createApplicationPreparationMock.mockReturnValueOnce(
      createDeferred.promise,
    );

    await renderPage('program-stale');
    await enterText('#apply-team-name', '합성 팀');
    await act(async () => {
      inviteTrigger().click();
      await Promise.resolve();
    });

    await renderPage('program-current');
    expect(container.querySelector('h1')?.textContent).toBe(
      'program-current 프로그램 신청',
    );
    await act(async () => {
      createDeferred.resolve({
        id: 'team-stale',
        name: '합성 팀',
        memberCount: 1,
      });
      await createDeferred.promise;
      await Promise.resolve();
    });

    expect(container.querySelector('h1')?.textContent).toBe(
      'program-current 프로그램 신청',
    );
    expect(container.textContent).not.toContain('신청이 접수되었습니다');
    expect(button('신청 제출')).toBeTruthy();
  });

  it('늦은 신청 제출 완료는 새 프로그램에 성공 화면과 라우터 이동을 남기지 않는다', async () => {
    const submitDeferred =
      deferredList<Awaited<ReturnType<typeof createApplication>>>();
    loadProgramApplyContextMock
      .mockResolvedValueOnce(
        readyContext('program-stale', '제목', 'team-stale'),
      )
      .mockResolvedValueOnce(
        readyContext('program-current', '새 제목', 'team-current'),
      );
    createApplicationMock.mockReturnValueOnce(submitDeferred.promise);

    await renderPage('program-stale');
    await checkConsent();
    await act(async () => {
      button('신청 제출').click();
      await Promise.resolve();
    });
    await act(async () => {
      button('신청서 제출', true).click();
      await Promise.resolve();
    });
    expect(createApplicationMock).toHaveBeenCalledOnce();

    await renderPage('program-current');
    await act(async () => {
      submitDeferred.resolve({
        id: 'app-stale',
        programId: 'program-stale',
        status: 'SUBMITTED',
        teamId: 'team-stale',
        submittedAt: '2026-08-15T00:00:00Z',
        isRepositoryPublicationPlanned: true,
      });
      await submitDeferred.promise;
      await Promise.resolve();
    });

    expect(container.querySelector('h1')?.textContent).toBe(
      'program-current 프로그램 신청',
    );
    expect(container.textContent).not.toContain('신청이 접수되었습니다');
    expect(container.textContent).not.toContain('app-stale');
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('늦은 수정 저장 완료는 새 프로그램에 성공 화면을 남기지 않는다', async () => {
    const saveDeferred =
      deferredList<Awaited<ReturnType<typeof updateMyApplication>>>();
    loadProgramApplyContextMock
      .mockResolvedValueOnce(
        readyContext('program-stale', '제목', 'team-stale', { mode: 'edit' }),
      )
      .mockResolvedValueOnce(
        readyContext('program-current', '새 제목', 'team-current'),
      );
    updateMyApplicationMock.mockReturnValueOnce(saveDeferred.promise);

    await renderPage('program-stale');
    await act(async () => {
      button('수정 내용 저장').click();
      await Promise.resolve();
    });
    await act(async () => {
      button('수정 내용 저장', true).click();
      await Promise.resolve();
    });
    expect(updateMyApplicationMock).toHaveBeenCalledOnce();

    await renderPage('program-current');
    await act(async () => {
      saveDeferred.resolve({
        id: 'app-stale',
        programId: 'program-stale',
        status: 'SUBMITTED',
        teamId: 'team-stale',
        answers: { applicantName: '합성 학생', title: '제목' },
        submittedAt: '2026-08-15T00:00:00Z',
        updatedAt: '2026-08-15T00:00:00Z',
        isRepositoryPublicationPlanned: true,
        rejectionReason: null,
        isManager: true,
        canManage: true,
        canEdit: true,
        canCancel: true,
      });
      await saveDeferred.promise;
      await Promise.resolve();
    });

    expect(container.querySelector('h1')?.textContent).toBe(
      'program-current 프로그램 신청',
    );
    expect(container.textContent).not.toContain('신청서가 수정되었습니다');
    expect(container.textContent).not.toContain('app-stale');
  });

  it('늦은 팀 만들기 finally는 새 프로그램의 진행 중 가드를 풀지 않는다', async () => {
    const staleCreate = deferredList<{
      readonly id: string;
      readonly name: string;
      readonly memberCount: number;
    }>();
    const currentCreate = deferredList<{
      readonly id: string;
      readonly name: string;
      readonly memberCount: number;
    }>();
    loadProgramApplyContextMock
      .mockResolvedValueOnce(readyContext('program-stale', ''))
      .mockResolvedValueOnce(readyContext('program-current', ''));
    createApplicationPreparationMock
      .mockReturnValueOnce(staleCreate.promise)
      .mockReturnValueOnce(currentCreate.promise);

    await renderPage('program-stale');
    await enterText('#apply-team-name', '이전 팀');
    await act(async () => {
      inviteTrigger().click();
      await Promise.resolve();
    });

    await renderPage('program-current');
    await enterText('#apply-team-name', '현재 팀');
    await act(async () => {
      inviteTrigger().click();
      await Promise.resolve();
    });
    expect(createApplicationPreparationMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      staleCreate.resolve({
        id: 'team-stale',
        name: '이전 팀',
        memberCount: 1,
      });
      await staleCreate.promise;
      await Promise.resolve();
    });

    await act(async () => {
      inviteTrigger().click();
      await Promise.resolve();
    });
    expect(createApplicationPreparationMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector('h1')?.textContent).toBe(
      'program-current 프로그램 신청',
    );
    const teamName =
      container.querySelector<HTMLInputElement>('#apply-team-name');
    expect(teamName?.value).toBe('현재 팀');
  });

  it('제출에 성공하면 방금 신청한 프로그램의 우리 팀 화면으로 갈 수 있다', async () => {
    loadProgramApplyContextMock.mockResolvedValue(
      readyContext('program-done', '제목', 'team-done'),
    );
    createApplicationMock.mockResolvedValue({
      id: 'app-done',
      programId: 'program-done',
      status: 'SUBMITTED',
      teamId: 'team-done',
      submittedAt: '2026-08-15T00:00:00Z',
      isRepositoryPublicationPlanned: true,
    });

    await renderPage('program-done');
    await checkConsent();
    await act(async () => {
      button('신청 제출').click();
      await Promise.resolve();
    });
    await act(async () => {
      button('신청서 제출', true).click();
    });
    await settleUntil(
      () => container.textContent?.includes('신청이 접수되었습니다') === true,
      '제출 성공 화면',
    );

    expect(createApplicationMock).toHaveBeenCalledOnce();
    expect(createApplicationPreparationMock).not.toHaveBeenCalled();
    const myTeamLink = container.querySelector<HTMLAnchorElement>(
      'a[href="/programs/program-done/team"]',
    );
    expect(myTeamLink?.textContent).toContain('우리 팀 보기');
    expect(pushMock).not.toHaveBeenCalled();
  });
  it('deleting preparation clears temporary participants and allows starting again', async () => {
    loadProgramApplyContextMock
      .mockResolvedValueOnce(
        readyContext('program-draft', '', 'draft-1', { preparation: true }),
      )
      .mockResolvedValue(readyContext('program-draft', ''));
    vi.mocked(leaveApplicationPreparation).mockResolvedValue(undefined);

    await renderPage('program-draft');
    await act(async () => {
      button('신청 준비 삭제').click();
      await Promise.resolve();
    });
    await settleUntil(
      () =>
        container.querySelector<HTMLInputElement>('#apply-team-name')
          ?.disabled === false,
      'new preparation form',
    );
    await enterText('#apply-team-name', '다시 준비');
    await act(async () => {
      inviteTrigger().click();
      await Promise.resolve();
    });

    expect(leaveApplicationPreparation).toHaveBeenCalledWith('program-draft');
    expect(createApplicationPreparationMock).toHaveBeenCalledWith(
      'program-draft',
      { name: '다시 준비' },
    );
    expect(createApplicationMock).not.toHaveBeenCalled();
  });
});
