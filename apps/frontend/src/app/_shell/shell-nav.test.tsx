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
  it('랜딩(/)에서는 반전 스코프 data-surface="inverted"를 부여한다', () => {
    mocks.usePathname.mockReturnValue('/');

    const html = renderToStaticMarkup(
      <ShellNav items={ITEMS} brand="OSS Hub" />,
    );

    expect(html).toContain('data-surface="inverted"');
    // 여정이 560vh 동안 sticky 무대로 이어지므로 헤더는 absolute가 아니라 fixed다.
    // z-40 인 이유: 예전에는 아래 흰 구간(z-30)이 헤더를 덮어 버려 여정이 끝나면
    // 메뉴가 사라졌다. 이제 헤더가 위에 남고 표면만 바꾼다.
    expect(html).toContain('fixed inset-x-0 top-0 z-40');
    expect(html).not.toContain('absolute inset-x-0 top-0');
    expect(html).toContain('border-transparent');
    // 첫 렌더는 우주 위 — 흰 바로 바뀌는 것은 표식이 헤더에 닿은 뒤다.
    expect(html).toContain('data-landing-surface="over-cosmos"');
    expect(html).not.toContain('shadow-sm');
  });

  it('/programs 에서는 data-surface도 class도 붙이지 않는다(회귀 없음)', () => {
    mocks.usePathname.mockReturnValue('/programs');

    const html = renderToStaticMarkup(
      <ShellNav items={ITEMS} brand="OSS Hub" />,
    );

    expect(html).not.toContain('data-surface');
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
    expect(html).toContain('[&amp;_a]:min-h-11');
    expect(html).toContain('[&amp;_a]:min-w-11');
    expect(html).toContain('[&amp;_button]:min-h-11');
    expect(html).toContain('[&amp;_button]:min-w-11');
  });
});
