import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { NavItem } from '@/components';

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: mocks.usePathname,
}));

import { ShellNav } from './shell-nav';

const ITEMS: NavItem[] = [
  { label: '홈', href: '/' },
  { label: '프로그램', href: '/programs' },
];

function navClass(html: string): string[] {
  return (
    html.match(/data-slot="nav-bar"[^>]*class="([^"]*)"/)?.[1].split(' ') ?? []
  );
}

describe('ShellNav', () => {
  it('랜딩(/)도 흰 바이고 히어로 위에 fixed로만 둔다', () => {
    mocks.usePathname.mockReturnValue('/');

    const html = renderToStaticMarkup(
      <ShellNav items={ITEMS} brand="OSS Hub" />,
    );

    expect(html).not.toContain('data-surface="inverted"');
    expect(html).not.toContain('border-transparent');
    expect(html).not.toContain('bg-transparent');
    expect(navClass(html)).toContain('bg-background');
    expect(html).not.toContain('data-landing-surface');
    expect(html).not.toContain('shadow-sm');

    expect(html).toContain('fixed inset-x-0 top-0 z-40');
    expect(html).not.toContain('absolute inset-x-0 top-0');
  });

  it('어느 경로에서도 바 색 전환 클래스가 없다', () => {
    for (const pathname of ['/', '/consent', '/programs']) {
      mocks.usePathname.mockReturnValue(pathname);
      const bar = navClass(
        renderToStaticMarkup(<ShellNav items={ITEMS} brand="OSS Hub" />),
      );
      expect(bar, pathname).toContain('bg-background');
      expect(bar, pathname).not.toContain('bg-transparent');
      expect(
        bar.some((token) => token.startsWith('transition-[background')),
        pathname,
      ).toBe(false);
    }
  });

  it('390px 폭에서 브랜드가 숨 쉰 여백을 둔다 — px-1 이 아니라 px-3', () => {
    mocks.usePathname.mockReturnValue('/');
    const landing = navClass(
      renderToStaticMarkup(<ShellNav items={ITEMS} brand="OSS Hub" />),
    );
    expect(landing).toContain('max-[479px]:px-3');
    expect(landing).not.toContain('max-[479px]:px-1');
  });

  it('접힌 메뉴 패널은 랜딩에서도 data-surface="default" 리셋을 유지한다', () => {
    mocks.usePathname.mockReturnValue('/');
    const html = renderToStaticMarkup(
      <ShellNav items={ITEMS} brand="OSS Hub" />,
    );
    expect(html).toMatch(
      /data-slot="nav-bar-menu-items"[^>]*data-surface="default"/,
    );
  });

  it('/consent 도 흰 바이고 fixed가 아니다', () => {
    mocks.usePathname.mockReturnValue('/consent');

    const html = renderToStaticMarkup(
      <ShellNav items={ITEMS} brand="OSS Hub" />,
    );

    expect(html).not.toContain('data-surface="inverted"');
    expect(html).not.toContain('border-transparent');
    expect(html).not.toContain('data-landing-surface');
    expect(html).not.toContain('fixed inset-x-0 top-0');
  });

  it('/programs 에서는 data-surface도 class도 붙이지 않는다(회귀 없음)', () => {
    mocks.usePathname.mockReturnValue('/programs');

    const html = renderToStaticMarkup(
      <ShellNav items={ITEMS} brand="OSS Hub" />,
    );

    expect(html).not.toContain('data-surface="inverted"');
    expect(html).not.toContain('fixed inset-x-0 top-0');
    expect(html).not.toContain('border-transparent');
  });

  it('홈·프로그램 링크를 렌더한다', () => {
    mocks.usePathname.mockReturnValue('/programs');

    const html = renderToStaticMarkup(
      <ShellNav items={ITEMS} brand="OSS Hub" />,
    );

    expect(html).toContain('홈');
    expect(html).toContain('프로그램');

    expect(html).toContain('[&amp;_a:not([role=menuitem])]:min-h-11');
    expect(html).toContain('[&amp;_a:not([role=menuitem])]:min-w-11');
    expect(html).toContain('[&amp;_a:not([role=menuitem])]:justify-center');
    expect(html).toContain('[&amp;_button:not([role=menuitem])]:min-h-11');
    expect(html).toContain('[&amp;_button:not([role=menuitem])]:min-w-11');
    expect(html).not.toContain('[&amp;_a]:min-h-11');
    expect(html).not.toContain('[&amp;_button]:min-h-11');
  });

  it('현재 경로와 맞는 상단 탭에만 aria-current="page"를 단다', () => {
    mocks.usePathname.mockReturnValue('/programs/prog-1/teams');

    const html = renderToStaticMarkup(
      <ShellNav items={ITEMS} brand="OSS Hub" />,
    );
    const current = html.match(/<a[^>]*aria-current="page"[^>]*>/g) ?? [];

    expect(current).toHaveLength(2);
    for (const tag of current) expect(tag).toContain('href="/programs"');
  });

  it('사이드바 셸 밖(공급자 없음)에서는 상단바 토글을 그리지 않는다', () => {
    mocks.usePathname.mockReturnValue('/programs');

    const html = renderToStaticMarkup(
      <ShellNav items={ITEMS} brand="OSS Hub" />,
    );

    expect(html).not.toContain('data-slot="nav-bar-sidebar-toggle"');
    expect(html).not.toContain('data-slot="nav-bar-sidebar-drawer-trigger"');
  });
});
