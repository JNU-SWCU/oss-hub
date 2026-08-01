import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/features/ranking', () => ({
  RankingScreen: () => (
    <section data-testid="ranking-screen">실제 랭킹 화면</section>
  ),
}));

import RankingPage from './page';

describe('RankingPage', () => {
  it('로그인 없이 공개로 랭킹 화면을 렌더링한다', () => {
    const html = renderToStaticMarkup(<RankingPage />);

    expect(html).toContain('data-testid="ranking-screen"');
    expect(html).toContain('실제 랭킹 화면');
  });
});
