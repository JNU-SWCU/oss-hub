import type { ReactElement } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TableHead } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { StaffInsightsProgramRow } from './types';

export const PROGRAM_SORTS = {
  PARTICIPANTS: 'participants',
  COMPETITION: 'competition',
  NON_SW_SHARE: 'nonSwShare',
  COMPLETION: 'completion',
  OUTCOME: 'outcome',
} as const;

export type ProgramSort = (typeof PROGRAM_SORTS)[keyof typeof PROGRAM_SORTS];

type SortDirection = 'asc' | 'desc';

export interface SortState {
  readonly key: ProgramSort;
  readonly direction: SortDirection;
}

const SORT_LABELS: Readonly<Record<ProgramSort, string>> = {
  [PROGRAM_SORTS.PARTICIPANTS]: '승인 참여',
  [PROGRAM_SORTS.COMPETITION]: '경쟁률',
  [PROGRAM_SORTS.NON_SW_SHARE]: '비SW 비율',
  [PROGRAM_SORTS.COMPLETION]: '완주율',
  [PROGRAM_SORTS.OUTCOME]: '성과',
};

export const DEFAULT_SORT: SortState = {
  key: PROGRAM_SORTS.PARTICIPANTS,
  direction: 'desc',
};

function sortValue(
  row: StaffInsightsProgramRow,
  key: ProgramSort,
): number | null {
  switch (key) {
    case PROGRAM_SORTS.PARTICIPANTS:
      return row.participantCount;
    case PROGRAM_SORTS.COMPETITION:
      return row.competitionRatio;
    case PROGRAM_SORTS.NON_SW_SHARE:
      return row.participantCount === 0
        ? null
        : row.nonSwCount / row.participantCount;
    case PROGRAM_SORTS.COMPLETION:
      return row.completionRate;
    case PROGRAM_SORTS.OUTCOME:
      return row.contributionsPerParticipant;
  }
}

export function sortPrograms(
  rows: readonly StaffInsightsProgramRow[],
  sort: SortState,
): readonly StaffInsightsProgramRow[] {
  const sign = sort.direction === 'desc' ? -1 : 1;
  return [...rows].sort((left, right) => {
    const a = sortValue(left, sort.key);
    const b = sortValue(right, sort.key);
    if (a === null || b === null) {
      if (a !== b) return a === null ? 1 : -1;
    } else if (a !== b) {
      return (a - b) * sign;
    }
    return left.name.localeCompare(right.name, 'ko');
  });
}

function SortButton({
  sortKey,
  sort,
  onSort,
  asTitle = false,
}: {
  readonly sortKey: ProgramSort;
  readonly sort: SortState;
  readonly onSort: (key: ProgramSort) => void;
  readonly asTitle?: boolean;
}): ReactElement {
  const active = sort.key === sortKey;
  const Icon = active && sort.direction === 'asc' ? ChevronUp : ChevronDown;
  return (
    <Button
      type="button"
      variant="bare"
      size="content"
      aria-pressed={active}
      className={cn(
        'inline-flex scroll-ml-[calc(120px+2rem)] items-center gap-0.5 whitespace-nowrap hover:text-foreground sm:scroll-ml-[calc(220px+2rem)]',
        asTitle
          ? 'text-small font-semibold text-foreground'
          : active
            ? 'text-badge font-semibold text-foreground'
            : 'text-badge font-medium',
      )}
      onClick={() => onSort(sortKey)}
    >
      {SORT_LABELS[sortKey]}
      <Icon
        aria-hidden="true"
        className={active ? 'size-3.5' : 'size-3.5 opacity-40'}
      />
    </Button>
  );
}

export function ScorecardHead({
  title,
  sortKeys,
  sort,
  onSort,
  className,
}: {
  readonly title: string;
  readonly sortKeys: readonly ProgramSort[];
  readonly sort: SortState;
  readonly onSort: (key: ProgramSort) => void;
  readonly className?: string;
}): ReactElement {
  const active = sortKeys.includes(sort.key);
  return (
    <TableHead
      className={cn('px-4 py-3 align-top', className)}
      aria-sort={
        active
          ? sort.direction === 'asc'
            ? 'ascending'
            : 'descending'
          : undefined
      }
    >
      {sortKeys.length === 1 && SORT_LABELS[sortKeys[0]] === title ? (
        <SortButton sortKey={sortKeys[0]} sort={sort} onSort={onSort} asTitle />
      ) : (
        <>
          <span className="block text-small font-semibold text-foreground">
            {title}
          </span>
          <span className="mt-1 flex gap-3">
            {sortKeys.map((key) => (
              <SortButton key={key} sortKey={key} sort={sort} onSort={onSort} />
            ))}
          </span>
        </>
      )}
    </TableHead>
  );
}
