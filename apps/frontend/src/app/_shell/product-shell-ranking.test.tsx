// @vitest-environment happy-dom

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
}));

vi.mock('next/navigation', () => ({
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
vi.mock('@/features/programs/program-overview-api', () => ({
  getProgramOverview: mocks.getProgramOverview,
}));
vi.mock('@/features/ranking/api', () => ({
  getRanking: mocks.getRanking,
  getRankingYears: mocks.getRankingYears,
}));

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
});
