import { AlertCircle, ArrowRight, FolderOpen } from 'lucide-react';
import Link from 'next/link';

import { CardGrid, EmptyState, PageHeader } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { StudentDashboard, StudentDashboardStatus } from '../types';
import { StudentDashboardCard } from './student-dashboard-card';

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
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-5 sm:p-8">
      <PageHeader
        title="내 대시보드"
        description="신청한 프로그램과 다음 제출 일정을 확인합니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" className="min-h-10 px-3">
              <Link href="/dashboard/activity">
                내 활동
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
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
