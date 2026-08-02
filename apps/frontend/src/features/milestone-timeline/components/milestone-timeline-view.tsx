import { AlertCircle, FileText } from 'lucide-react';
import Link from 'next/link';
import {
  EmptyState,
  ListPanel,
  ListRow,
  PageBody,
  PageHeader,
  SectionHeading,
  StatusBadge,
} from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
  CHANGES_REQUESTED: 'rejected',
  REJECTED: 'rejected',
  NOT_SUBMITTED: 'pending',
} as const satisfies Readonly<
  Record<TimelineStatus, 'pending' | 'approved' | 'rejected'>
>;

function LoadingState() {
  return (
    <PageBody aria-label="마일스톤 타임라인을 불러오는 중">
      <div className="h-24 animate-pulse rounded-card bg-muted motion-reduce:animate-none" />
      <div className="h-64 animate-pulse rounded-card bg-muted motion-reduce:animate-none" />
    </PageBody>
  );
}

function ErrorState({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <PageBody className="max-w-3xl">
      <Alert variant="destructive">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>마일스톤 타임라인을 불러오지 못했습니다</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-4">
          <span>잠시 후 다시 시도해 주세요.</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            다시 시도
          </Button>
        </AlertDescription>
      </Alert>
    </PageBody>
  );
}

/**
 * 타임라인 한 칸. 시안 v2에서 "순서대로 이어지는 같은 성격의 항목"은 카드를
 * 항목마다 두지 않고 목록 한 줄로 둔다(programs 상세의 마일스톤 목록과 같은 형태).
 * 순서는 카드 사이의 연결선 대신 줄 앞의 번호가 지고, 줄 높이는 76으로 고정된다.
 */
function TimelineRow({
  item,
  position,
  emphasized,
}: {
  readonly item: MilestoneTimelineItem;
  readonly position: number;
  /**
   * 채운 버튼은 화면에 하나뿐이다. 지금 손대야 할 첫 마일스톤만 채우고 나머지는
   * 테두리 버튼으로 둔다 — 전부 채우면 "무엇부터"가 사라진다.
   */
  readonly emphasized: boolean;
}) {
  return (
    <ListRow role="listitem">
      {/* 좁은 화면에서는 번호+제목이 한 줄을 다 쓰고 상태·행동이 아래로 내려간다 */}
      <div className="flex w-full min-w-0 items-start gap-4 sm:w-auto sm:flex-1">
        <span
          aria-hidden="true"
          className="grid size-tag shrink-0 place-items-center rounded-full bg-muted text-small font-semibold text-muted-foreground"
        >
          {position}
        </span>
        <div className="grid min-w-0 flex-1 gap-1">
          <p className="font-heading text-body font-semibold tracking-tight">
            {item.name}
          </p>
          {/* 제출 유형은 `submissionGuide`가 한국어로 그대로 옮긴 값이라
              (`SUBMISSION_GUIDES[submissionType]`) enum을 함께 보여주지 않는다 */}
          <p className="text-small text-muted-foreground">
            {item.dueLabel} ·{' '}
            <strong className="font-semibold text-foreground">
              {item.dDayLabel}
            </strong>
          </p>
          <p className="text-small leading-normal break-keep text-muted-foreground">
            {item.submissionGuide}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge variant={STATUS_VARIANTS[item.status]}>
          {item.statusLabel}
        </StatusBadge>
        {item.submitHref && item.submitLabel ? (
          <Button
            asChild
            size="sm"
            variant={emphasized ? 'default' : 'outline'}
          >
            <Link href={item.submitHref}>{item.submitLabel}</Link>
          </Button>
        ) : item.submitDisabledLabel ? (
          <Button type="button" variant="outline" size="sm" disabled>
            {item.submitDisabledLabel}
          </Button>
        ) : null}
      </div>
    </ListRow>
  );
}

export function MilestoneTimelineView({
  state,
  onRetry,
}: MilestoneTimelineViewProps) {
  if (state.kind === 'loading') return <LoadingState />;
  if (state.kind === 'error') return <ErrorState onRetry={onRetry} />;

  const { timeline } = state;
  // 채운 버튼 한 개 — 지금 제출할 수 있는 첫 마일스톤이 그 자리를 가진다.
  const emphasizedIndex = timeline.items.findIndex(
    (item) => item.submitHref !== null && item.submitLabel !== null,
  );
  return (
    <PageBody>
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
          className="grid gap-6"
        >
          <SectionHeading
            id="milestone-timeline-title"
            title="마일스톤"
            meta={`${timeline.items.length}개`}
          />
          <ListPanel role="list">
            {timeline.items.map((item, index) => (
              <TimelineRow
                key={item.milestoneId}
                item={item}
                position={index + 1}
                emphasized={index === emphasizedIndex}
              />
            ))}
          </ListPanel>
        </section>
      )}
    </PageBody>
  );
}
