import type { parseLandingStatsCounts } from './landing-overview';

interface LandingStatItem {
  readonly key: string;
  readonly value: string;
}

export interface LandingStatsDisplay {
  readonly items: readonly LandingStatItem[];
  readonly note: string | null;
}

export function deriveLandingStats({
  programCount,
  repositoryCount,
  contributorCount,
}: ReturnType<typeof parseLandingStatsCounts>): LandingStatsDisplay {
  const counts: readonly (readonly [string, number])[] = [
    ['공개 프로그램', programCount],
    ['공개 저장소', repositoryCount],
    ['공개 기여자', contributorCount],
  ];
  const items = counts.flatMap(([key, count]) =>
    count ? [{ key, value: String(count) }] : [],
  );
  if (items.length === 0) return { items, note: null };

  return {
    items,
    note: '공개 프로젝트 기준',
  };
}
