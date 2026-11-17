import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryRoot as createRoot } from '../../../test-support/render-with-query';
import { featureKey } from '@/lib/query-keys';
import { MyProfileScreen } from './components/my-profile-screen';
import { SettingsScreen } from './settings/components/settings-screen';

type Root = ReturnType<typeof createRoot>;

const mocks = vi.hoisted(() => ({ assign: vi.fn() }));

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const STUDENT = {
  githubLogin: 'synthetic-student',
  memberKind: 'STUDENT',
  name: '합성 학생',
  studentId: '260001',
  staffNumber: null,
  department: '인공지능학부',
  phone: '1'.repeat(10),
  isComplete: true,
  participations: [
    {
      programId: 'program-1',
      programName: '합성 프로그램',
      teamName: '합성 팀',
      isLeader: true,
    },
  ],
};

const NOTIFICATION = {
  notificationEmail: 'synthetic@example.com',
  notifyEnabled: true,
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('내 정보 화면', () => {
  let container: HTMLDivElement;
  let root: Root;
  let profileReads: number;
  let readProfile: () => Response | Promise<Response>;
  let saveProfile: (body: Record<string, unknown>) => Response;

  beforeEach(() => {
    mocks.assign.mockReset();
    profileReads = 0;
    readProfile = () => jsonResponse(STUDENT);
    saveProfile = () => jsonResponse(STUDENT);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (url.endsWith('/users/me/profile')) {
          if (method === 'GET') {
            profileReads += 1;
            return readProfile();
          }
          return saveProfile(
            typeof init?.body === 'string'
              ? (JSON.parse(init.body) as Record<string, unknown>)
              : {},
          );
        }
        if (url.endsWith('/users/me/notification-email')) {
          return jsonResponse(NOTIFICATION);
        }
        throw new Error(`예상하지 못한 요청: ${method} ${url}`);
      }),
    );
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign: mocks.assign, search: '', pathname: '/dashboard/me' },
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render(children: ReactNode): Promise<void> {
    await act(async () => root.render(children));
  }

  function card(): Element | null {
    return container.querySelector('[data-slot="user-profile-card"]');
  }

  function failure(): Element | null {
    return container.querySelector('[data-slot="failure-state"]');
  }

  it('처음 열면 한 번 조회하고, 응답 전에는 진행 상태를 응답 후에는 받은 값을 보여 준다', async () => {
    const response = Promise.withResolvers<Response>();
    readProfile = () => response.promise;
    await render(<MyProfileScreen />);

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(card()).toBeNull();

    await act(async () => response.resolve(jsonResponse(STUDENT)));

    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(card()?.querySelector('h2')?.textContent).toBe('합성 학생');
    expect(card()?.textContent).toContain('260001');
    expect(card()?.textContent).toContain('합성 팀 · 팀장');
    expect(profileReads).toBe(1);
  });

  it('형식이 어긋난 응답은 빈 참여 목록으로 꾸미지 않고 실패로 알리며 다시 시도로 복구한다', async () => {
    readProfile = () => jsonResponse({ ...STUDENT, participations: null });
    await render(<MyProfileScreen />);

    expect(failure()).not.toBeNull();
    expect(card()).toBeNull();
    expect(container.textContent).not.toContain('참여 프로그램이 없습니다.');

    readProfile = () => jsonResponse(STUDENT);
    await act(async () => failure()?.querySelector('button')?.click());

    expect(failure()).toBeNull();
    expect(card()?.textContent).toContain('합성 프로그램');
    expect(profileReads).toBe(2);
  });

  it('인증이 끊긴 응답은 실패 안내 없이 홈으로 보낸다', async () => {
    readProfile = () =>
      jsonResponse(
        {
          type: 'about:blank',
          title: '합성 인증 만료',
          status: 401,
          detail: '합성 인증 만료',
          instance: '/users/me/profile',
          code: 'AUT_003',
        },
        401,
      );
    await render(<MyProfileScreen />);

    expect(mocks.assign).toHaveBeenCalledWith('/');
    expect(failure()).toBeNull();
    expect(card()).toBeNull();
  });

  it('설정에서 저장한 값은 다시 조회가 끝나기 전에도 내 정보에 그대로 보인다', async () => {
    root.queryClient.setQueryDefaults(featureKey('profile'), {
      gcTime: Infinity,
    });
    let server: Record<string, unknown> = STUDENT;
    readProfile = () => jsonResponse(server);
    saveProfile = (body) => {
      server = { ...server, ...body };
      return jsonResponse(server);
    };
    await render(
      <SettingsScreen memberKind="STUDENT" hasAdminAccess={false} />,
    );
    const name = container.querySelector('#settings-name');
    if (!(name instanceof HTMLInputElement)) {
      throw new TypeError('이름 입력란을 찾지 못했습니다');
    }
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(name, '합성 수정 학생');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector('form')
        ?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
    });
    expect(container.textContent).toContain('저장되었습니다.');

    const refresh = Promise.withResolvers<Response>();
    readProfile = () => refresh.promise;
    await render(<MyProfileScreen />);

    expect(card()?.querySelector('h2')?.textContent).toBe('합성 수정 학생');
    expect(container.textContent).not.toContain('합성 학생');

    await act(async () => refresh.resolve(jsonResponse(server)));

    expect(card()?.querySelector('h2')?.textContent).toBe('합성 수정 학생');
  });
});
