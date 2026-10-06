import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  FolderGit2,
  UsersRound,
} from 'lucide-react';
import Link from 'next/link';

import { StatusBadge, ProgramCover } from '@/components';
import { programCoverSource } from '@/components/program-cover-source';
import { Button } from '@/components/ui/button';
import { SUBMISSION_STATUS_LABELS } from '@/lib/status-vocabulary';
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  formatDashboardDeadline,
  formatDashboardDeadlineAbsolute,
} from '../deadline';
import type {
  DashboardItem,
  DashboardRepositoryProvisionStatus,
} from '../types';

const repositoryStatusLabels: Record<
  DashboardRepositoryProvisionStatus,
  string
> = {
  NOT_STARTED: '저장소 미생성',
  PENDING: '저장소 생성 대기',
  PROCESSING: '저장소 생성 중',
  SUCCEEDED: '저장소 생성 완료',
  FAILED_RETRYABLE: '저장소 생성 재시도 중',
  FAILED_FINAL: '저장소 확인 필요',
};

function RepositorySummary({ item }: { item: DashboardItem }) {
  const repository = item.repository;
  if (!repository) return null;

  const invitationLabel =
    repository.provisionStatus === 'SUCCEEDED'
      ? repository.invitationStatus === 'PENDING'
        ? '초대 수락 대기'
        : repository.invitationStatus === 'FAILED_RETRYABLE'
          ? '초대 재시도 중'
          : repository.invitationStatus === 'FAILED_FINAL'
            ? '초대 확인 필요'
            : '준비 완료'
      : null;

  return (
    <div className="grid gap-1.5 border-t border-border pt-4">
      <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <FolderGit2 aria-hidden="true" className="size-4" />내 저장소
      </p>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <code className="min-w-0 break-all text-sm text-foreground">
          {repository.repositoryName ?? '생성 전'}
        </code>
        <span className="text-xs text-muted-foreground">
          {invitationLabel ??
            repositoryStatusLabels[repository.provisionStatus]}
        </span>
      </div>
    </div>
  );
}

export function StudentDashboardCard({
  item,
  now,

  isPrimaryAction = false,
}: {
  item: DashboardItem;
  now: Date;
  isPrimaryAction?: boolean;
}) {
  const isPending = item.applicationStatus === 'SUBMITTED';
  const isRejected = item.applicationStatus === 'REJECTED';
  const isDecided = !isPending && !isRejected;
  const isCompleted =
    item.applicationStatus === 'APPROVED' && item.nextMilestone === null;
  const repositoryUrl =
    item.repository?.provisionStatus === 'SUCCEEDED' &&
    (item.repository.invitationStatus === 'SUCCEEDED' ||
      item.repository.invitationStatus === null) &&
    item.repository.githubUrl !== null
      ? item.repository.githubUrl
      : null;
  const hasFinalProvisionFailure =
    item.repository?.provisionStatus === 'FAILED_FINAL';

  return (
    <Card className="min-h-72">
      <CardHeader className="has-data-[slot=card-action]:grid-cols-1">
        <div className="flex min-w-0 items-center gap-3">
          <ProgramCover
            size="thumbnail"
            src={programCoverSource(item.coverImageUrl)}
          />
          <CardTitle className="min-w-0 break-keep text-lg">
            {item.programName}
          </CardTitle>
        </div>

        <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
          <UsersRound aria-hidden="true" className="size-4" />
          <span className="min-w-0 break-keep [overflow-wrap:anywhere]">
            {item.teamName}
          </span>
        </p>

        <CardAction className="col-start-1 row-start-auto row-span-1 justify-self-start">
          <StatusBadge
            variant={
              isPending ? 'pending' : isRejected ? 'rejected' : 'approved'
            }
          >
            {isRejected ? '반려' : '신청'}
          </StatusBadge>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col justify-center gap-5">
        <div>
          {isPending ? (
            <div className="flex items-start gap-3 border-l-2 border-status-pending-fg/40 pl-4">
              <CalendarClock
                aria-hidden="true"
                className="mt-0.5 size-5 text-status-pending-fg"
              />
              <div>
                <p className="font-medium">승인되면 다음 일정이 표시됩니다.</p>
              </div>
            </div>
          ) : isRejected ? (
            <div className="flex items-start gap-3 border-l-2 border-destructive/40 pl-4">
              <AlertCircle
                aria-hidden="true"
                className="mt-0.5 size-5 text-destructive"
              />
              <div>
                <p className="font-medium">신청이 반려되었습니다.</p>

                <p className="mt-1 text-sm text-muted-foreground">
                  신청 상세에서 반려 사유를 확인해 주세요.
                </p>
              </div>
            </div>
          ) : isCompleted ? (
            <div className="flex items-start gap-3 border-l-2 border-status-approved-fg/40 pl-4">
              <CheckCircle2
                aria-hidden="true"
                className="mt-0.5 size-5 text-status-approved-fg"
              />
              <div>
                <p className="font-medium">
                  예정된 제출 항목을 모두 마쳤습니다.
                </p>
              </div>
            </div>
          ) : item.nextMilestone ? (
            <div className="grid gap-3">
              <p className="text-xs font-medium text-muted-foreground">
                다음 마일스톤
              </p>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-heading text-base font-semibold">
                  {item.nextMilestone.name}
                </p>
                <span className="flex flex-col items-end gap-0.5">
                  <span className="font-heading text-lg font-bold text-primary">
                    {formatDashboardDeadline(item.nextMilestone.dueAt, now)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDashboardDeadlineAbsolute(item.nextMilestone.dueAt)}
                  </span>
                </span>
              </div>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <ClipboardList aria-hidden="true" className="size-4" />
                제출 상태:{' '}
                {SUBMISSION_STATUS_LABELS[item.nextMilestone.submissionStatus]}
              </p>
            </div>
          ) : null}
        </div>
        {hasFinalProvisionFailure ? (
          <div
            role="alert"
            className="flex items-start gap-3 border-l-2 border-destructive/40 pl-4"
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
        ) : null}
        {isDecided ? <RepositorySummary item={item} /> : null}
      </CardContent>

      <CardFooter className="flex flex-wrap gap-2">
        {!isDecided ? (
          <Button
            asChild
            size="sm"
            variant="outline"
            className="min-h-10 px-3 sm:min-h-8"
          >
            <Link href={item.detailUrl}>신청 상세</Link>
          </Button>
        ) : null}

        <Button
          asChild
          size="sm"
          variant={isDecided && isPrimaryAction ? 'default' : 'outline'}
          className="min-h-10 px-3 sm:min-h-8"
        >
          <Link href={item.teamUrl}>
            우리 팀{isDecided ? <ArrowRight aria-hidden="true" /> : null}
          </Link>
        </Button>
        {isDecided ? (
          <>
            <Button
              asChild
              size="sm"
              variant="outline"
              className="min-h-10 px-3 sm:min-h-8"
            >
              <Link href={item.checklistUrl}>제출 현황</Link>
            </Button>
            {repositoryUrl ? (
              <Button
                asChild
                size="sm"
                variant="outline"
                className="min-h-10 px-3 sm:min-h-8"
              >
                <a href={repositoryUrl} target="_blank" rel="noreferrer">
                  GitHub에서 열기
                  <ExternalLink aria-hidden="true" />
                </a>
              </Button>
            ) : null}
          </>
        ) : null}
      </CardFooter>
    </Card>
  );
}
