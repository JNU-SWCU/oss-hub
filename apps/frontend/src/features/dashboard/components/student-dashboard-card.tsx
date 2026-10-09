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
  DashboardItem,
  DashboardRepositoryProvisionStatus,
} from '../types';

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
        'flex min-w-0 items-center gap-1.5 text-small text-muted-foreground',
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
          <span aria-hidden="true">·</span>
        </>
      )}
      <span className="shrink-0">{repositoryStateLabel(repository)}</span>
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

export function ActiveProgramCard({
  item,
  now,
  primary,
}: {
  readonly item: ActiveDashboardItem;
  readonly now: Date;
  readonly primary: boolean;
}) {
  const milestone = item.nextMilestone;

  return (
    <Card>
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
        <p
          className={cn(
            'col-span-2 flex flex-wrap items-center gap-x-2 gap-y-1 self-start text-small',
            'sm:col-span-1 sm:col-start-2 sm:row-start-2',
          )}
        >
          <span className="font-semibold text-muted-foreground">다음</span>
          <span className="font-semibold break-keep [overflow-wrap:anywhere]">
            {milestone.name}
          </span>
          <StatusBadge
            variant={SUBMISSION_STATUS_BADGE[milestone.submissionStatus]}
          >
            {SUBMISSION_STATUS_LABELS[milestone.submissionStatus]}
          </StatusBadge>
        </p>
        {item.repository?.provisionStatus === 'FAILED_FINAL' ? (
          <ProvisionFailureNotice className="col-span-full" />
        ) : null}
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
              {submissionActionLabel(milestone.submissionStatus)}
            </Link>
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

export function ProgramCompactRow({ item }: { readonly item: DashboardItem }) {
  const approved = item.applicationStatus === 'APPROVED';
  const rejected = item.applicationStatus === 'REJECTED';

  return (
    <ListRow role="listitem" className="gap-x-4 gap-y-3">
      <div className="flex min-w-0 flex-1 basis-full items-center gap-3 sm:basis-72">
        <ProgramCover
          size="thumbnail"
          src={programCoverSource(item.coverImageUrl)}
        />
        <div className="grid min-w-0 gap-1">
          <h3 className="truncate font-heading text-body font-semibold">
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
        <p className="flex items-center gap-1.5 text-small font-medium">
          <CheckCircle2
            aria-hidden="true"
            className="size-4 shrink-0 text-status-approved-fg"
          />
          예정된 제출 항목을 모두 마쳤습니다.
        </p>
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
    </ListRow>
  );
}
