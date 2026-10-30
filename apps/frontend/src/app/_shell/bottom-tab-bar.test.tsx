import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { BottomTabBar } from './bottom-tab-bar';
import { sectionItemsFor } from './section-list';

const GUEST = { status: 'anonymous', isProfileComplete: false } as const;
const STUDENT = { status: 'assigned', isProfileComplete: true } as const;

function render(
  pathname: string,
  session: { status: 'anonymous' | 'assigned'; isProfileComplete: boolean },
): Document {
  const html = renderToStaticMarkup(
    <BottomTabBar items={sectionItemsFor(session)} pathname={pathname} />,
  );
  return new DOMParser().parseFromString(html, 'text/html');
}

function tabs(doc: Document): HTMLAnchorElement[] {
  return Array.from(doc.querySelectorAll('[data-slot="bottom-tab-bar"] a'));
}

function currentTabs(doc: Document): HTMLAnchorElement[] {
  return tabs(doc).filter((tab) => tab.getAttribute('aria-current') === 'page');
}

describe('BottomTabBar', () => {
  it('섹션 nav 하나에 비회원 3개, 가입을 마친 회원 4개 탭을 그린다', () => {
    const guest = render('/programs', GUEST);
    const nav = guest.querySelector('nav[data-slot="bottom-tab-bar"]');
    expect(nav?.getAttribute('aria-label')).toBe('섹션');
    expect(tabs(guest).map((tab) => tab.getAttribute('href'))).toEqual([
      '/programs',
      '/archive',
      '/ranking',
    ]);

    const member = render('/programs', STUDENT);
    expect(tabs(member).map((tab) => tab.getAttribute('href'))).toEqual([
      '/programs',
      '/archive',
      '/ranking',
      '/dashboard',
    ]);
    expect(tabs(member).at(-1)?.textContent).toContain('대시보드');
  });

  it('각 탭은 아이콘과 라벨을 함께 담는다', () => {
    for (const tab of tabs(render('/archive', STUDENT))) {
      expect(tab.querySelector('svg[data-icon]')).not.toBeNull();
      expect(tab.textContent?.trim()).not.toBe('');
    }
  });

  it('/programs/abc 에서는 프로그램 탭만 aria-current="page"다', () => {
    const current = currentTabs(render('/programs/abc', GUEST));
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute('href')).toBe('/programs');
    expect(current[0].dataset.current).toBe('true');
  });

  it('학생의 /my-repos 와 /dashboard/* 는 대시보드 탭을 현재로 표시한다', () => {
    for (const pathname of ['/my-repos', '/dashboard', '/dashboard/activity']) {
      const current = currentTabs(render(pathname, STUDENT));
      expect(current, pathname).toHaveLength(1);
      expect(current[0].getAttribute('href'), pathname).toBe('/dashboard');
    }
  });

  it('어느 섹션에도 속하지 않는 경로에서는 현재 탭이 없다', () => {
    expect(currentTabs(render('/settings', STUDENT))).toHaveLength(0);
  });
});
