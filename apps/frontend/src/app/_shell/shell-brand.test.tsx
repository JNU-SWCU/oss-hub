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

import { ShellBrand, ShellBrandMark } from './shell-brand';

describe('ShellBrand', () => {
  it('공통 마크와 이름을 한 홈 링크로 렌더한다', () => {
    const html = renderToStaticMarkup(<ShellBrand />);

    expect(html).toContain('data-slot="shell-brand"');
    expect(html).toContain('data-slot="shell-brand-mark"');
    expect(html).toContain('href="/"');
    expect(html).toContain('OSS Hub');
    expect(html).toContain('min-h-control');
    expect(html).toContain('rounded-control');
  });

  it('사용 표면의 색 토큰을 호출부가 덮을 수 있다', () => {
    const html = renderToStaticMarkup(
      <ShellBrand className="text-sidebar-foreground" />,
    );

    expect(html).toContain('text-sidebar-foreground');
  });

  it('접힌 사이드바도 같은 마크를 단독으로 재사용할 수 있다', () => {
    const html = renderToStaticMarkup(<ShellBrandMark />);

    expect(html).toContain('data-slot="shell-brand-mark"');
    expect(html).not.toContain('<a');
    expect(html).toContain('aria-hidden="true"');
  });
});
