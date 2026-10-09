'use client';

import { useState } from 'react';

import {
  FilterChip,
  FilterChipGroup,
  ListPanel,
  SectionHeading,
} from '@/components';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { splitDashboardItems } from '../sections';
import type { DashboardItem } from '../types';
import { ActiveProgramCard, ProgramCompactRow } from './student-dashboard-card';

type DashboardFilter = 'all' | 'active' | 'done' | 'applying';

const FILTER_CHIP_MIN_ITEMS = 5;
const DONE_LIST_ID = 'dashboard-done-programs';

function ProgramRows({ items }: { readonly items: readonly DashboardItem[] }) {
  return (
    <ListPanel role="list">
      {items.map((item) => (
        <ProgramCompactRow key={item.applicationId} item={item} />
      ))}
    </ListPanel>
  );
}

export function DashboardProgramSections({
  items,
  now,
}: {
  readonly items: readonly DashboardItem[];
  readonly now: Date;
}) {
  const [filter, setFilter] = useState<DashboardFilter>('all');
  const [doneExpanded, setDoneExpanded] = useState(false);
  const { active, done, applying, primaryApplicationId } =
    splitDashboardItems(items);
  const doneCollapsible = filter === 'all' && active.length > 0;
  const doneOpen = !doneCollapsible || doneExpanded;
  const shows = (section: DashboardFilter) =>
    filter === 'all' || filter === section;
  const chips = (
    [
      ['all', '전체', items.length],
      ['active', '진행 중', active.length],
      ['done', '마친 프로그램', done.length],
      ['applying', '신청 상태', applying.length],
    ] as const
  ).filter(([, , count]) => count > 0);

  return (
    <>
      {items.length >= FILTER_CHIP_MIN_ITEMS ? (
        <FilterChipGroup aria-label="프로그램 거르기">
          {chips.map(([value, label, count]) => (
            <FilterChip
              key={value}
              pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label} {count}
            </FilterChip>
          ))}
        </FilterChipGroup>
      ) : null}

      {shows('active') && active.length > 0 ? (
        <section
          aria-labelledby="dashboard-active-heading"
          className="flex flex-col gap-4"
        >
          <SectionHeading
            id="dashboard-active-heading"
            title="진행 중"
            meta={`${active.length}개 · 마감이 가까운 순`}
          />
          <ul className="flex flex-col gap-4">
            {active.map((item) => (
              <li key={item.applicationId}>
                <ActiveProgramCard
                  item={item}
                  now={now}
                  primary={item.applicationId === primaryApplicationId}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {shows('done') && done.length > 0 ? (
        <Collapsible asChild open={doneOpen} onOpenChange={setDoneExpanded}>
          <section
            aria-labelledby="dashboard-done-heading"
            className="flex flex-col gap-4"
          >
            <SectionHeading
              id="dashboard-done-heading"
              title="마친 프로그램"
              meta={`${done.length}개`}
              action={
                doneCollapsible ? (
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-controls={DONE_LIST_ID}
                    >
                      {doneOpen ? '접기' : '펼치기'}
                    </Button>
                  </CollapsibleTrigger>
                ) : null
              }
            />
            <CollapsibleContent
              forceMount
              id={DONE_LIST_ID}
              className="data-[state=closed]:hidden"
            >
              <ProgramRows items={done} />
            </CollapsibleContent>
          </section>
        </Collapsible>
      ) : null}

      {shows('applying') && applying.length > 0 ? (
        <section
          aria-labelledby="dashboard-applying-heading"
          className="flex flex-col gap-4"
        >
          <SectionHeading
            id="dashboard-applying-heading"
            title="신청 상태"
            meta={`${applying.length}개`}
          />
          <ProgramRows items={applying} />
        </section>
      ) : null}
    </>
  );
}
