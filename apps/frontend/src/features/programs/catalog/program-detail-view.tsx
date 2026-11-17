'use client';

import { ProgramCover } from '@/components';
import { programCoverSource } from '@/components/program/program-cover-source';

import Link from 'next/link';
import { Mail, Pencil } from 'lucide-react';
import { useEffect, useId, type ReactNode } from 'react';
import {
  EmptyState,
  FailureState,
  ListPanel,
  PageHeader,
  SectionHeading,
  StatusBadge,
} from '@/components';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import { ActivityGraphPanel } from './components/activity-graph-panel';
import { MilestoneRow } from '../documents/components/milestone-row';
import { RequirementSection } from '../documents/requirement-list';
import { milestoneSubmissionAccess } from '../documents/milestone-submission-access';
import type { MilestoneSubmissionAccess } from '../documents/milestone-submission-access';
import { programDetailContext, isPastDue } from './program-detail-format';
import { ProgramSummary } from './program-detail-summary';
import { programEditHref } from '@/lib/program-route';
import { programHref } from '../program-paths';
import type { ProgramOverview } from './program-overview-dto';
import { getProgramRecruitmentState } from './program-list';
import { PROGRAM_LIST_STATUS_LABELS } from './program-list-labels';
import { cn } from '@/lib/utils';
import type { ProgramDetail, ProgramListItem, ProgramMilestone } from './dto';
import type { ViewerRole } from '../program-contract';

export type RenderSignInApply = (applyHref: string) => ReactNode;

const ACTIVITY_SECTION_ID = 'activity';
const ACTIVITY_HASH = `#${ACTIVITY_SECTION_ID}`;

function milestoneNameId(milestoneId: string): string {
  return `milestone-${milestoneId}-name`;
}

const SCROLL_HANDOVER_EVENTS = [
  'wheel',
  'touchstart',
  'keydown',
  'pointerdown',
] as const;

function useActivityHashScroll(): void {
  useEffect(() => {
    if (window.location.hash !== ACTIVITY_HASH) return;

    const target = document.getElementById(ACTIVITY_SECTION_ID);
    if (target === null) return;

    const layoutRoot = target.closest('main') ?? target;
    const align = (): void => {
      target.scrollIntoView({ block: 'start', inline: 'nearest' });
    };
    const observer = new ResizeObserver(align);

    const release = (): void => {
      observer.disconnect();
      for (const event of SCROLL_HANDOVER_EVENTS) {
        window.removeEventListener(event, release);
      }
    };

    observer.observe(layoutRoot);
    for (const event of SCROLL_HANDOVER_EVENTS) {
      window.addEventListener(event, release, { passive: true });
    }
    align();

    return release;
  }, []);
}

function isRecruiting(period: ProgramDetail['applicationPeriod']): boolean {
  const now = Date.now();
  const startsAt = new Date(period.startsAt).getTime();
  const endsAt = new Date(period.endsAt).getTime();
  return startsAt <= now && now <= endsAt;
}

function asRecruitmentInput(program: ProgramDetail): ProgramListItem {
  return {
    id: program.id,
    name: program.name,
    organizers: program.organizers,
    trackType: program.trackType,
    applicationStartAt: program.applicationPeriod.startsAt,
    applicationEndAt: program.applicationPeriod.endsAt,
    endAt: program.operatingPeriod?.endsAt ?? null,
    description: program.description,
  };
}

function isEnded(program: ProgramDetail): boolean {
  return (
    getProgramRecruitmentState(asRecruitmentInput(program), new Date()) ===
    'ended'
  );
}

function detailStatusBadge(program: ProgramDetail): {
  readonly variant: 'recruiting' | 'closed';
  readonly label: string;
} {
  if (isEnded(program)) {
    return { variant: 'closed', label: PROGRAM_LIST_STATUS_LABELS.ended };
  }
  return isRecruiting(program.applicationPeriod)
    ? { variant: 'recruiting', label: PROGRAM_LIST_STATUS_LABELS.recruiting }
    : { variant: 'closed', label: '모집 마감' };
}

const APPLY_BLOCKED_REASON = '종료된 프로그램이라 신청을 받지 않습니다.';

const HEADER_ACTION_CLASS = 'flex-1 sm:flex-none';

