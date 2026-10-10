import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  FolderGit2,
  UsersRound,
} from 'lucide-react';
import Link from 'next/link';

import { ListRow, ProgramCover, StatusBadge } from '@/components';
import { programCoverSource } from '@/components/program-cover-source';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import {
  SUBMISSION_STATUS_BADGE,
  SUBMISSION_STATUS_LABELS,
} from '@/lib/status-vocabulary';
import { cn } from '@/lib/utils';
import {
  dashboardDeadlineDays,
  formatDashboardDeadline,
  formatDashboardDeadlineAbsolute,
} from '../deadline';
import { submissionActionLabel, type ActiveDashboardItem } from '../sections';
import type {
  DashboardFeedbackItem,
  DashboardItem,
  DashboardProgress,
  DashboardRepositoryProvisionStatus,
} from '../types';
import { ProgramFeedback } from './program-feedback';

type DashboardRepository = NonNullable<DashboardItem['repository']>;

const repositoryStatusLabels: Record<
  Exclude<DashboardRepositoryProvisionStatus, 'SUCCEEDED'>,
  string
> = {
  NOT_STARTED: '저장소 미생성',
  PENDING: '저장소 생성 대기',
  PROCESSING: '저장소 생성 중',
  FAILED_RETRYABLE: '저장소 생성 재시도 중',
  FAILED_FINAL: '저장소 확인 필요',
};

function repositoryStateLabel(repository: DashboardRepository): string {
  if (repository.provisionStatus !== 'SUCCEEDED') {
    return repositoryStatusLabels[repository.provisionStatus];
  }
  if (repository.invitationStatus === 'PENDING') return '초대 수락 대기';
  if (repository.invitationStatus === 'FAILED_RETRYABLE') {
    return '초대 재시도 중';
  }
  if (repository.invitationStatus === 'FAILED_FINAL') return '초대 확인 필요';
  return '준비 완료';
}

function RepositoryLine({
  repository,
  className,
}: {
  readonly repository: DashboardRepository;
  readonly className?: string;
}) {
  const name = repository.repositoryName;
  const url =
    repository.provisionStatus === 'SUCCEEDED' &&
    (repository.invitationStatus === 'SUCCEEDED' ||
      repository.invitationStatus === null)
      ? repository.githubUrl
      : null;

  return (
    <p
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-small text-muted-foreground',
        className,
      )}
    >
      <FolderGit2 aria-hidden="true" className="size-4 shrink-0" />
      {name === null ? null : (
        <>
          <span className="shrink-0">저장소</span>
          {url === null ? (
            <span className="min-w-0 truncate font-semibold text-foreground">
              {name}
            </span>
          ) : (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              aria-label={`${name} GitHub 저장소 (새 탭에서 열림)`}
              className="flex min-w-0 items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline"
            >
              <span className="truncate">{name}</span>
              <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
            </a>
          )}
        </>
      )}
      <span className="shrink-0">
        {name === null ? null : <span aria-hidden="true">· </span>}
        {repositoryStateLabel(repository)}
      </span>
    </p>
  );
}

function ProvisionFailureNotice({ className }: { readonly className: string }) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-3 border-l-2 border-destructive/40 pl-4',
        className,
      )}
    >
      <AlertCircle
        aria-hidden="true"
        className="mt-0.5 size-5 text-destructive"
      />
      <div>
        <p className="font-medium">저장소 생성에 실패했습니다.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          운영자에게 문의해 주세요.
        </p>
      </div>
    </div>
  );
}

function TeamName({ name }: { readonly name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <UsersRound aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 break-keep [overflow-wrap:anywhere]">
        {name}
      </span>
    </span>
  );
}

function TeamButton({ href }: { readonly href: string }) {
  return (
    <Button asChild size="sm" variant="outline">
      <Link href={href}>
        우리 팀
        <ArrowRight aria-hidden="true" />
      </Link>
    </Button>
  );
}

function deadlineTone(days: number): string {
  if (days < 0) return 'text-status-rejected-fg';
  return days <= 3 ? 'text-status-pending-fg' : 'text-primary';
}

function visibleProgress(
  progress: DashboardItem['progress'],
): DashboardProgress | null {
  return progress && progress.totalCount > 0 ? progress : null;
}

function MilestoneProgressBar({
  progress,
  className,
}: {
  readonly progress: DashboardProgress;
  readonly className: string;
}) {
  return (
    <progress
      aria-label={`마일스톤 진행 ${progress.approvedCount}/${progress.totalCount}`}
      className={cn(
        'h-2 appearance-none overflow-hidden rounded-full bg-primary/20',
        '[&::-webkit-progress-bar]:bg-transparent [&::-webkit-progress-value]:bg-primary',
        '[&::-moz-progress-bar]:bg-primary',
        className,
      )}
      max={progress.totalCount}
      value={progress.approvedCount}
    />
  );
}

