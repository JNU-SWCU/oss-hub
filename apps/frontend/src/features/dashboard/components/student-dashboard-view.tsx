import { AlertCircle, ArrowRight, FolderOpen } from 'lucide-react';
import Link from 'next/link';

import { CardGrid, EmptyState, PageHeader } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type {
  DashboardItem,
  StudentDashboard,
  StudentDashboardStatus,
} from '../types';
import { StudentDashboardCard } from './student-dashboard-card';

/**
 * 채운 남색은 화면당 주 행동 하나에만 쓴다. 카드마다 "제출 체크리스트"를 채운
 * 버튼으로 두면 카드 수만큼 주 행동이 늘어 어디부터 볼지 시선이 갈라진다.
 * 그래서 마감이 가장 급한 카드 하나만 채운 버튼으로 남기고 나머지는 낮춘다.
 * 급한 순서는 다음 마일스톤 마감이 이른 쪽이며, 이미 지난 마감이 가장 급하다.
 * 승인 대기·반려 카드는 아직 제출할 것이 없어 후보에서 뺀다.
 */
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

  // 마감이 잡힌 카드가 하나도 없으면(전부 완료) 첫 참여 카드를 주 행동으로 둔다 —
  // 채운 버튼이 0개가 되면 이번엔 무엇부터 할지가 사라진다.
  return soonest?.id ?? fallback;
}

interface StudentDashboardViewProps {
  data: StudentDashboard | null;
  status: StudentDashboardStatus;
  now?: Date;
  onRetry: () => void;
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
  const primaryApplicationId = data
    ? primaryActionApplicationId(data.items)
    : null;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-5 sm:p-8">
      <PageHeader
        title="내 대시보드"
        description="신청한 프로그램과 다음 제출 일정을 확인합니다."
        actions={
          <Button asChild variant="outline" className="min-h-10 px-3">
            <Link href="/dashboard/activity">
              내 활동
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        }
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
