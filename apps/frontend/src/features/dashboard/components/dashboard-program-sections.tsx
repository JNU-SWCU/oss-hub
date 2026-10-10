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
import {
  feedbackByApplication,
  splitDashboardItems,
  type ActiveDashboardItem,
} from '../sections';
import type { DashboardFeedbackItem, DashboardItem } from '../types';
import { ActiveProgramCard, ProgramCompactRow } from './student-dashboard-card';

type DashboardFilter = 'all' | 'active' | 'feedback' | 'done' | 'applying';
type FeedbackOf = (item: DashboardItem) => readonly DashboardFeedbackItem[];

const DONE_LIST_ID = 'dashboard-done-programs';

function ActiveCards({
  items,
  now,
  primaryApplicationId,
  feedbackOf,
}: {
  readonly items: readonly ActiveDashboardItem[];
  readonly now: Date;
  readonly primaryApplicationId: string | null;
  readonly feedbackOf: FeedbackOf;
}) {
  return (
    <ul className="flex flex-col gap-4">
      {items.map((item) => (
        <li key={item.applicationId}>
          <ActiveProgramCard
            item={item}
            now={now}
            primary={item.applicationId === primaryApplicationId}
            feedback={feedbackOf(item)}
          />
        </li>
      ))}
    </ul>
  );
}

function ProgramRows({
  items,
  now,
  feedbackOf,
}: {
  readonly items: readonly DashboardItem[];
  readonly now: Date;
  readonly feedbackOf: FeedbackOf;
}) {
  return (
    <ListPanel role="list">
      {items.map((item) => (
        <ProgramCompactRow
          key={item.applicationId}
          item={item}
          now={now}
          feedback={feedbackOf(item)}
        />
      ))}
    </ListPanel>
  );
}

export function DashboardProgramSections({
  items,
  now,
  feedback,
}: {
  readonly items: readonly DashboardItem[];
  readonly now: Date;
  readonly feedback: readonly DashboardFeedbackItem[];
}) {
  const [filter, setFilter] = useState<DashboardFilter>('all');
  const [doneExpanded, setDoneExpanded] = useState(false);
  const { active, done, applying, primaryApplicationId } = splitDashboardItems(
    items,
    now,
  );
  const feedbackGroups = feedbackByApplication(feedback);
  const feedbackOf: FeedbackOf = (item) =>
    feedbackGroups.get(item.applicationId) ?? [];
  const hasFeedback = (item: DashboardItem) =>
    feedbackGroups.has(item.applicationId);
  const activeWithFeedback = active.filter(hasFeedback);
  const doneWithFeedback = done.filter(hasFeedback);
  const feedbackCount = activeWithFeedback.length + doneWithFeedback.length;
  const doneCollapsible = filter === 'all' && active.length > 0;
  const doneOpen = !doneCollapsible || doneExpanded;
  const shows = (section: DashboardFilter) =>
    filter === 'all' || filter === section;
  const chips = (
    [
      ['all', '전체', items.length],
      ['active', '진행 중', active.length],
      ['feedback', '새 피드백 있음', feedbackCount],
      ['done', '마친 프로그램', done.length],
      ['applying', '신청 상태', applying.length],
    ] as const
  ).filter(
    ([value, , count]) =>
      value === 'all' || (count > 0 && count < items.length),
  );
  const filterable = chips.length > 1;

  return (
    <>
      {filterable ? (
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
          <ActiveCards
            items={active}
            now={now}
            primaryApplicationId={primaryApplicationId}
            feedbackOf={feedbackOf}
          />
        </section>
      ) : null}

      {filter === 'feedback' ? (
        <section
          aria-labelledby="dashboard-feedback-heading"
          className="flex flex-col gap-4"
        >
          <SectionHeading
            id="dashboard-feedback-heading"
            title="새 피드백이 있는 프로그램"
            meta={`${feedbackCount}개`}
          />
          {activeWithFeedback.length > 0 ? (
            <ActiveCards
              items={activeWithFeedback}
              now={now}
              primaryApplicationId={primaryApplicationId}
              feedbackOf={feedbackOf}
            />
          ) : null}
          {doneWithFeedback.length > 0 ? (
            <ProgramRows
              items={doneWithFeedback}
              now={now}
              feedbackOf={feedbackOf}
            />
          ) : null}
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
              <ProgramRows items={done} now={now} feedbackOf={feedbackOf} />
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
          <ProgramRows items={applying} now={now} feedbackOf={feedbackOf} />
        </section>
      ) : null}
    </>
  );
}
