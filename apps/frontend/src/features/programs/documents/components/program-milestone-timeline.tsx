import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useId, useState, type ReactNode } from 'react';
import { ListPanel, StatusBadge } from '@/components';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import {
  programDocumentsHref,
  programRequirementsHref,
} from '@/lib/program-route';
import {
  SUBMISSION_STATUS_BADGE,
  submissionStatusLabel,
} from '@/lib/status-vocabulary';
import { cn } from '@/lib/utils';
import type { ProgramMilestone } from '../../catalog/dto';
import {
  formatSeoulShortDateTime,
  isPastDue,
  milestoneCountdown,
  type MilestoneCountdownTone,
} from '../../catalog/program-detail-format';
import type { ViewerRole } from '../../program-contract';
import type { MilestoneSubmissionAccess } from '../milestone-submission-access';
import { milestoneRowSubmitGate } from '../milestone-submit-gate';
import { useRequirementsQuery } from '../queries';
import { RequirementSection } from '../requirement-list';
import { MilestoneNotice } from './milestone-notice';

type StepPhase = 'done' | 'current' | 'upcoming';

interface StepContext {
  readonly programId: string;
  readonly milestone: ProgramMilestone;
  readonly phase: StepPhase;
  readonly nameId: string;
}

interface StepCells {
  readonly state: ReactNode;
  readonly action: ReactNode;
  readonly breakdown?: string;
}

const UNCHANGED_NOTICE = '신청 승인 후 제출 상태를 확인할 수 있습니다.';
const ANONYMOUS_NOTICE = '가입 후 제출 상태를 확인할 수 있습니다.';
const NO_CELLS: StepCells = { state: null, action: null };

const LIST_CLASS = cn(
  'grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3',
  '@3xl:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] @3xl:gap-x-5',
);
const GROUP_CLASS = 'col-span-full grid grid-cols-subgrid items-start px-6';
const DIVIDER_CLASS =
  'col-span-full col-start-2 row-start-1 h-px self-start bg-border';
const MARK_CLASS =
  'col-start-1 row-span-3 row-start-1 flex flex-col items-center self-stretch';
const NAME_CELL_CLASS = 'col-start-2 row-start-1 min-w-0';
const NAME_BAND_CLASS = cn(
  'flex min-h-12 items-center gap-2 py-0.5 text-left text-body',
  '@3xl:min-h-14 @3xl:py-1.5',
);
const TRIGGER_CLASS = cn(
  'group w-full rounded-sm outline-none',
  'focus-visible:ring-3 focus-visible:ring-ring/50',
);
const CHEVRON_CLASS = cn(
  'size-4 shrink-0 text-muted-foreground transition-transform',
  'group-data-[state=open]:rotate-180 motion-reduce:transition-none',
);
const META_CLASS = cn(
  'col-span-2 col-start-2 row-start-2 flex flex-wrap items-center gap-x-3',
  'gap-y-1 pb-3 @3xl:contents',
);
const DEADLINE_CLASS = cn(
  'flex items-center text-small whitespace-nowrap tabular-nums',
  '@3xl:col-start-3 @3xl:row-start-1 @3xl:min-h-14',
);
const COUNTDOWN_CLASS = {
  ahead: 'font-bold text-primary',
  soon: 'font-bold text-status-pending-fg',
  closed: 'text-muted-foreground',
} as const satisfies Record<MilestoneCountdownTone, string>;
const STATE_CLASS = cn(
  'contents text-small @3xl:col-start-4 @3xl:row-start-1 @3xl:flex',
  '@3xl:min-h-14 @3xl:flex-wrap @3xl:content-center @3xl:items-center',
  '@3xl:gap-x-2 @3xl:gap-y-0.5',
);
const STAFF_COUNT_CLASS =
  'flex min-w-0 flex-auto items-center gap-2 @3xl:flex-none';
const STAFF_BAR_CLASS =
  'max-w-16 min-w-0 flex-1 bg-background @3xl:w-16 @3xl:flex-none';
const ACTION_CLASS = cn(
  'col-start-3 row-start-1 flex min-h-12 items-center justify-self-end',
  '@3xl:col-start-5 @3xl:min-h-14',
);
const DETAIL_CLASS = cn(
  'col-span-full col-start-2 row-start-3 grid min-w-0 gap-4 pb-4',
  'empty:hidden data-[state=closed]:hidden @3xl:row-start-2',
);

export function milestoneSubmissionNotice(
  milestones: readonly ProgramMilestone[],
  viewerRole: ViewerRole,
  submissionAccess: MilestoneSubmissionAccess,
): string | null {
  const submittable = milestones.filter(
    (milestone) => milestone.submissionItemCount > 0,
  );
  if (submittable.length === 0) return null;
  if (viewerRole === null) return ANONYMOUS_NOTICE;
  if (viewerRole !== 'STUDENT') return null;
  for (const milestone of submittable) {
    const gate = milestoneRowSubmitGate(milestone, submissionAccess);
    if (gate.kind === 'unchanged') return UNCHANGED_NOTICE;
    if (gate.kind === 'blocked') return gate.access.notice;
  }
  return null;
}

