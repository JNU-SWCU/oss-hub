import Link from 'next/link';
import type { ReactElement } from 'react';
import { EmptyState, FailureState, PageHeader } from '@/components';
import { Button } from '@/components/ui/button';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import { programNewHref } from '@/lib/program-route';
import { ProgramListPagination } from '../catalog/program-list-pagination';
import {
  StaffDashboardOverview,
  type StaffDashboardOrder,
} from './staff-dashboard-overview';
import type { StaffDashboardPageModel } from './staff-dashboard-page-model';

interface ReadyActions {
  readonly onResetFilters: () => void;
  readonly onPageChange: (page: number) => void;
  readonly onSortChange: (order: StaffDashboardOrder) => void;
}

export type StaffDashboardPageViewState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'error';
      readonly message: string;
      readonly onRetry: () => void;
    }
  | {
      readonly kind: 'ready';
      readonly model: StaffDashboardPageModel;
      readonly order?: StaffDashboardOrder;
      readonly now: Date;
      readonly actions: ReadyActions;
    };

export function StaffDashboardPageView({
  state,
}: {
  readonly state: StaffDashboardPageViewState;
}): ReactElement {
  switch (state.kind) {
    case 'loading':
      return <StaffDashboardLoadingState />;
    case 'error':
      return (
        <StaffDashboardErrorState
          message={state.message}
          onRetry={state.onRetry}
        />
      );
    case 'ready':
      return <StaffDashboardReadyState state={state} />;
  }
}

function StaffDashboardLoadingState(): ReactElement {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <Skeleton label="운영 대시보드를 불러오는 중" className="grid gap-6">
        <SkeletonBlock className="h-20 rounded-xl" />
        <SkeletonBlock className="h-12 rounded-xl" />
        <SkeletonBlock className="h-64 rounded-xl" />
      </Skeleton>
    </main>
  );
}

function StaffDashboardErrorState({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}): ReactElement {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12">
      <FailureState
        title="운영 대시보드를 불러오지 못했습니다"
        description={message}
        onRetry={onRetry}
      />
    </main>
  );
}

function StaffDashboardReadyState({
  state,
}: {
  readonly state: Extract<StaffDashboardPageViewState, { kind: 'ready' }>;
}): ReactElement {
  const { model, actions } = state;
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8">
      <PageHeader
        className="break-keep [overflow-wrap:anywhere]"
        title="운영 대시보드"
      />
      {model.isEmptyCatalog ? (
        <EmptyState
          className="break-keep [overflow-wrap:anywhere]"
          title="등록된 프로그램이 없습니다"
          description="프로그램을 만들면 운영 현황이 여기에 표시됩니다."
          action={
            <Button asChild variant="outline">
              <Link href={programNewHref()}>프로그램 만들기</Link>
            </Button>
          }
        />
      ) : model.isNoResults ? (
        <EmptyState
          title="검색 결과가 없습니다"
          action={
            <Button
              type="button"
              variant="outline"
              onClick={actions.onResetFilters}
            >
              필터 초기화
            </Button>
          }
        />
      ) : (
        <>
          <StaffDashboardOverview
            programs={model.pageItems}
            totalPrograms={model.total}
            now={state.now}
            order={state.order}
            onSortChange={actions.onSortChange}
          />
          <ProgramListPagination
            page={model.safePage}
            totalPages={model.totalPages}
            onPageChange={actions.onPageChange}
          />
        </>
      )}
    </main>
  );
}