function showsApplyEntry(viewer: ProgramDetail['viewer']): boolean {
  return (
    viewer.role === null ||
    (viewer.role === 'STUDENT' && viewer.applicationStatus === null)
  );
}

function BlockedApplyEntry({ label }: { readonly label: string }) {
  const reasonId = useId();
  return (
    <div className={cn('grid gap-2 sm:justify-items-end', HEADER_ACTION_CLASS)}>
      <Button type="button" disabled aria-describedby={reasonId}>
        {label}
      </Button>
      <p
        id={reasonId}
        className="text-small text-muted-foreground [word-break:keep-all]"
      >
        {APPLY_BLOCKED_REASON}
      </p>
    </div>
  );
}

export function ProgramDetailSkeleton() {
  return (
    <main
      className="mx-auto max-w-6xl px-4 py-8"
      aria-label="프로그램 상세 불러오는 중"
    >
      <Skeleton label="프로그램 상세 불러오는 중" className="grid gap-6">
        <SkeletonBlock className="h-24 rounded-xl" />
        <SkeletonBlock className="h-40 rounded-xl" />
        <SkeletonBlock className="h-56 rounded-xl" />
        <SkeletonBlock className="h-36 rounded-xl" />
      </Skeleton>
    </main>
  );
}

export function ProgramActions({
  program,
  renderSignInApply,
}: {
  readonly program: ProgramDetail;
  readonly renderSignInApply: RenderSignInApply;
}) {
  if (!showsApplyEntry(program.viewer)) return null;
  if (isEnded(program)) return <BlockedApplyEntry label="신청하기" />;

  const applyHref = programHref(program.id, '/apply');
  return (
    <Button asChild className={HEADER_ACTION_CLASS}>
      {program.viewer.role === null ? (
        renderSignInApply(applyHref)
      ) : (
        <Link href={applyHref}>신청하기</Link>
      )}
    </Button>
  );
}

function ProgramEditAction({ programId }: { readonly programId: string }) {
  return (
    <Button asChild variant="outline" size="sm" className={HEADER_ACTION_CLASS}>
      <Link href={programEditHref(programId)}>
        <Pencil aria-hidden="true" />
        편집
      </Link>
    </Button>
  );
}

function ProgramNotificationsAction({
  programId,
}: {
  readonly programId: string;
}) {
  return (
    <Button asChild variant="outline" size="sm" className={HEADER_ACTION_CLASS}>
      <Link href={programHref(programId, '/notifications')}>
        <Mail aria-hidden="true" />
        알림
      </Link>
    </Button>
  );
}

export function ProgramDetailFailureState({
  kind,
  onRetry,
}: {
  readonly kind: 'not-found' | 'failed';
  readonly onRetry: () => void;
}) {
  if (kind === 'not-found') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <EmptyState
          title="프로그램을 찾을 수 없습니다"
          description="삭제되었거나 공개되지 않은 프로그램입니다."
          action={
            <Button asChild variant="outline">
              <Link href="/programs">프로그램 목록으로</Link>
            </Button>
          }
        />
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <FailureState title="프로그램을 불러오지 못했습니다" onRetry={onRetry} />
    </main>
  );
}

function MilestoneGroup({
  program,
  milestone,
  position,
  submissionAccess,
  defaultOpen,
}: {
  readonly program: ProgramDetail;
  readonly milestone: ProgramDetail['milestones'][number];
  readonly position: number;

  readonly submissionAccess: MilestoneSubmissionAccess;

  readonly defaultOpen: boolean;
}) {
  const contentId = useId();
  const foldable = hasSubmissionDetail(milestone, program.viewer.role);
  const row = (
    <MilestoneRow
      programId={program.id}
      milestone={milestone}
      position={position}
      nameId={milestoneNameId(milestone.id)}
      disclosureContentId={foldable ? contentId : undefined}
      viewerRole={program.viewer.role}
      submissionAccess={submissionAccess}
    />
  );
  const detail = (
    <RequirementSection
      programId={program.id}
      milestoneId={milestone.id}
      viewerRole={program.viewer.role}
      closed={isPastDue(milestone.dueAt)}
      dueAt={milestone.dueAt}
      submissionAccess={submissionAccess}
    />
  );
  const groupProps = {
    role: 'listitem',
    'data-testid': 'milestone-group',
    'aria-labelledby': milestoneNameId(milestone.id),
    className: '[&+&]:border-t-2 [&+&]:border-border',
  } as const;

  if (!foldable) {
    return (
      <article {...groupProps}>
        {row}
        {detail}
      </article>
    );
  }
  return (
    <Collapsible defaultOpen={defaultOpen} asChild>
      <article {...groupProps}>
        {row}

        <CollapsibleContent
          id={contentId}
          className="data-[state=closed]:hidden"
          forceMount
        >
          {detail}
        </CollapsibleContent>
      </article>
    </Collapsible>
  );
}