function hasSubmissionDetail(
  milestone: ProgramMilestone,
  viewerRole: ViewerRole,
): boolean {
  if (viewerRole === null || viewerRole === 'PENDING') return false;
  return milestone.submissionItemCount > 0;
}

function NoSubmission() {
  return <span className="text-muted-foreground">제출 없음</span>;
}

function staffCells({
  programId,
  milestone,
  phase,
  nameId,
}: StepContext): StepCells {
  if (milestone.submissionItemCount === 0) {
    return { state: <NoSubmission />, action: null };
  }
  const action = (
    <Button asChild variant="outline" size="sm">
      <Link
        href={programRequirementsHref(programId, milestone.id)}
        aria-describedby={nameId}
      >
        서류 수합
      </Link>
    </Button>
  );
  const summary = milestone.applicationSubmissionSummary;
  if (summary === null) return { state: null, action };
  if (summary.total === 0) return { state: <NoSubmission />, action };
  const submitted =
    summary.submitted +
    summary.approved +
    summary.changesRequested +
    summary.rejected;
  const countId = `${nameId}-count`;
  return {
    state: (
      <div className={STAFF_COUNT_CLASS}>
        <span id={countId} className="shrink-0 whitespace-nowrap">
          제출{' '}
          <b
            className={cn(
              'font-bold',
              phase === 'done' &&
                summary.notSubmitted > 0 &&
                'text-destructive-on-tint',
            )}
          >{`${submitted}/${summary.total}`}</b>
        </span>
        {phase === 'current' ? (
          <Progress
            value={submitted}
            max={summary.total}
            aria-labelledby={countId}
            className={STAFF_BAR_CLASS}
          />
        ) : null}
      </div>
    ),
    action,
    breakdown: `미제출 ${summary.notSubmitted} · 승인 ${summary.approved} · 보완 ${summary.changesRequested} · 반려 ${summary.rejected}`,
  };
}

function studentCells(
  { programId, milestone, phase, nameId }: StepContext,
  submissionAccess: MilestoneSubmissionAccess,
): StepCells {
  if (milestone.submissionItemCount === 0) {
    return { state: <NoSubmission />, action: null };
  }
  const gate = milestoneRowSubmitGate(milestone, submissionAccess);
  if (gate.kind === 'unchanged' || gate.kind === 'blocked') return NO_CELLS;
  if (gate.kind === 'unknown') {
    return {
      state: (
        <span className="break-keep text-muted-foreground">
          제출 상태 확인 불가
        </span>
      ),
      action: null,
    };
  }
  return {
    state: (
      <StatusBadge variant={SUBMISSION_STATUS_BADGE[gate.status]}>
        {submissionStatusLabel(gate.status, 'student')}
      </StatusBadge>
    ),
    action:
      gate.kind === 'open' ? (
        <Button
          asChild
          size="sm"
          variant={phase === 'current' ? 'default' : 'outline'}
        >
          <Link
            href={programDocumentsHref(programId, milestone.id)}
            aria-describedby={nameId}
          >
            {gate.resubmission ? '다시 제출' : '제출하기'}
          </Link>
        </Button>
      ) : null,
  };
}

function StepMark({
  position,
  phase,
  afterDone,
  first,
  last,
}: {
  readonly position: number;
  readonly phase: StepPhase;
  readonly afterDone: boolean;
  readonly first: boolean;
  readonly last: boolean;
}) {
  return (
    <span className={MARK_CLASS}>
      <span
        aria-hidden="true"
        className={cn(
          'h-3 w-0.5 @3xl:h-4',
          first ? null : afterDone ? 'bg-primary' : 'bg-border',
        )}
      />
      <span
        className={cn(
          'grid size-6 shrink-0 place-items-center rounded-full border-2',
          'text-xs font-semibold tabular-nums',
          phase === 'done' &&
            'border-primary bg-primary text-primary-foreground',
          phase === 'current' && 'border-primary bg-background text-primary',
          phase === 'upcoming' &&
            'border-muted-foreground/40 bg-background text-muted-foreground',
        )}
      >
        {position}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'w-0.5 flex-1',
          last ? null : phase === 'done' ? 'bg-primary' : 'bg-border',
        )}
      />
    </span>
  );
}

