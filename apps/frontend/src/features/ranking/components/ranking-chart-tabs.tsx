'use client';

import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { RankingTimeline } from '../types';
import { comicNeue } from './comic-font';
import { RankingBumpChart } from './ranking-bump-chart';
import { RankingGrowthChart } from './ranking-growth-chart';
import { RankingMonthRace } from './ranking-month-race';
import {
  buildGrowthInsights,
  buildMonthRace,
  chartTabPlan,
  type RankingChartTab,
} from './ranking-insights-model';
import styles from './ranking-insights.module.css';

const TAB_LABELS: Record<RankingChartTab, string> = {
  growth: '내 성장',
  month: '이번 달',
  race: '순위 레이스',
};
const MOVE_KEYS = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];

function EmptyChartCard() {
  return (
    <div
      role="group"
      aria-label="순위 변화 그래프"
      data-active-tab="race"
      data-chart-empty=""
      className={cn(styles.root, comicNeue.variable)}
    >
      <div className={styles.panel}>
        <div className={styles.panelBody}>
          <p className={styles.panelTitle}>아직 그릴 활동이 없어요</p>
          <p className={styles.panelNote}>
            올해 첫 커밋·PR이 집계되면 이 연습장에 선이 생겨요. 순위표는 아래에
            그대로 있어요.
          </p>
        </div>
      </div>
    </div>
  );
}

export function RankingChartTabs({
  timeline,
}: {
  readonly timeline: RankingTimeline;
}) {
  const plan = useMemo(() => chartTabPlan(timeline), [timeline]);
  const growth = useMemo(() => buildGrowthInsights(timeline), [timeline]);
  const race = useMemo(() => buildMonthRace(timeline), [timeline]);
  const [chosen, setChosen] = useState<RankingChartTab>(plan.active);
  const [mounted, setMounted] = useState<readonly RankingChartTab[]>([
    plan.active,
  ]);
  const buttons = useRef(new Map<RankingChartTab, HTMLButtonElement | null>());
  const prefix = useId();

  const tabs = plan.tabs;
  const active = tabs.includes(chosen) ? chosen : plan.active;

  const activate = useCallback((tab: RankingChartTab) => {
    setChosen(tab);
    setMounted((current) =>
      current.includes(tab) ? current : [...current, tab],
    );
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!MOVE_KEYS.includes(event.key)) return;
      event.preventDefault();
      const last = tabs.length - 1;
      const index = tabs.indexOf(active);
      let next = index;
      if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
      if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = last;
      const target = tabs[next];
      if (target === undefined) return;
      activate(target);
      buttons.current.get(target)?.focus();
    },
    [activate, active, tabs],
  );

  if (timeline.points.length === 0) return null;
  if (timeline.series.length === 0) return <EmptyChartCard />;

  if (tabs.length === 0) {
    return (
      <div
        data-active-tab="race"
        className={cn(styles.root, comicNeue.variable)}
      >
        <div className={styles.racePanel}>
          <RankingBumpChart timeline={timeline} />
        </div>
      </div>
    );
  }

  return (
    <div
      data-active-tab={active}
      className={cn(styles.root, comicNeue.variable)}
    >
      <div
        role="tablist"
        aria-label="랭킹 그래프 보기"
        className={styles.tablist}
        onKeyDown={onKeyDown}
      >
        {tabs.map((tab) => (
          <Button
            key={tab}
            ref={(node) => {
              buttons.current.set(tab, node);
            }}
            type="button"
            variant="bare"
            size="sm"
            role="tab"
            id={`${prefix}-tab-${tab}`}
            data-tab={tab}
            aria-selected={tab === active}
            aria-controls={`${prefix}-panel-${tab}`}
            tabIndex={tab === active ? 0 : -1}
            className={styles.tab}
            onClick={() => {
              activate(tab);
            }}
          >
            {TAB_LABELS[tab]}
          </Button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${prefix}-panel-growth`}
        aria-labelledby={`${prefix}-tab-growth`}
        data-tab-panel="growth"
        tabIndex={0}
        hidden={active !== 'growth'}
        className={styles.panel}
      >
        {mounted.includes('growth') ? (
          <RankingGrowthChart timeline={timeline} insights={growth} />
        ) : null}
      </div>
      <div
        role="tabpanel"
        id={`${prefix}-panel-month`}
        aria-labelledby={`${prefix}-tab-month`}
        data-tab-panel="month"
        tabIndex={0}
        hidden={active !== 'month'}
        className={styles.panel}
      >
        {mounted.includes('month') && race !== null ? (
          <RankingMonthRace race={race} active={active === 'month'} />
        ) : null}
      </div>
      <div
        role="tabpanel"
        id={`${prefix}-panel-race`}
        aria-labelledby={`${prefix}-tab-race`}
        data-tab-panel="race"
        tabIndex={0}
        hidden={active !== 'race'}
        className={styles.racePanel}
      >
        {mounted.includes('race') ? (
          <RankingBumpChart timeline={timeline} />
        ) : null}
      </div>
    </div>
  );
}