export function ActiveProgramCard({
  item,
  now,
  primary,
  feedback,
}: {
  readonly item: ActiveDashboardItem;
  readonly now: Date;
  readonly primary: boolean;
  readonly feedback: readonly DashboardFeedbackItem[];
}) {
  const milestone = item.nextMilestone;
  const remainingItemCount = milestone.remainingItemCount ?? 0;
  const progress = visibleProgress(item.progress);

  return (
    <Card size="sm">
      <CardContent
        className={cn(
          'grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2',
          'sm:grid-cols-[11rem_minmax(0,1fr)_auto] sm:grid-rows-[auto_1fr] sm:gap-x-5',
        )}
      >
        <ProgramCover
          size="thumbnail"
          src={programCoverSource(item.coverImageUrl)}
          className="sm:row-span-2 sm:w-44"
        />
        <div className="grid min-w-0 content-start gap-1">
          <h3 className="font-heading text-body font-semibold break-keep [overflow-wrap:anywhere]">
            {item.programName}
          </h3>
          <p className="text-small text-muted-foreground">
            <TeamName name={item.teamName} />
          </p>
        </div>
        <p
          className={cn(
            'col-span-2 flex flex-wrap items-baseline gap-x-2',
            'sm:col-span-1 sm:col-start-3 sm:row-span-2 sm:row-start-1 sm:flex-col sm:items-end',
          )}
        >
          <span
            className={cn(
              'font-heading text-section leading-tight font-bold',
              deadlineTone(dashboardDeadlineDays(milestone.dueAt, now)),
            )}
          >
            {formatDashboardDeadline(milestone.dueAt, now)}
          </span>
          <span className="text-small text-muted-foreground">
            {formatDashboardDeadlineAbsolute(milestone.dueAt)}
          </span>
        </p>
        <div
          className={cn(
            'col-span-2 flex flex-col gap-2 self-start text-small',
            'sm:col-span-1 sm:col-start-2 sm:row-start-2',
          )}
        >
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-muted-foreground">다음</span>
            <span className="font-semibold break-keep [overflow-wrap:anywhere]">
              {milestone.name}
            </span>
            <StatusBadge
              variant={SUBMISSION_STATUS_BADGE[milestone.submissionStatus]}
            >
              {SUBMISSION_STATUS_LABELS[milestone.submissionStatus]}
            </StatusBadge>
            {remainingItemCount > 0 ? (
              <span className="font-semibold text-status-pending-fg">
                서류 {remainingItemCount}개 남음
              </span>
            ) : null}
          </p>
          {progress ? (
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2.5">
              <p className="text-muted-foreground">
                마일스톤 {progress.totalCount}개 중{' '}
                {SUBMISSION_STATUS_LABELS.APPROVED} {progress.approvedCount} ·{' '}
                {SUBMISSION_STATUS_LABELS.SUBMITTED} {progress.inReviewCount}
              </p>
              <MilestoneProgressBar
                progress={progress}
                className="w-full sm:order-first sm:w-55 sm:shrink-0"
              />
            </div>
          ) : null}
        </div>
        {item.repository?.provisionStatus === 'FAILED_FINAL' ? (
          <ProvisionFailureNotice className="col-span-full" />
        ) : null}
        <ProgramFeedback
          items={feedback}
          now={now}
          className="col-span-full mt-1 border-t border-border pt-3"
        />
      </CardContent>
      <CardFooter className="flex-wrap gap-x-4 gap-y-3">
        {item.repository ? (
          <RepositoryLine
            repository={item.repository}
            className="flex-1 basis-56"
          />
        ) : null}
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <TeamButton href={item.teamUrl} />
          <Button asChild size="sm" variant={primary ? 'default' : 'outline'}>
            <Link href={item.checklistUrl}>
              {submissionActionLabel(milestone, now)}
            </Link>
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

export function ProgramCompactRow({
  item,
  now,
  feedback,
}: {
  readonly item: DashboardItem;
  readonly now: Date;
  readonly feedback: readonly DashboardFeedbackItem[];
}) {
  const approved = item.applicationStatus === 'APPROVED';
  const rejected = item.applicationStatus === 'REJECTED';
  const progress = visibleProgress(item.progress);

  return (
    <ListRow role="listitem" className="gap-x-4 gap-y-3">
      <div className="flex min-w-0 flex-1 basis-full items-center gap-3 sm:basis-72">
        <ProgramCover
          size="thumbnail"
          src={programCoverSource(item.coverImageUrl)}
        />
        <div className="grid min-w-0 gap-1">
          <h3 className="font-heading text-body font-semibold break-keep [overflow-wrap:anywhere]">
            {item.programName}
          </h3>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-small text-muted-foreground">
            <TeamName name={item.teamName} />
            {approved && item.repository ? (
              <RepositoryLine repository={item.repository} />
            ) : null}
          </div>
        </div>
      </div>
      {approved ? (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-small">
          <p className="flex items-center gap-1.5 font-medium">
            <CheckCircle2
              aria-hidden="true"
              className="size-4 shrink-0 text-status-approved-fg"
            />
            예정된 제출 항목을 모두 마쳤습니다.
          </p>
          {progress ? (
            <span className="flex items-center gap-2.5 text-muted-foreground">
              <MilestoneProgressBar
                progress={progress}
                className="w-20 shrink-0"
              />
              {SUBMISSION_STATUS_LABELS.APPROVED} {progress.approvedCount}/
              {progress.totalCount}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="flex flex-wrap items-center gap-2 text-small text-muted-foreground">
          <StatusBadge variant={rejected ? 'rejected' : 'pending'}>
            {rejected ? '반려' : '신청'}
          </StatusBadge>
          {rejected
            ? '신청 상세에서 반려 사유를 확인해 주세요.'
            : '승인되면 다음 일정이 표시됩니다.'}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {approved ? (
          <>
            <TeamButton href={item.teamUrl} />
            <Button asChild size="sm" variant="outline">
              <Link href={item.checklistUrl}>제출 현황</Link>
            </Button>
          </>
        ) : (
          <>
            <Button asChild size="sm" variant="outline">
              <Link href={item.detailUrl}>신청 상세</Link>
            </Button>
            <TeamButton href={item.teamUrl} />
          </>
        )}
      </div>
      {approved && item.repository?.provisionStatus === 'FAILED_FINAL' ? (
        <ProvisionFailureNotice className="basis-full" />
      ) : null}
      <ProgramFeedback
        items={feedback}
        now={now}
        className="basis-full rounded-md bg-muted/50 p-3"
      />
    </ListRow>
  );
}
