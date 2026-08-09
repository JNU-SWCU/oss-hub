import { AlertCircle, CircleCheck, FolderOpen } from 'lucide-react';
import Link from 'next/link';

import { CardGrid, EmptyState, PageHeader } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type {
  DashboardItem,
  ApplicationDecisionNotice,
  StudentDashboard,
  StudentDashboardStatus,
} from '../types';
import { StudentDashboardCard } from './student-dashboard-card';
import { ApplicationDecisionNotices } from './application-decision-notices';

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
  /**
   * 방금 가입을 마치고 이 화면에 처음 도착했는가. 판단은 화면(screen)이 하고
   * 여기서는 받은 값만 그린다 — 브라우저 저장소를 보는 쪽과 그리는 쪽을 섞지 않는다.
   */
  showSignupCompleteNotice?: boolean;
  applicationDecisionNotices?: readonly ApplicationDecisionNotice[];
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
        title="내 대시보드"
        description="신청한 프로그램과 다음 제출 일정을 확인합니다."
      />

      {/*
        가입 완료는 화면 제목이 아니라 이 일회성 안내가 말한다. 제목("내 대시보드")은
        3년 뒤 다시 들어온 사람도 보는 자리라 축하 문구를 놓을 수 없다. 이 안내는
        프로필 저장 직후의 첫 도착 한 번만 뜨고 그 뒤로는 사라진다 — 조건의 출처는
        `lib/signup-completion-notice.ts`.
      */}
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
