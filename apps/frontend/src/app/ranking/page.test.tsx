import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RankingCycleProvider } from '../_shell/ranking-cycle-context';

vi.mock('@/features/ranking', () => ({
  RankingScreen: ({
    onNextCycleAt,
  }: {
    onNextCycleAt: (nextCycleAt: string | null) => void;
  }) => (
    <section
      data-testid="ranking-screen"
      data-has-cycle-publisher={typeof onNextCycleAt}
    >
      실제 랭킹 화면
    </section>
  ),
}));

import RankingPage from './page';

describe('RankingPage', () => {
  it('로그인·역할 없이 랭킹 화면을 렌더하고 nextCycleAt 발행 함수를 넘긴다', () => {
    const html = renderToStaticMarkup(
      <RankingCycleProvider>
        <RankingPage />
      </RankingCycleProvider>,
    );

    expect(html).toContain('data-testid="ranking-screen"');
    expect(html).toContain('실제 랭킹 화면');
    expect(html).toContain('data-has-cycle-publisher="function"');
    expect(html).not.toContain('data-viewer-role');
    expect(html).not.toContain('useSessionRole');
  });
});
