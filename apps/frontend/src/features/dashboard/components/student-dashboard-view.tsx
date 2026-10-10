import { AlertCircle, CircleCheck, FolderOpen } from 'lucide-react';
import Link from 'next/link';

import { EmptyState, PageHeader } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import type {
  ApplicationDecisionNotice,
  StudentDashboard,
  StudentDashboardStatus,
} from '../types';
import { ApplicationDecisionNotices } from './application-decision-notices';
import { DashboardProgramSections } from './dashboard-program-sections';

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
    <Skeleton label="대시보드를 불러오는 중" className="grid gap-4">
      <SkeletonBlock className="h-8 w-40 rounded-md" />
      <SkeletonBlock className="h-56 rounded-card" />
      <SkeletonBlock className="h-56 rounded-card" />
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
        <DashboardProgramSections items={data.items} now={now} />
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
