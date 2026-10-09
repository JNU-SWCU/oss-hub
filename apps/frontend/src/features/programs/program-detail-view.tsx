'use client';

import { ProgramCover } from '@/components';
import { programCoverSource } from '@/components/program-cover-source';

import Link from 'next/link';
import { Pencil } from 'lucide-react';
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
import { MilestoneRow } from './components/milestone-row';
import { MilestoneDocumentSection } from './milestone-document-list';
import { milestoneSubmissionAccess } from './milestone-submission-access';
import type { MilestoneSubmissionAccess } from './milestone-submission-access';
import { programDetailMeta, isPastDue } from './program-detail-format';
import { ProgramFactBar, ProgramSummary } from './program-detail-summary';
import { programEditHref } from '@/lib/program-route';
import { programHref } from './program-paths';
import type { ProgramOverview } from './program-overview-api';
import { getProgramRecruitmentState } from './program-list';
import {
  PROGRAM_LIST_STATUS_LABELS,
  type ProgramDetail,
  type ProgramListItem,
  type ProgramMilestone,
  type ViewerRole,
} from './types';

export { ProgramFactBar };

const SIGNUP_ENTRY_HREF = '/signup';

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
    organizer: program.organizer,
    trackType: program.trackType,
    lifecycle: program.lifecycle,
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

function BlockedApplyEntry({ label }: { readonly label: string }) {
  const reasonId = useId();
  return (
    <div className="grid justify-items-start gap-2 sm:justify-items-end">
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
}: {
  readonly program: ProgramDetail;
}) {
  const role = program.viewer.role;

  const applyBlocked = isEnded(program);

  const applyEntryHref =
    role === null ? SIGNUP_ENTRY_HREF : programHref(program.id, '/apply');
  if (
    role === null ||
    (role === 'STUDENT' && program.viewer.applicationStatus === null)
  ) {
    return applyBlocked ? (
      <BlockedApplyEntry label="신청하기" />
    ) : (
      <Button asChild>
        <Link href={applyEntryHref}>신청하기</Link>
      </Button>
    );
  }
  return null;
}

function ProgramEditAction({ programId }: { readonly programId: string }) {
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={programEditHref(programId)}>
        <Pencil aria-hidden="true" />
        편집
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
    <MilestoneDocumentSection
      milestoneId={milestone.id}
      viewerRole={program.viewer.role}
      closed={isPastDue(milestone.dueAt)}
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
            program.viewer.role === 'STAFF' ||
            program.viewer.role === 'ADMIN' ? (
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
                program.viewer.role === 'ADMIN' ||
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
}: {
  readonly program: ProgramDetail;

  readonly overview?: ProgramOverview | null;

  readonly approvedStudentMilestones?: ReactNode;
}) {
  useActivityHashScroll();

  const badge = detailStatusBadge(program);
  const meta = programDetailMeta(program);

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 py-8">
      <div className="grid items-start gap-6 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <ProgramCover
          size="detail"
          title={program.name}
          src={programCoverSource(program.coverImageUrl)}
        />
        <PageHeader
          className="sm:flex-col"
          title={
            <span className="flex flex-wrap items-center gap-3">
              <span className="break-keep text-2xl sm:text-3xl">
                {program.name}
              </span>
              <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge>
            </span>
          }
          description={
            <>
              {`${meta.context} · `}
              <span className="whitespace-nowrap">{meta.period}</span>
            </>
          }
          actions={
            <>
              {program.viewer.role === 'STAFF' ||
              program.viewer.role === 'ADMIN' ? (
                <ProgramEditAction programId={program.id} />
              ) : null}
              <ProgramActions program={program} />
            </>
          }
        />
      </div>
      <ProgramSummary program={program} />
      <ProgramFactBar program={program} overview={overview} />
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
