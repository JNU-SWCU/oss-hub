'use client';

import { CalendarDays } from 'lucide-react';
import { useRef, type KeyboardEvent, type ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import { formatMatrixDueDateTime } from '../matrix';
import type { MatrixMilestone } from '../types';

export interface MatrixStageNavigationProps {
  readonly milestones: readonly MatrixMilestone[];
  readonly selectedMilestoneId: string | null;
  readonly onSelectMilestone: (milestoneId: string | null) => void;
}

interface StageOption {
  readonly id: string | null;
  readonly label: string;
}

function stageOptions(
  milestones: readonly MatrixMilestone[],
): readonly StageOption[] {
  return [
    { id: null, label: '모든 단계' },
    ...milestones.map((milestone) => ({
      id: milestone.id,
      label: milestone.name,
    })),
  ];
}

/** 561–899px에서는 긴 목록을 다시 위로 찾지 않도록 본문 상단에 고정한다. */
function TabletStageTabs(props: MatrixStageNavigationProps): ReactElement {
  const options = stageOptions(props.milestones);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const moveFocus = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % options.length;
    if (event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + options.length) % options.length;
    }
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = options.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    buttons.current[nextIndex]?.focus();
  };

  return (
    <div className="sticky top-0 z-20 -mx-2 hidden border-y border-border bg-background/95 px-2 py-3 backdrop-blur min-[561px]:block min-[900px]:hidden">
      <div
        role="group"
        aria-label="볼 제출 단계"
        className="flex max-w-full gap-2 overflow-x-auto pb-1"
      >
        {options.map((option, index) => {
          const selected = option.id === props.selectedMilestoneId;
          return (
            <Button
              key={option.id ?? 'all'}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              type="button"
              size="sm"
              variant={selected ? 'default' : 'outline'}
              aria-pressed={selected}
              onKeyDown={(event) => moveFocus(event, index)}
              onClick={() => props.onSelectMilestone(option.id)}
              className="shrink-0 px-4"
            >
              {option.label}
              {selected ? (
                <span className="text-[11px] font-bold">선택됨</span>
              ) : null}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

/** 560px 이하에서는 한 줄 라벨과 네이티브 선택 메뉴로 공간을 아낀다. */
function MobileStageSelect(props: MatrixStageNavigationProps): ReactElement {
  return (
    <div className="sticky top-0 z-20 -mx-2 grid gap-2 border-y border-border bg-background/95 px-2 py-3 backdrop-blur min-[561px]:hidden">
      <label
        htmlFor="matrix-mobile-stage"
        className="text-small font-semibold text-foreground"
      >
        볼 제출 단계
      </label>
      <select
        id="matrix-mobile-stage"
        aria-label="볼 제출 단계"
        value={props.selectedMilestoneId ?? ''}
        onChange={(event) =>
          props.onSelectMilestone(event.target.value || null)
        }
        className="h-control w-full rounded-control border border-input bg-background px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {stageOptions(props.milestones).map((option) => (
          <option key={option.id ?? 'all'} value={option.id ?? ''}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function MatrixStageNavigation(
  props: MatrixStageNavigationProps,
): ReactElement {
  return (
    <>
      <TabletStageTabs {...props} />
      <MobileStageSelect {...props} />
    </>
  );
}

export function MatrixFocusSummary({
  milestone,
}: {
  readonly milestone: MatrixMilestone;
}): ReactElement {
  return (
    <section
      data-slot="matrix-focus-summary"
      aria-labelledby="matrix-focus-title"
      className="grid gap-3 rounded-card border border-primary/25 bg-primary/5 p-card sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center"
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
        <CalendarDays aria-hidden="true" className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-small font-semibold text-primary">집중 보기</p>
        <h2
          id="matrix-focus-title"
          className="font-heading text-lg font-semibold"
        >
          {milestone.name}
        </h2>
        <p className="mt-1 text-small text-muted-foreground">
          {formatMatrixDueDateTime(milestone.dueAt)} 마감
        </p>
        <p className="mt-2 text-sm text-foreground">
          선택한 제출 단계의 현황만 한눈에 확인합니다.
        </p>
      </div>
    </section>
  );
}
