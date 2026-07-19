import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HomePage from './page';

// 홈 페이지 최상단에 공용 NavBar가 렌더되는지 검증하는 최소 스모크 테스트.
describe('home page', () => {
  it('renders the shared NavBar above the landing sections', async () => {
    const html = renderToStaticMarkup(
      await HomePage({ searchParams: undefined }),
    );

    expect(html).toContain('data-slot="nav-bar"');
    expect(html).toContain('OSS Hub');
    expect(html).toContain('/#program-types');
    expect(html).toContain('/#role-paths');
    expect(html.indexOf('data-slot="nav-bar"')).toBeLessThan(
      html.indexOf('<main'),
    );
  });

  it('renders the LoginButton in the NavBar actions slot', async () => {
    const html = renderToStaticMarkup(
      await HomePage({ searchParams: undefined }),
    );

    expect(html).toContain('data-slot="nav-bar-actions"');
    expect(html).toContain('로그인 상태 확인 중');
  });
});
