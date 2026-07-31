'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, RotateCcw, UserRound } from 'lucide-react';

import {
  DetailPanelLayout,
  EmptyState,
  PageHeader,
  StatusBadge,
} from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import type {
  AdminAccessDetail,
  AdminAccessLoginHistoryItem,
  AdminAccessRole,
  AdminAccessRoleRequestHistoryItem,
} from '../admin-access-api';
import {
  AdminAccessDetailNotFoundError,
  deriveAdminAccessEligibility,
  isAdminAccessHistoryTruncated,
  loadAdminAccessDetail,
  type AdminAccessDetailData,
} from '../admin-access-detail-api';

type AdminAccessDetailState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'not-found' }
  | ({ readonly kind: 'ready' } & AdminAccessDetailData);

const ROLE_LABEL: Record<AdminAccessRole, string> = {
  STUDENT: '학생',
  STAFF: '교직원',
  ADMIN: '관리자',
};

const ACCOUNT_STATUS_LABEL: Record<AdminAccessDetail['accountStatus'], string> =
  {
    ACTIVE: '활성',
    DEACTIVATED: '비활성',
  };

const ROLE_REQUEST_STATUS: Record<
  AdminAccessRoleRequestHistoryItem['status'],
  {
    readonly label: string;
    readonly variant: 'pending' | 'approved' | 'rejected' | 'closed';
  }
> = {
  PENDING: { label: '대기', variant: 'pending' },
  APPROVED: { label: '승인', variant: 'approved' },
  REJECTED: { label: '반려', variant: 'rejected' },
  REVOKED: { label: '회수', variant: 'closed' },
};

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function LoadingState() {
  return (
    <main
      aria-label="관리자 접근 상세를 불러오는 중"
      className="mx-auto grid w-full max-w-6xl gap-6 p-5 sm:p-8"
    >
      <div className="h-24 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
      <div className="h-64 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
    </main>
  );
}

function ErrorState({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-5 sm:p-8">
      <Alert variant="destructive">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>관리자 접근 상세를 불러오지 못했습니다</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>잠시 후 다시 시도해 주세요.</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw aria-hidden="true" />
            다시 시도
          </Button>
        </AlertDescription>
      </Alert>
    </main>
  );
}

function NotFoundState() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-5 sm:p-8">
      <EmptyState
        icon={<UserRound className="size-8" />}
        title="사용자를 찾을 수 없습니다"
        description="존재하지 않는 사용자이거나 삭제된 계정입니다."
        action={
          <Button asChild variant="outline">
            <Link href="/admin/access">접근 목록으로</Link>
          </Button>
        }
      />
    </main>
  );
}

