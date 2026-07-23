import { AlertCircle, CalendarClock, FileText } from 'lucide-react';
import Link from 'next/link';
import { EmptyState, PageHeader, StatusBadge } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  MilestoneTimelineItem,
  MilestoneTimelineState,
  TimelineStatus,
} from '../types';

type MilestoneTimelineViewProps = {
  readonly state: MilestoneTimelineState;
  readonly onRetry: () => void;
};

const STATUS_VARIANTS = {
  SUBMITTED: 'pending',
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'pending',
  REJECTED: 'rejected',
  NOT_SUBMITTED: 'closed',
} as const satisfies Readonly<
  Record<TimelineStatus, 'pending' | 'approved' | 'rejected' | 'closed'>
>;

function LoadingState() {
  return (
    <main
      className="mx-auto grid w-full max-w-6xl gap-6 p-5 sm:p-8"
      aria-label="마일스톤 타임라인을 불러오는 중"
    >
      <div className="h-20 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-64 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
    </main>
  );
}

function ErrorState({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-5 sm:p-8">
      <Alert variant="destructive">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>마일스톤 타임라인을 불러오지 못했습니다</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>잠시 후 다시 시도해 주세요.</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            다시 시도
          </Button>
        </AlertDescription>
      </Alert>
    </main>
  );
}

function TimelineCard({
  item,
  position,
}: {
  readonly item: MilestoneTimelineItem;
  readonly position: number;
}) {
  return (
    <li className="relative flex min-w-0 flex-1 flex-row gap-3 md:flex-col">
      <div className="flex flex-col items-center md:flex-row">
        <span className="grid size-8 shrink-0 place-items-center rounded-full border border-primary/30 bg-background text-xs font-semibold text-primary">
          {position}
        </span>
        <span
          aria-hidden="true"
          className="h-full w-px bg-border md:h-px md:w-full"
        />
      </div>
      <Card className="min-w-0 flex-1">
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <CardTitle>{item.name}</CardTitle>
            <StatusBadge variant={STATUS_VARIANTS[item.status]}>
              {item.statusLabel}
            </StatusBadge>
          </div>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <CalendarClock aria-hidden="true" className="size-4" />
            <span>{item.dueLabel}</span>
            <strong className="font-semibold text-foreground">
              {item.dDayLabel}
            </strong>
          </p>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1 text-sm">
            <span className="font-medium text-foreground">
              {item.submissionType}
            </span>
            <span className="text-muted-foreground">
              {item.submissionGuide}
            </span>
          </div>
          {item.status === 'NOT_SUBMITTED' ? (
            <div>
              <Button asChild variant="outline" size="sm">
                <Link href={item.submitHref}>제출하기</Link>
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </li>
  );
}

export function MilestoneTimelineView({
  state,
  onRetry,
}: MilestoneTimelineViewProps) {
  if (state.kind === 'loading') return <LoadingState />;
  if (state.kind === 'error') return <ErrorState onRetry={onRetry} />;

  const { timeline } = state;
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-5 sm:p-8">
      <PageHeader
        title="마일스톤 타임라인"
        description={`${timeline.applicationMode === 'PERSONAL' ? '개인' : '팀'} 신청의 마감일과 제출 상태를 확인합니다.`}
      />

      {timeline.items.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-8" />}
          title="등록된 마일스톤이 없습니다"
          description="운영자가 마일스톤을 등록하면 이곳에 표시됩니다."
        />
      ) : (
        <section
          aria-labelledby="milestone-timeline-title"
          className="grid gap-4"
        >
          <div className="flex items-center justify-between gap-3">
            <h2
              id="milestone-timeline-title"
              className="font-heading text-xl font-semibold"
            >
              마일스톤 타임라인
            </h2>
            <span className="text-sm text-muted-foreground">
              {timeline.items.length}개
            </span>
          </div>
          <ol className="flex flex-col gap-4 md:flex-row md:items-stretch">
            {timeline.items.map((item, index) => (
              <TimelineCard
                key={item.milestoneId}
                item={item}
                position={index + 1}
              />
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
