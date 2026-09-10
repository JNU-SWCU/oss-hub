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

import { StatusBadge } from '@/components';
import { Button } from '@/components/ui/button';
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
  DashboardSubmissionStatus,
} from '../types';

const submissionLabels: Record<DashboardSubmissionStatus, string> = {
  NOT_SUBMITTED: '미제출',
  SUBMITTED: '검토 중',
  APPROVED: '승인 완료',
  CHANGES_REQUESTED: '수정 요청',
  REJECTED: '반려',
};

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
  // 이 카드가 화면의 주 행동을 맡는지. 채운 남색은 화면당 하나뿐이라
  // 어느 카드가 그 하나인지는 목록 전체를 아는 부모가 정한다.
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
      <CardHeader>
        <CardTitle className="pr-20 text-lg">{item.programName}</CardTitle>
        {/*
          대시보드 항목은 전부 **지금 소속된 팀**이다(#1269). 1인 팀도 팀이라 아이콘과
          문구를 갈라 쓰지 않고, 사람 이름 대신 팀 이름 하나만 말한다 — 같은 자리에서
          어떤 카드는 팀을, 어떤 카드는 나를 가리키면 무엇의 목록인지 흐려진다.
        */}
        <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
          <UsersRound aria-hidden="true" className="size-4" />
          <span className="min-w-0 break-keep [overflow-wrap:anywhere]">
            {item.teamName}
          </span>
        </p>
        <CardAction>
          <StatusBadge
            variant={
              isPending ? 'pending' : isRejected ? 'rejected' : 'approved'
            }
          >
            {isPending
              ? '승인 대기'
              : isRejected
                ? '신청 반려'
                : isCompleted
                  ? '완료'
                  : '참여 중'}
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
                {/* 같은 대시보드의 반려 알림(`application-decision-notices.tsx`)과 같은
                    문장을 쓴다 — 둘 다 `/programs/{id}/apply`로 보내고 사유를 그리는
                    화면은 그곳뿐이다. 예전 문구("프로그램 상세에서 신청 상태를 확인해
                    주세요")는 사유도 신청 상태도 없는 화면을 가리켰다(#733). */}
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
                {submissionLabels[item.nextMilestone.submissionStatus]}
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

      {/*
        푸터는 이 카드에서 **다음에 할 일**만 남긴다. 프로그램 개요로 가는 버튼은 뺐다 —
        우리 팀 화면과 프로그램 좌측 패널이 이미 개요를 이고 있어, 카드에 하나 더 두면
        같은 목적지가 두 번 보이고 정작 팀·제출은 그 사이에 묻힌다.
        판정 전·반려 카드에서는 「신청 상세」가 사유와 신청 상태를 볼 수 있는 유일한
        길이라 언제나 첫 자리를 지킨다(#733).
      */}
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
        {/*
          우리 팀은 판정 상태와 무관하게 열린다 — 이 목록에 있다는 것 자체가 지금 그 팀의
          구성원이라는 뜻이고, 신청이 반려되어도 팀은 남는다(#1269).
        */}
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
