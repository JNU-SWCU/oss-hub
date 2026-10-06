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

describe('ShellNav', () => {
  it('랜딩(/)은 흰 바이고 여정용 fixed만 둔다', () => {
    mocks.usePathname.mockReturnValue('/');

    const html = renderToStaticMarkup(
      <ShellNav items={ITEMS} brand="OSS Hub" />,
    );

    expect(html).not.toContain('data-surface="inverted"');
    expect(html).not.toContain('border-transparent');
    expect(html).not.toContain('data-landing-surface');
    expect(html).not.toContain('shadow-sm');

    expect(html).toContain('fixed inset-x-0 top-0 z-40');
    expect(html).not.toContain('absolute inset-x-0 top-0');
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
