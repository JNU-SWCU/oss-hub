import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  usePathname: vi.fn(),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useSessionRole: vi.fn(),
  getProgramStatusCounts: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
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
vi.mock('@/features/programs/catalog/api', () => ({
  getProgramStatusCounts: mocks.getProgramStatusCounts,
}));

import { ProductShell } from './product-shell';
import { SectionFacetChips } from './section-facet-chips';
import { ShellFacetsContext, type ShellFacets } from './shell-facets-context';
import { programSidebarGroup } from './sidebar-menu';

const COUNTS = { all: 120, recruiting: 3, in_progress: 0 };

function programFacets(overrides: Partial<ShellFacets> = {}): ShellFacets {
  return {
    section: 'programs',
    groups: [programSidebarGroup(COUNTS)],
    facetStatus: 'success',
    pathname: '/programs',
    search: '',
    ...overrides,
  };
}

describe('SectionFacetChips', () => {
  let container: HTMLDivElement;
  let root: Root;

  const chip = (label: string) => {
    const found = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[data-slot="section-facet-chips"] button',
      ),
    ].find((button) => button.textContent?.startsWith(label));
    if (!found) throw new Error(`chip not found: ${label}`);
    return found;
  };

  const renderChips = async (facets: ShellFacets | null) => {
    await act(async () => {
      root.render(
        <ShellFacetsContext.Provider value={facets}>
          <SectionFacetChips />
        </ShellFacetsContext.Provider>,
      );
    });
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    mocks.push.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('marks the chip for the current facet value as pressed', async () => {
    await renderChips(programFacets({ search: 'status=recruiting' }));

    expect(chip('모집').getAttribute('aria-pressed')).toBe('true');
    expect(chip('전체').getAttribute('aria-pressed')).toBe('false');
  });

  it('shows capped counts, including zero', async () => {
    await renderChips(programFacets());

    const count = (label: string) =>
      chip(label).querySelector('[data-slot="section-facet-chip-count"]')
        ?.textContent;
    expect(count('전체')).toBe('99+');
    expect(count('모집')).toBe('3');
    expect(count('진행')).toBe('0');
  });

  it('shows a count skeleton while program counts are pending', async () => {
    await renderChips(
      programFacets({
        facetStatus: 'pending',
        groups: [programSidebarGroup()],
      }),
    );

    expect(
      chip('전체').querySelector('[data-slot="sidebar-count-skeleton"]'),
    ).not.toBeNull();
  });

  it('keeps sort and direction when a program chip navigates', async () => {
    await renderChips(
      programFacets({ search: 'sort=applicationPeriod&direction=desc' }),
    );

    await act(async () => chip('모집').click());

    expect(mocks.push).toHaveBeenCalledWith(
      '/programs?status=recruiting&sort=applicationPeriod&direction=desc',
    );
  });

  it('renders nothing on program detail even though the section is programs', async () => {
    await renderChips(programFacets({ pathname: '/programs/abc' }));

    expect(
      container.querySelector('[data-slot="section-facet-chips"]'),
    ).toBeNull();
  });

  it('renders nothing for a section without facets or outside the shell', async () => {
    await renderChips(
      programFacets({ section: 'dashboard', pathname: '/dashboard' }),
    );
    expect(
      container.querySelector('[data-slot="section-facet-chips"]'),
    ).toBeNull();

    await renderChips(null);
    expect(
      container.querySelector('[data-slot="section-facet-chips"]'),
    ).toBeNull();
  });

  it('program chips share one counts request and navigate to ended programs', async () => {
    mocks.usePathname.mockReturnValue('/programs');
    mocks.useSearchParams.mockReturnValue(new URLSearchParams());
    mocks.useSessionRole.mockReturnValue({
      status: 'anonymous',
      memberKind: null,
      hasStaffAccess: false,
      hasAdminAccess: false,
      isProfileComplete: false,
      retry: () => {},
    });
    mocks.getProgramStatusCounts.mockReset().mockResolvedValue(COUNTS);

    await act(async () => {
      root.render(
        <ProductShell>
          <SectionFacetChips />
        </ProductShell>,
      );
    });

    expect(mocks.getProgramStatusCounts).toHaveBeenCalledTimes(1);
    expect(
      container.querySelectorAll('[data-slot="section-facet-chips"] button'),
    ).toHaveLength(5);
    expect(chip('종료').getAttribute('aria-pressed')).toBe('false');
    await act(async () => chip('종료').click());
    expect(mocks.push).toHaveBeenCalledWith('/programs?status=ended');
  });
});