function RoleRequestHistorySection({
  items,
  truncated,
}: {
  readonly items: readonly AdminAccessRoleRequestHistoryItem[];
  readonly truncated: boolean;
}) {
  return (
    <section
      aria-labelledby="admin-access-role-request-history"
      className="grid gap-3"
    >
      <h2
        id="admin-access-role-request-history"
        className="font-heading text-lg font-semibold"
      >
        요청 이력
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          역할 요청 이력이 없습니다.
        </p>
      ) : (
        <ul className="grid gap-2">
          {items.map((request) => {
            const status = ROLE_REQUEST_STATUS[request.status];
            return (
              <li
                key={request.id}
                className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge variant={status.variant}>
                    {status.label}
                  </StatusBadge>
                  <span className="text-muted-foreground">
                    신청 {formatDateTime(request.createdAt)}
                  </span>
                </div>
                {request.decidedAt ? (
                  <span className="text-muted-foreground">
                    처리 {formatDateTime(request.decidedAt)}
                    {request.decidedBy ? ` · ${request.decidedBy}` : ''}
                  </span>
                ) : null}
                {request.rejectionReason ? (
                  <span>반려 사유: {request.rejectionReason}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {truncated ? (
        <p className="text-xs text-muted-foreground">
          최근 {items.length}건만 표시합니다.
        </p>
      ) : null}
    </section>
  );
}

function LoginHistorySection({
  items,
  truncated,
}: {
  readonly items: readonly AdminAccessLoginHistoryItem[];
  readonly truncated: boolean;
}) {
  return (
    <section
      aria-labelledby="admin-access-login-history"
      className="grid gap-3"
    >
      <h2
        id="admin-access-login-history"
        className="font-heading text-lg font-semibold"
      >
        로그인 이력
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">로그인 이력이 없습니다.</p>
      ) : (
        <ul className="grid gap-2">
          {items.map((event) => (
            <li
              key={event.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm"
            >
              <StatusBadge variant={event.success ? 'approved' : 'rejected'}>
                {event.event === 'LOGIN' ? '로그인' : '로그아웃'}
                {event.success ? '' : ' 실패'}
              </StatusBadge>
              <span className="text-muted-foreground">
                {formatDateTime(event.loginAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {truncated ? (
        <p className="text-xs text-muted-foreground">
          최근 {items.length}건만 표시합니다.
        </p>
      ) : null}
    </section>
  );
}

function AdminAccessDetailContent({ detail, history }: AdminAccessDetailData) {
  const eligibility = deriveAdminAccessEligibility(detail);
  const roleRequestsTruncated = isAdminAccessHistoryTruncated(
    history.roleRequests,
  );
  const loginHistoryTruncated = isAdminAccessHistoryTruncated(
    history.loginHistory,
  );

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-5 sm:p-8">
      <PageHeader
        title={detail.name ?? '이름 미등록'}
        description={`@${detail.githubLogin}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <StatusBadge
              variant={
                detail.role === 'ADMIN'
                  ? 'approved'
                  : detail.role === 'STAFF'
                    ? 'pending'
                    : 'closed'
              }
            >
              {detail.role ? ROLE_LABEL[detail.role] : '미지정'}
            </StatusBadge>
            <StatusBadge
              variant={
                detail.accountStatus === 'ACTIVE' ? 'approved' : 'closed'
              }
            >
              {ACCOUNT_STATUS_LABEL[detail.accountStatus]}
            </StatusBadge>
          </div>
        }
      />
      <DetailPanelLayout
        primary={
          <div className="grid gap-8">
            <section
              aria-labelledby="admin-access-profile"
              className="grid gap-3"
            >
              <h2
                id="admin-access-profile"
                className="font-heading text-lg font-semibold"
              >
                프로필
              </h2>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">이름</dt>
                  <dd>{detail.profile.name ?? '미등록'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">학번</dt>
                  <dd>{detail.profile.studentId ?? '미등록'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">학과</dt>
                  <dd>{detail.profile.department ?? '미등록'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">프로필 완료</dt>
                  <dd>{detail.profile.isComplete ? '완료' : '미완료'}</dd>
                </div>
              </dl>
            </section>
            <RoleRequestHistorySection
              items={history.roleRequests.items}
              truncated={roleRequestsTruncated}
            />
            <LoginHistorySection
              items={history.loginHistory.items}
              truncated={loginHistoryTruncated}
            />
          </div>
        }
        secondary={
          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle>자격 상태</CardTitle>
                <CardDescription>
                  역할 변경 가능 여부의 참고 정보입니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <StatusBadge
                  variant={eligibility.eligible ? 'approved' : 'rejected'}
                >
                  {eligibility.eligible ? '자격 있음' : '자격 없음'}
                </StatusBadge>
                {eligibility.blockedReason ? (
                  <p className="text-muted-foreground">
                    {eligibility.blockedReason}
                  </p>
                ) : null}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>마지막 로그인</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                {detail.lastLoginAt
                  ? formatDateTime(detail.lastLoginAt)
                  : '기록 없음'}
              </CardContent>
            </Card>
            {detail.pendingRequest ? (
              <Card>
                <CardHeader>
                  <CardTitle>대기 중인 요청</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {formatDateTime(detail.pendingRequest.createdAt)}에 신청됨
                </CardContent>
              </Card>
            ) : null}
          </div>
        }
      />
    </main>
  );
}

export function AdminAccessDetailContentForState({
  state,
  onRetry,
}: {
  readonly state: AdminAccessDetailState;
  readonly onRetry: () => void;
}) {
  if (state.kind === 'loading') return <LoadingState />;
  if (state.kind === 'error') return <ErrorState onRetry={onRetry} />;
  if (state.kind === 'not-found') return <NotFoundState />;
  return (
    <AdminAccessDetailContent detail={state.detail} history={state.history} />
  );
}

/**
 * `/admin/access/users/[userId]` 표준 상세 화면(PR04E) — 직접 진입·하드
 * 새로고침 모두에서 마운트 시 `loadAdminAccessDetail`로 프로필·요청/로그인
 * 이력을 가져온다. 목록(PR04C/04D)과 달리 URL 쿼리 상태가 없어
 * `useSearchParams()`를 쓰지 않으므로 Suspense 경계가 필요 없다. 오버레이/
 * 인터셉트 라우팅과 쓰기 UI는 다음 슬라이스(PR04F/04G)의 몫이다.
 */
export function AdminAccessDetailView({ userId }: { readonly userId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AdminAccessDetailState>({
    kind: 'loading',
  });
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setState({ kind: 'loading' });
    loadAdminAccessDetail(userId, controller.signal)
      .then((data) => {
        if (active) setState({ kind: 'ready', ...data });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState(
          error instanceof AdminAccessDetailNotFoundError
            ? { kind: 'not-found' }
            : { kind: 'error' },
        );
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt, userId]);

  return <AdminAccessDetailContentForState state={state} onRetry={retry} />;
}