function MilestoneGroup({
  programId,
  milestone,
  position,
  phase,
  afterDone,
  last,
  viewerRole,
  submissionAccess,
}: Omit<StepContext, 'nameId'> & {
  readonly position: number;
  readonly afterDone: boolean;
  readonly last: boolean;
  readonly viewerRole: ViewerRole;
  readonly submissionAccess: MilestoneSubmissionAccess;
}) {
  const contentId = useId();
  const nameId = `milestone-${milestone.id}-name`;
  const context = { programId, milestone, phase, nameId };
  const cells =
    viewerRole === 'STAFF'
      ? staffCells(context)
      : viewerRole === 'STUDENT'
        ? studentCells(context, submissionAccess)
        : NO_CELLS;
  const current = phase === 'current';
  const [open, setOpen] = useState(current);
  const first = position === 1;
  const hasChecklist = hasSubmissionDetail(milestone, viewerRole);
  const foldable = hasChecklist || Boolean(milestone.description);
  const requirements = useRequirementsQuery(
    programId,
    milestone.id,
    viewerRole === 'STUDENT' && hasChecklist,
    'all',
  );
  const itemsCarryEntry =
    requirements.isPending || (requirements.data?.documents.length ?? 0) > 0;
  const action =
    viewerRole === 'STUDENT' && open && itemsCarryEntry ? null : cells.action;
  const countdown = milestoneCountdown(milestone.dDay, phase === 'done');
  const name = (
    <span
      id={nameId}
      className={cn(
        'min-w-0 break-keep [overflow-wrap:anywhere]',
        current ? 'font-bold text-status-recruiting-fg' : 'font-semibold',
      )}
    >
      {milestone.name}
    </span>
  );
  const group = (
    <article
      role="listitem"
      data-testid="milestone-group"
      aria-labelledby={nameId}
      aria-current={current ? 'step' : undefined}
      className={cn(GROUP_CLASS, current && 'bg-status-recruiting-bg')}
    >
      {first ? null : (
        <span
          aria-hidden="true"
          data-slot="milestone-divider"
          className={DIVIDER_CLASS}
        />
      )}
      <div data-testid="milestone-row" className="contents">
        <StepMark
          position={position}
          phase={phase}
          afterDone={afterDone}
          first={first}
          last={last}
        />
        <div className={NAME_CELL_CLASS}>
          {foldable ? (
            <CollapsibleTrigger
              aria-controls={contentId}
              className={cn(NAME_BAND_CLASS, TRIGGER_CLASS)}
            >
              {name}
              <ChevronDown aria-hidden className={CHEVRON_CLASS} />
            </CollapsibleTrigger>
          ) : (
            <p className={NAME_BAND_CLASS}>{name}</p>
          )}
        </div>
        <div className={META_CLASS}>
          <p className={DEADLINE_CLASS}>
            <span>
              <time dateTime={milestone.dueAt}>
                {formatSeoulShortDateTime(milestone.dueAt)}
              </time>
              <span className="text-muted-foreground"> · </span>
              <span className={COUNTDOWN_CLASS[countdown.tone]}>
                {countdown.label}
              </span>
            </span>
          </p>
          {cells.state === null ? null : (
            <div className={STATE_CLASS}>{cells.state}</div>
          )}
        </div>
        {action === null ? null : <div className={ACTION_CLASS}>{action}</div>}
      </div>
      {foldable ? (
        <CollapsibleContent
          id={contentId}
          data-testid="milestone-detail"
          className={DETAIL_CLASS}
          forceMount
        >
          {milestone.description ? (
            <MilestoneNotice
              description={milestone.description}
              milestoneNameId={nameId}
            />
          ) : null}
          {hasChecklist ? (
            <RequirementSection
              programId={programId}
              milestoneId={milestone.id}
              viewerRole={viewerRole}
              closed={phase === 'done'}
              dueAt={milestone.dueAt}
              submissionAccess={submissionAccess}
              summary={cells.breakdown}
              className="p-0"
            />
          ) : null}
        </CollapsibleContent>
      ) : null}
    </article>
  );
  return foldable ? (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      {group}
    </Collapsible>
  ) : (
    group
  );
}

export function ProgramMilestoneTimeline({
  programId,
  milestones,
  viewerRole,
  submissionAccess,
}: {
  readonly programId: string;
  readonly milestones: readonly ProgramMilestone[];
  readonly viewerRole: ViewerRole;
  readonly submissionAccess: MilestoneSubmissionAccess;
}) {
  const now = Date.now();
  const pastDue = milestones.map((milestone) =>
    isPastDue(milestone.dueAt, now),
  );
  const currentIndex = pastDue.indexOf(false);
  return (
    <ListPanel
      role="list"
      data-slot="milestone-timeline"
      className={LIST_CLASS}
    >
      {milestones.map((milestone, index) => (
        <MilestoneGroup
          key={milestone.id}
          programId={programId}
          milestone={milestone}
          position={index + 1}
          phase={
            pastDue[index]
              ? 'done'
              : index === currentIndex
                ? 'current'
                : 'upcoming'
          }
          afterDone={index > 0 && pastDue[index - 1]}
          last={index === milestones.length - 1}
          viewerRole={viewerRole}
          submissionAccess={submissionAccess}
        />
      ))}
    </ListPanel>
  );
}
