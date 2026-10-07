import { AlertCircle, CircleCheck, FolderOpen } from 'lucide-react';
import Link from 'next/link';

import { CardGrid, EmptyState, PageHeader } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import type {
  DashboardItem,
  ApplicationDecisionNotice,
  StudentDashboard,
  StudentDashboardStatus,
} from '../types';
import { StudentDashboardCard } from './student-dashboard-card';
import { ApplicationDecisionNotices } from './application-decision-notices';

function primaryActionApplicationId(
  items: readonly DashboardItem[],
): string | null {
  let soonest: { id: string; dueAt: number } | null = null;
  let fallback: string | null = null;

  for (const item of items) {
    if (
      item.applicationStatus === 'SUBMITTED' ||
      item.applicationStatus === 'REJECTED'
    )
      continue;
    fallback ??= item.applicationId;

    const milestone = item.nextMilestone;
    if (milestone === null) continue;
    const dueAt = Date.parse(milestone.dueAt);
    if (Number.isNaN(dueAt)) continue;
    if (soonest === null || dueAt < soonest.dueAt)
      soonest = { id: item.applicationId, dueAt };
  }

  return soonest?.id ?? fallback;
}

interface StudentDashboardViewProps {
  data: StudentDashboard | null;
  status: StudentDashboardStatus;
  now?: Date;

  showSignupCompleteNotice?: boolean;
  applicationDecisionNotices?: readonly ApplicationDecisionNotice[];
  onRetry: () => void;
}

function DashboardSkeleton() {
  return (
    <Skeleton label="대시보드를 불러오는 중">
      <CardGrid>
        <SkeletonBlock className="min-h-72 rounded-lg" />
        <SkeletonBlock className="min-h-72 rounded-lg" />
      </CardGrid>
    </Skeleton>
  );
}

export function StudentDashboardView({
  data,
  status,
  now = new Date(),
  showSignupCompleteNotice = false,
  applicationDecisionNotices = [],
  onRetry,
}: StudentDashboardViewProps) {
  const primaryApplicationId = data
    ? primaryActionApplicationId(data.items)
    : null;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-5 sm:p-8">
      <PageHeader
        className="break-keep [overflow-wrap:anywhere]"
        title="내 대시보드"
        description="신청한 프로그램과 다음 제출 일정을 확인합니다."
      />

      {showSignupCompleteNotice ? (
        <Alert>
          <CircleCheck aria-hidden="true" />
          <AlertTitle>가입이 완료되었습니다</AlertTitle>
          <AlertDescription>
            이제 프로그램을 신청하고 저장소를 연결할 수 있습니다.
          </AlertDescription>
        </Alert>
      ) : null}

      <ApplicationDecisionNotices notices={applicationDecisionNotices} />

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
            <StudentDashboardCard
              key={item.applicationId}
              item={item}
              now={now}
              isPrimaryAction={item.applicationId === primaryApplicationId}
            />
          ))}
        </CardGrid>
      ) : (
        <EmptyState
          className="break-keep [overflow-wrap:anywhere]"
          icon={<FolderOpen className="size-8" />}
          title="아직 신청한 프로그램이 없습니다"
          description="참여할 프로그램을 둘러보고 첫 신청을 시작해 보세요."
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
