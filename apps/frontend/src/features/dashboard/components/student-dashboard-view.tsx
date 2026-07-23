import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FolderOpen,
  UserRound,
  UsersRound,
} from 'lucide-react';
import Link from 'next/link';

import { CardGrid, EmptyState, PageHeader, StatusBadge } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatDashboardDeadline } from '../deadline';
import type {
  DashboardItem,
  DashboardSubmissionStatus,
  StudentDashboard,
  StudentDashboardStatus,
} from '../types';

interface StudentDashboardViewProps {
  data: StudentDashboard | null;
  status: StudentDashboardStatus;
  now?: Date;
  onRetry: () => void;
}

const submissionLabels: Record<DashboardSubmissionStatus, string> = {
  NOT_SUBMITTED: '미제출',
  SUBMITTED: '검토 중',
  APPROVED: '승인 완료',
  CHANGES_REQUESTED: '수정 요청',
  REJECTED: '반려',
};

function DashboardCard({ item, now }: { item: DashboardItem; now: Date }) {
  const isPending = item.applicationStatus === 'SUBMITTED';
  const isRejected = item.applicationStatus === 'REJECTED';
  const isCompleted =
    item.applicationStatus === 'APPROVED' && item.nextMilestone === null;
  const ModeIcon =
    item.applicationMode === 'PERSONAL' ? UserRound : UsersRound;

  return (
    <Card className="min-h-72">
      <CardHeader>
        <CardTitle className="pr-20 text-lg">{item.programName}</CardTitle>
        <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
          <ModeIcon aria-hidden="true" className="size-4" />
          <span>
            {item.applicationMode === 'PERSONAL' ? '개인' : '팀'} ·{' '}
            {item.displayName}
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

      <CardContent className="flex flex-1 flex-col justify-center">
        {isPending ? (
          <div className="flex items-start gap-3 border-l-2 border-status-pending-fg/40 pl-4">
            <CalendarClock
              aria-hidden="true"
              className="mt-0.5 size-5 text-status-pending-fg"
            />
            <div>
              <p className="font-medium">신청 검토 후 일정이 열립니다.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                승인되면 다음 일정이 표시됩니다.
              </p>
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
                프로그램 상세에서 신청 상태를 확인해 주세요.
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
              <p className="font-medium">모든 마일스톤 완료</p>
              <p className="mt-1 text-sm text-muted-foreground">
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
              <span className="font-heading text-lg font-bold text-primary">
                {formatDashboardDeadline(item.nextMilestone.dueAt, now)}
              </span>
            </div>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <ClipboardList aria-hidden="true" className="size-4" />
              제출 상태:{' '}
              {submissionLabels[item.nextMilestone.submissionStatus]}
            </p>
          </div>
        ) : null}
      </CardContent>

      <CardFooter className="flex flex-wrap gap-2">
        <Button
          asChild
          size="sm"
          variant="outline"
          className="min-h-10 px-3 sm:min-h-8"
        >
          <Link href={item.detailUrl}>
            {isPending || isRejected ? '신청 상세' : '프로그램 상세'}
          </Link>
        </Button>
        {!isPending && !isRejected ? (
          <Button asChild size="sm" className="min-h-10 px-3 sm:min-h-8">
            <Link href={item.checklistUrl}>
              제출 체크리스트
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <CardGrid aria-busy="true" aria-label="대시보드를 불러오는 중">
      {[0, 1].map((item) => (
        <div
          key={item}
          className="min-h-72 animate-pulse rounded-lg bg-muted"
        />
      ))}
    </CardGrid>
  );
}

export function StudentDashboardView({
  data,
  status,
  now = new Date(),
  onRetry,
}: StudentDashboardViewProps) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-5 sm:p-8">
      <PageHeader
        title="내 대시보드"
        description="신청한 프로그램과 다음 제출 일정을 한눈에 확인합니다."
      />

      {status === 'loading' ? (
        <DashboardSkeleton />
      ) : status === 'error' ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>대시보드를 불러오지 못했습니다</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>잠시 후 다시 시도해 주세요.</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-10 px-3 sm:min-h-8"
              onClick={onRetry}
            >
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      ) : data && data.items.length > 0 ? (
        <CardGrid>
          {data.items.map((item) => (
            <DashboardCard key={item.applicationId} item={item} now={now} />
          ))}
        </CardGrid>
      ) : (
        <EmptyState
          icon={<FolderOpen className="size-8" />}
          title="아직 신청한 프로그램이 없습니다"
          description="참여할 프로그램을 둘러보고 첫 신청을 시작해 보세요."
          action={
            <Button asChild className="min-h-10 px-3">
              <Link href="/programs">프로그램 둘러보기</Link>
            </Button>
          }
        />
      )}
    </main>
  );
}
