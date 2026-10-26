import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgramActions } from '@/features/programs/catalog/program-detail-page';
import { renderSignInApplyEntry } from '@/app/programs/[id]/sign-in-apply-entry';
import type { ProgramDetail } from '@/features/programs/catalog/dto';
import {
  rememberLoginDestination,
  takeLoginDestination,
} from '@/features/auth/login-destination';
import { githubLoginPath } from '@/features/auth/login-paths';
import type { AuthSession } from '@/features/auth/types';
import { LoginButtonView } from '@/features/auth/components/login-button';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const KEY = 'oss-hub-login-destination';
const SEEDED_AT = Date.now();

function programWithId(id: string): ProgramDetail {
  return {
    id,
    name: '합성 공개 프로그램',
    organizer: '합성 운영기관',
    trackType: 'EXTRACURRICULAR',
    applicationTemplateKey: 'basic',
    lifecycle: 'PUBLISHED',
    description: '누구나 볼 수 있는 합성 프로그램.',
    repositoryProvisioningEnabled: false,
    applicationPeriod: {
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2099-12-31T23:59:59.000Z',
    },
    viewer: { role: null, applicationStatus: null },
    milestones: [],
  };
}

describe('익명 로그인 진입점은 GitHub으로 직행하며 돌아올 곳을 기억한다', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    sessionStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderNav(pathname: string) {
    const session = { isAuthenticated: false } satisfies AuthSession;
    act(() =>
      root.render(
        <LoginButtonView
          session={session}
          pathname={pathname}
          logoutError={null}
          menuOpen={false}
          onMenuOpenChange={vi.fn()}
          onLogout={vi.fn()}
        />,
      ),
    );
  }
  function renderApply(id: string) {
    act(() => root.render(<ProgramActions
          program={programWithId(id)}
          renderSignInApply={renderSignInApplyEntry}
        />));
  }
  function clickLink() {
    const element = container.querySelector('a');
    if (!element) throw new Error('Expected sign-in link');
    element.addEventListener('click', (event) => event.preventDefault());
    act(() => {
      element.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    return element;
  }

  it('/programs 의 내비 버튼은 githubLoginPath 로 가고 클릭하면 /programs 를 저장한다', () => {
    renderNav('/programs');
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      githubLoginPath,
    );
    clickLink();
    expect(takeLoginDestination(sessionStorage)).toBe('/programs');
  });

  it('프로그램 p1 상세의 신청하기는 /programs/p1/apply 를 저장한다', () => {
    renderApply('p1');
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      githubLoginPath,
    );
    clickLink();
    expect(takeLoginDestination(sessionStorage)).toBe('/programs/p1/apply');
  });

  it('랜딩(/)의 내비 클릭은 이미 저장된 복귀 경로를 바이트 단위로 보존한다', () => {
    rememberLoginDestination(sessionStorage, '/programs/42/apply', SEEDED_AT);
    const before = sessionStorage.getItem(KEY);
    expect(before).not.toBeNull();
    renderNav('/');
    clickLink();
    expect(sessionStorage.getItem(KEY)).toBe(before);
  });

  it('인코딩이 필요한 id(ex:p1)의 신청하기 클릭은 저장값을 건드리지 않는다', () => {
    rememberLoginDestination(sessionStorage, '/programs/42/apply', SEEDED_AT);
    const before = sessionStorage.getItem(KEY);
    renderApply('ex:p1');
    clickLink();
    expect(sessionStorage.getItem(KEY)).toBe(before);
  });

  it('/signup 에서는 로그인 버튼을 내지 않는다', () => {
    renderNav('/signup');
    expect(container.innerHTML).toBe('');
  });
});
