import { loadArchiveCategoryCounts } from '@/features/archive/api';
import type { ArchiveCategoryCounts } from '@/features/archive/types';
import { getProgramStatusCounts } from '@/features/programs/api';
import type { ProgramListStatus } from '@/features/programs/types';
import { getRankingYears } from '@/features/ranking/api';
import type { ShellSection, SidebarItem } from './sidebar-menu';
import {
  archiveSidebarGroup,
  programSidebarGroup,
  rankingSidebarGroup,
} from './sidebar-menu';

/**
 * 섹션 패싯(프로그램·아카이브·랭킹) 공통 로드 결과.
 * product-shell 옵션 / load() 가 채운다. rankingCounts 는 백엔드 미제공 시 비움(Q4).
 */
export type SectionFacetData = {
  readonly programCounts?: Partial<Record<ProgramListStatus, number>>;
  readonly archiveCounts?: Partial<ArchiveCategoryCounts>;
  readonly rankingYears?: readonly number[];
  readonly rankingCounts?: Partial<Record<'all' | number, number>>;
};

export interface SectionFacetSpec {
  readonly groupLabel: string;
  readonly param: 'status' | 'category' | 'year';
  /** Optional: load counts/years. Prefer AbortSignal; if feature API lacks signal, call API then check signal.aborted. */
  readonly load?: (signal: AbortSignal) => Promise<SectionFacetData>;
  readonly items: (data: SectionFacetData | undefined) => readonly SidebarItem[];
  /**
   * 상세 경로 하이라이트 예외.
   * - `null`: 목록 경로 — 기본 쿼리 파라미터 비교 사용
   * - `boolean`: 상세(또는 비대상) — 그 값을 그대로 반환
   */
  readonly matchDetail?: (
    pathname: string,
    href: string,
    hrefQuery: string,
  ) => boolean | null;
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
  const archiveCounts = await loadArchiveCategoryCounts();
  abortIfSignalAborted(signal);
  return { archiveCounts };
}

async function loadRankingFacets(
  signal: AbortSignal,
): Promise<SectionFacetData> {
  const rankingYears = await getRankingYears(signal);
  return { rankingYears };
}

/**
 * programs / archive / ranking 피어 필터 레지스트리.
 * dashboard 는 역할 메뉴이므로 여기 넣지 않는다.
 */
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
    param: 'category',
    load: loadArchiveFacets,
    items: (data) => archiveSidebarGroup(data?.archiveCounts).items,
    matchDetail: (pathname, _href, hrefQuery) => {
      if (pathname === '/archive') return null;
      if (!pathname.startsWith('/archive/')) return false;
      // 상세는 "전체"에만 걸지 않음 — category 쿼리가 있는 항목만
      return hrefQuery !== '' && pathname.startsWith('/archive/');
    },
  },
  ranking: {
    groupLabel: '랭킹',
    param: 'year',
    load: loadRankingFacets,
    items: (data) =>
      rankingSidebarGroup(data?.rankingYears ?? [], data?.rankingCounts).items,
  },
};

/** 사이드바 항목 href 경로 → 패싯 섹션 (목록 루트만). */
export function facetSectionFromHrefPath(
  hrefPath: string,
): 'programs' | 'archive' | 'ranking' | null {
  if (hrefPath === '/programs') return 'programs';
  if (hrefPath === '/archive') return 'archive';
  if (hrefPath === '/ranking') return 'ranking';
  return null;
}
