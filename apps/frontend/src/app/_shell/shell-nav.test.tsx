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
  { label: '아카이브', href: '/archive' },
];

const HERO_TRANSITION = 'transition-[background-color,border-color]';

function navClass(html: string): string[] {
  return (
    html.match(/data-slot="nav-bar"[^>]*class="([^"]*)"/)?.[1].split(' ') ?? []
  );
}

describe('ShellNav', () => {
  it('랜딩(/)은 마운트 전에는 흰 바이고 여정용 fixed만 둔다', () => {
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

  it('랜딩(/) 바만 색 전환을 가진다 — 모션 축소 분기는 없다', () => {
    mocks.usePathname.mockReturnValue('/');
    const landing = navClass(
      renderToStaticMarkup(<ShellNav items={ITEMS} brand="OSS Hub" />),
    );
    expect(landing).toContain(HERO_TRANSITION);
    expect(landing).toContain('duration-200');
    expect(landing.some((token) => token.startsWith('motion-reduce:'))).toBe(
      false,
    );

    for (const pathname of ['/signup', '/programs']) {
      mocks.usePathname.mockReturnValue(pathname);
      const other = navClass(
        renderToStaticMarkup(<ShellNav items={ITEMS} brand="OSS Hub" />),
      );
      expect(other, pathname).not.toContain(HERO_TRANSITION);
      expect(other, pathname).not.toContain('duration-200');
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

  it('/signup 도 흰 바이고 fixed가 아니다', () => {
    mocks.usePathname.mockReturnValue('/signup');

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

  it('홈·프로그램·아카이브 3개 링크를 렌더하고 /archive href를 포함한다', () => {
    mocks.usePathname.mockReturnValue('/programs');

    const html = renderToStaticMarkup(
      <ShellNav items={ITEMS} brand="OSS Hub" />,
    );

    expect(html).toContain('홈');
    expect(html).toContain('프로그램');
    expect(html).toContain('아카이브');
    expect(html).toContain('href="/archive"');

    expect(html).toContain('[&amp;_a:not([role=menuitem])]:min-h-11');
    expect(html).toContain('[&amp;_a:not([role=menuitem])]:min-w-11');
    expect(html).toContain('[&amp;_a:not([role=menuitem])]:justify-center');
    expect(html).toContain('[&amp;_button:not([role=menuitem])]:min-h-11');
    expect(html).toContain('[&amp;_button:not([role=menuitem])]:min-w-11');
    expect(html).not.toContain('[&amp;_a]:min-h-11');
    expect(html).not.toContain('[&amp;_button]:min-h-11');
  });
});
