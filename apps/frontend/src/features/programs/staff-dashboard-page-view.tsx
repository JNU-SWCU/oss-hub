import Link from 'next/link';
import type { ReactElement } from 'react';
import { EmptyState, PageHeader } from '@/components';
import { Button } from '@/components/ui/button';
import { ProgramListPagination } from './program-list-pagination';
import { StaffDashboardControls } from './staff-dashboard-controls';
import { StaffDashboardOverview } from './staff-dashboard-overview';
import type { StaffDashboardPageModel } from './staff-dashboard-page-model';
import type { ProgramListStatus } from './types';

interface ReadyActions {
  readonly onSearchChange: (value: string) => void;
  readonly onStatusChange: (value: ProgramListStatus) => void;
  readonly onSubmit: () => void;
  readonly onResetFilters: () => void;
  readonly onPageChange: (page: number) => void;
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
      readonly search: string;
      readonly status: ProgramListStatus;
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
    <main
      className="mx-auto grid max-w-6xl gap-6 px-4 py-8"
      aria-label="운영 대시보드를 불러오는 중"
    >
      <div className="h-20 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-12 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-64 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
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
    <main className="mx-auto max-w-3xl px-4 py-12">
      <EmptyState
        title="운영 대시보드를 불러오지 못했습니다"
        description={message}
        action={
          <Button type="button" onClick={onRetry}>
            다시 시도
          </Button>
        }
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
    <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8">
      <PageHeader
        title="운영 대시보드"
        description="프로그램 행에서 바로 편집하거나 운영 현황을 확인합니다."
      />
      <StaffDashboardControls
        search={state.search}
        status={state.status}
        onSearchChange={actions.onSearchChange}
        onStatusChange={actions.onStatusChange}
        onSubmit={actions.onSubmit}
      />
      {model.isEmptyCatalog ? (
        <EmptyState
          title="등록된 프로그램이 없습니다"
          description="프로그램을 만들면 운영 현황이 여기에 표시됩니다."
          action={
            <Button asChild>
              <Link href="/staff/programs/new">프로그램 만들기</Link>
            </Button>
          }
        />
      ) : model.isNoResults ? (
        <EmptyState
          title="검색 결과가 없습니다"
          description="검색어와 모집 상태 필터를 바꿔 보세요."
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
            totalPrograms={model.filteredPrograms.length}
            now={state.now}
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
