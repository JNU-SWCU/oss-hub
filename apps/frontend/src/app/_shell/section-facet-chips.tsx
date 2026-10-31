'use client';

import { useRouter } from 'next/navigation';
import { FilterChip, FilterChipGroup } from '@/components';
import {
  buildProgramListHref,
  parseProgramListSearchParams,
  parseProgramListStatus,
} from '@/features/programs/catalog/program-list-url-state';
import { formatSidebarCount } from './app-sidebar';
import {
  programDetailIdFromPathname,
  SECTION_FACETS,
  type SectionFacetSpec,
} from './section-facets';
import { useShellFacets, type ShellFacets } from './shell-facets-context';
import { isCurrentSidebarItem } from './sidebar-menu';
import { SidebarCountSkeleton } from './sidebar-shell';

const FILTER_LABELS: Readonly<Record<SectionFacetSpec['param'], string>> = {
  status: '프로그램 상태 필터',
  year: '연도 필터',
};

function programChipHref(href: string, search: string): string {
  return buildProgramListHref({
    ...parseProgramListSearchParams(new URLSearchParams(search)),
    status: parseProgramListStatus(
      new URLSearchParams(href.split('?')[1]).get('status'),
    ),
    year: undefined,
    page: 1,
  });
}

function FacetChipRow({
  facets,
  spec,
}: {
  readonly facets: ShellFacets;
  readonly spec: SectionFacetSpec;
}) {
  const router = useRouter();
  const { section, groups, facetStatus, pathname, search } = facets;
  const countsPending = facetStatus === 'pending' && section === 'programs';

  return (
    <FilterChipGroup
      data-slot="section-facet-chips"
      data-section={section ?? undefined}
      aria-label={FILTER_LABELS[spec.param]}
      className="-m-1 flex-nowrap overflow-x-auto p-1 shell:hidden"
    >
      {groups.flatMap((group) =>
        group.items.map((item) => (
          <FilterChip
            key={item.href}
            pressed={isCurrentSidebarItem(pathname, item.href, search)}
            onClick={() =>
              router.push(
                section === 'programs'
                  ? programChipHref(item.href, search)
                  : item.href,
              )
            }
          >
            {item.label}
            {countsPending ? <SidebarCountSkeleton /> : null}
            {item.count !== undefined ? (
              <span
                data-slot="section-facet-chip-count"
                className="tabular-nums"
              >
                {formatSidebarCount(item.count)}
              </span>
            ) : null}
          </FilterChip>
        )),
      )}
    </FilterChipGroup>
  );
}

export function SectionFacetChips() {
  const facets = useShellFacets();
  if (facets === null) return null;
  if (programDetailIdFromPathname(facets.pathname) !== null) return null;
  const spec = facets.section ? SECTION_FACETS[facets.section] : undefined;
  if (!spec) return null;
  return <FacetChipRow facets={facets} spec={spec} />;
}