function hasSubmissionDetail(
  milestone: ProgramMilestone,
  viewerRole: ViewerRole,
): boolean {
  if (viewerRole === null || viewerRole === 'PENDING') return false;
  return milestone.submissionItemCount > 0;
}

function initiallyOpenMilestoneId(program: ProgramDetail): string | null {
  const foldable = program.milestones.filter((milestone) =>
    hasSubmissionDetail(milestone, program.viewer.role),
  );
  if (foldable.length === 0) return null;
  const current = foldable.find((milestone) => !isPastDue(milestone.dueAt));
  return (current ?? foldable[foldable.length - 1]).id;
}

export function ProgramMilestones({
  program,
}: {
  readonly program: ProgramDetail;
}) {
  const submissionAccess = milestoneSubmissionAccess(program.viewer);
  const openMilestoneId = initiallyOpenMilestoneId(program);
  return (
    <section
      id="milestones"
      className="grid scroll-mt-24 gap-4"
      aria-labelledby="milestones-title"
    >
      <SectionHeading
        id="milestones-title"
        title="마일스톤"
        meta={`${program.milestones.length}개`}
      />
      {program.milestones.length === 0 ? (
        <EmptyState
          title="아직 등록된 마일스톤이 없습니다"
          action={
            program.viewer.role === 'STAFF' ? (
              <Button asChild variant="outline">
                <Link href={`${programEditHref(program.id)}#milestones`}>
                  마일스톤 설정
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ListPanel role="list">
          {program.milestones.map((milestone, index) => (
            <MilestoneGroup
              key={milestone.id}
              program={program}
              milestone={milestone}
              position={index + 1}
              submissionAccess={submissionAccess}

              defaultOpen={
                program.viewer.role === 'STAFF' ||
                milestone.id === openMilestoneId
              }
            />
          ))}
        </ListPanel>
      )}
    </section>
  );
}

export function ProgramDetailReadyState({
  program,
  overview = null,
  renderSignInApply,
}: {
  readonly program: ProgramDetail;
  readonly renderSignInApply: RenderSignInApply;
  readonly overview?: ProgramOverview | null;
}) {
  useActivityHashScroll();

  const badge = detailStatusBadge(program);
  const actions =
    program.viewer.role === 'STAFF' ? (
      <>
        <ProgramEditAction programId={program.id} />
        <ProgramNotificationsAction programId={program.id} />
      </>
    ) : showsApplyEntry(program.viewer) ? (
      <ProgramActions program={program} renderSignInApply={renderSignInApply} />
    ) : null;

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 py-8">
      <div className="grid items-start gap-6 md:grid-cols-[11.25rem_minmax(0,1fr)]">
        <div className="w-full max-w-45">
          <ProgramCover
            size="detail"
            title={program.name}
            src={programCoverSource(program.coverImageUrl)}
          />
        </div>
        <div className="grid min-w-0 content-start gap-6">
          <PageHeader
            titleClassName={cn(
              'text-2xl sm:text-3xl',
              'sm:py-[calc((var(--control-height)_-_1lh)_/_2)]',
            )}
            title={
              <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {program.name}
                </span>
                <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge>
              </span>
            }
            description={programDetailContext(program)}
            actions={
              actions === null ? undefined : (
                <div className="flex w-full gap-3 sm:w-auto">{actions}</div>
              )
            }
          />
          <ProgramSummary program={program} overview={overview} />
        </div>
      </div>
      <ProgramMilestones program={program} />
      <section id={ACTIVITY_SECTION_ID} aria-label="활동 상세">
        <ActivityGraphPanel
          programId={program.id}
          viewerRole={program.viewer.role}
        />
      </section>
    </main>
  );
}
