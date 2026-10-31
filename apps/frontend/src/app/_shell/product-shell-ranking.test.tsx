import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useSessionRole: vi.fn(),
  getRanking: vi.fn(),
  getRankingYears: vi.fn(),
  getProgramOverview: vi.fn(),
  getProgramNavigationMilestones: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: mocks.usePathname,
  useSearchParams: mocks.useSearchParams,
}));
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
vi.mock('./use-session-role', () => ({ useSessionRole: mocks.useSessionRole }));
vi.mock('@/features/programs/catalog/program-overview-api', () => ({
  getProgramOverview: mocks.getProgramOverview,
}));
vi.mock('@/features/programs/catalog/program-navigation-api', () => ({
  getProgramNavigationMilestones: mocks.getProgramNavigationMilestones,
}));
vi.mock('@/features/ranking/api', () => ({
  getRanking: mocks.getRanking,
  getRankingYears: mocks.getRankingYears,
}));

import RankingPage from '../ranking/page';
import { ProductShell } from './product-shell';

describe('ProductShell ranking fetch', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    mocks.useSessionRole.mockReturnValue({
      status: 'assigned',
      role: 'STUDENT',
      staffAccessRequestStatus: null,
      selectedRole: null,
      isProfileComplete: true,
      retry: () => {},
    });
    mocks.getRanking.mockReset();
    mocks.getRankingYears.mockReset().mockResolvedValue([2026]);
    mocks.getProgramOverview.mockReset().mockReturnValue(new Promise(() => {}));
    mocks.getProgramNavigationMilestones
      .mockReset()
      .mockReturnValue(new Promise(() => {}));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('dashboard does not GET /ranking', async () => {
    mocks.usePathname.mockReturnValue('/dashboard');
    await act(async () => {
      root.render(
        <ProductShell>
          <p>본문</p>
        </ProductShell>,
      );
    });
    expect(mocks.getRanking).not.toHaveBeenCalled();
    expect(mocks.getRankingYears).not.toHaveBeenCalled();
  });

  it('ranking section loads years only — not the ranking page envelope', async () => {
    mocks.usePathname.mockReturnValue('/ranking');
    await act(async () => {
      root.render(
        <ProductShell>
          <p>본문</p>
        </ProductShell>,
      );
    });
    expect(mocks.getRanking).not.toHaveBeenCalled();
    expect(mocks.getRankingYears).toHaveBeenCalled();
  });

  const renderRankingPage = async (nextCycleAt: string | null) => {
    mocks.usePathname.mockReturnValue('/ranking');
    mocks.getRanking.mockResolvedValue({
      viewerClass: 'public',
      year: 2026,
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
      dataAsOf: null,
      nextCycleAt,
    });
    await act(async () => {
      root.render(
        <ProductShell>
          <RankingPage />
        </ProductShell>,
      );
    });
  };

  it('ranking page renders year chips from the shell facets', async () => {
    await renderRankingPage(null);

    const labels = [
      ...container.querySelectorAll(
        'main [data-slot="section-facet-chips"] button',
      ),
    ].map((chip) => chip.textContent);
    expect(labels).toEqual(['전체', '2026']);
    expect(mocks.getRankingYears).toHaveBeenCalledTimes(1);
  });

  it('ranking page shows the countdown when a next cycle is reported', async () => {
    await renderRankingPage('2099-01-01T00:00:00.000Z');

    expect(
      container.querySelector(
        '[data-slot="ranking-page-countdown"] [data-slot="program-countdown"]',
      ),
    ).not.toBeNull();
  });

  it('ranking page reserves nothing when no cycle is reported', async () => {
    await renderRankingPage(null);

    expect(
      container.querySelector('[data-slot="ranking-page-countdown"]')
        ?.childElementCount,
    ).toBe(0);
  });
});
