import { loadArchiveYears } from '@/features/archive/api';
import { getProgramStatusCounts } from '@/features/programs/api';
import type { ProgramListStatus } from '@/features/programs/types';
import { getRankingYears } from '@/features/ranking/api';
import type { ShellSection, SidebarItem } from './sidebar-menu';
import {
  archiveSidebarGroup,
  programSidebarGroup,
  rankingSidebarGroup,
} from './sidebar-menu';

export type SectionFacetData = {
  readonly programCounts?: Partial<Record<ProgramListStatus, number>>;
  readonly archiveYears?: readonly number[];
  readonly rankingYears?: readonly number[];
  readonly rankingCounts?: Partial<Record<'all' | number, number>>;
};

export interface SectionFacetSpec {
  readonly groupLabel: string;
  readonly param: 'status' | 'year';

  readonly load?: (signal: AbortSignal) => Promise<SectionFacetData>;
  readonly items: (
    data: SectionFacetData | undefined,
  ) => readonly SidebarItem[];
}

function abortIfSignalAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

async function loadProgramFacets(
  signal: AbortSignal,
): Promise<SectionFacetData> {
  const programCounts = await getProgramStatusCounts();
  abortIfSignalAborted(signal);
  return { programCounts };
}

async function loadArchiveFacets(
  signal: AbortSignal,
): Promise<SectionFacetData> {
  const archiveYears = await loadArchiveYears(signal);
  abortIfSignalAborted(signal);
  return { archiveYears };
}

async function loadRankingFacets(
  signal: AbortSignal,
): Promise<SectionFacetData> {
  const rankingYears = await getRankingYears(signal);
  return { rankingYears };
}

export const SECTION_FACETS: Partial<
  Record<Exclude<ShellSection, null>, SectionFacetSpec>
> = {
  programs: {
    groupLabel: '프로그램 메뉴',
    param: 'status',
    load: loadProgramFacets,
    items: (data) => programSidebarGroup(data?.programCounts).items,
  },
  archive: {
    groupLabel: '공개 아카이브',
    param: 'year',
    load: loadArchiveFacets,
    items: (data) => archiveSidebarGroup(data?.archiveYears).items,
  },
  ranking: {
    groupLabel: '랭킹',
    param: 'year',
    load: loadRankingFacets,
    items: (data) =>
      rankingSidebarGroup(data?.rankingYears ?? [], data?.rankingCounts).items,
  },
};

export function facetSectionFromHrefPath(
  hrefPath: string,
): 'programs' | 'archive' | 'ranking' | null {
  if (hrefPath === '/programs') return 'programs';
  if (hrefPath === '/archive') return 'archive';
  if (hrefPath === '/ranking') return 'ranking';
  return null;
}

export function programDetailIdFromPathname(pathname: string): string | null {
  if (pathname === '/programs' || pathname === '/programs/new') return null;
  const match = /^\/programs\/([^/]+)(?:\/.*)?$/.exec(pathname);
  if (!match) return null;

  if (match[1] === 'new') return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}
