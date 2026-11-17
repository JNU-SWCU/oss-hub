import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RankingCycleProvider } from '../_shell/ranking-cycle-context';

vi.mock('@/features/ranking', () => ({
  RankingPageHeader: () => <header data-testid="ranking-header" />,
  RankingScreen: ({
    header,
    onNextCycleAt,
  }: {
    header: ReactNode;
    onNextCycleAt: (nextCycleAt: string | null) => void;
  }) => (
    <section
      data-testid="ranking-screen"
      data-has-cycle-publisher={typeof onNextCycleAt}
    >
      {header}
      실제 랭킹 화면
    </section>
  ),
}));

import RankingPage from './page';

function renderRankingPage(): string {
  return renderToStaticMarkup(
    <RankingCycleProvider>
      <RankingPage />
    </RankingCycleProvider>,
  );
}

describe('RankingPage', () => {
  it('로그인·역할 없이 랭킹 화면을 렌더하고 nextCycleAt 발행 함수를 넘긴다', () => {
    const html = renderRankingPage();

    expect(html).toContain('data-testid="ranking-screen"');
    expect(html).toContain('실제 랭킹 화면');
    expect(html).toContain('data-has-cycle-publisher="function"');
    expect(html).not.toContain('data-viewer-role');
    expect(html).not.toContain('useSessionRole');
  });

  it('서버에서 그린 머리말을 랭킹 화면 안에 넣는다', () => {
    const html = renderRankingPage();

    expect(html).toMatch(
      /data-testid="ranking-screen"[^>]*><header data-testid="ranking-header">/,
    );
  });
});
