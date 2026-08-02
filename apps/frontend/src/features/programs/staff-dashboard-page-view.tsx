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
      className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8"
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
    <main className="mx-auto w-full max-w-3xl px-4 py-12">
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
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8">
      <PageHeader
        title="운영 대시보드"
        description="프로그램별 신청, 활동, 제출 현황입니다."
        // 이 화면에는 채운 강조가 하나도 없어 무엇부터 할지 시선이 잡히지 않았다.
        // 나머지(검색·필터·프로그램별 바로가기)는 이미 있는 것을 들여다보는 일이고,
        // 운영자가 이 화면에서 새로 시작하는 일은 프로그램을 여는 것 하나뿐이다.
        // 목록이 비었을 때의 안내도 같은 행동을 주 행동으로 고르고 있어, 목록이
        // 찬 상태에서도 같은 자리에 두어 화면 사이의 기대를 어긋나지 않게 한다.
        actions={
          <Button asChild>
            <Link href="/staff/programs/new">프로그램 만들기</Link>
          </Button>
        }
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
          // 같은 행동이 페이지 머리에 채운 버튼으로 이미 서 있다. 여기서도 채우면
          // 한 화면에 주 행동이 둘이 되므로, 손 닿는 자리는 남기되 강조는 낮춘다.
          action={
            <Button asChild variant="outline">
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
