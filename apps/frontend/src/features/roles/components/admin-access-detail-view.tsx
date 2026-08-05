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

import {
  parseAdminAccessConflictProjection,
  patchAdminAccess,
} from '../admin-access-api';
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
import {
  adminAccessGrantTargetRole,
  adminAccessMutationErrorMessage,
  adminAccessMutationSuccessMessage,
  applyAdminAccessConflictProjection,
  buildAdminAccessPatchRequest,
  type AdminAccessMutationAction,
} from '../admin-access-mutation-policy';
import { requireAdminAccessRevocation } from '../admin-access-revocation';
import { AdminAccessMutationActions } from './admin-access-mutation-actions';
import { AdminAccessMutationConfirmDialog } from './admin-access-mutation-confirm-dialog';
import { AdminAccessMutationRejectDialog } from './admin-access-mutation-reject-dialog';

type AdminAccessDetailState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'not-found' }
  | ({ readonly kind: 'ready' } & AdminAccessDetailData);

/**
 * 표준 페이지(`standalone`)와 Inspector/Sheet 오버레이(`overlay`) 중 어디에서
 * 렌더되는지 — 오버레이는 뷰포트가 넓어도 실제 렌더 폭이 좁은 고정 컨테이너
 * 안에 있으므로(PR04F `admin-access-overlay-variant.ts`의 `max-w-md`),
 * `DetailPanelLayout`의 2열 분할을 꺼서 보조 카드 제목이 크래시되는 문제를
 * 막는다. 기본값 `standalone`은 기존 동작과 완전히 동일하다.
 */
export type AdminAccessDetailLayoutContext = 'standalone' | 'overlay';

/** 상세/오버레이가 공유하는 접근 변경 다이얼로그·패널 제어권(PR04G). */
export interface AdminAccessDetailMutationController {
  readonly confirmAction: AdminAccessMutationAction | null;
  readonly processingAction: AdminAccessMutationAction | null;
  readonly rejectReason: string;
  readonly dialogError: string | null;
  readonly conflictNotice: string | null;
  readonly successMessage: string | null;
  readonly onRequestAction: (action: AdminAccessMutationAction) => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly onReasonChange: (reason: string) => void;
}

function mutationDialogCopy(
  action: Exclude<AdminAccessMutationAction, 'REJECT'>,
  detail: AdminAccessDetail,
): {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly destructive: boolean;
} {
  switch (action) {
    case 'APPROVE':
      return {
        title: '요청 승인',
        description: `${detail.githubLogin}님의 교직원 권한 요청을 승인하면 즉시 교직원 권한이 부여됩니다.`,
        confirmLabel: '승인 확정',
        destructive: false,
      };
    case 'GRANT': {
      const target = adminAccessGrantTargetRole(detail.role);
      return {
        title: '권한 직접 부여',
        description: `${detail.githubLogin}님에게 ${
          target ? ROLE_LABEL[target] : ''
        } 권한을 직접 부여합니다.`,
        confirmLabel: '부여 확정',
        destructive: false,
      };
    }
    case 'REVOKE': {
      const revocation = requireAdminAccessRevocation(detail.role);
      return {
        title: '권한 회수',
        description: revocation.dialogDescription(detail.githubLogin),
        confirmLabel: '회수 확정',
        destructive: true,
      };
    }
    case 'DEACTIVATE':
      return {
        title: '계정 비활성화',
        description: `${detail.githubLogin}님의 계정을 비활성화합니다. 비활성화되면 로그인할 수 없습니다.`,
        confirmLabel: '비활성화 확정',
        destructive: true,
      };
    case 'REACTIVATE':
      return {
        title: '계정 재활성화',
        description: `${detail.githubLogin}님의 계정을 다시 활성화합니다.`,
        confirmLabel: '재활성화 확정',
        destructive: false,
      };
    default:
      return assertNeverMutationAction(action);
  }
}

function assertNeverMutationAction(value: never): never {
  throw new TypeError(
    `Unsupported admin access mutation action: ${String(value)}`,
  );
}

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

function AdminAccessDetailContent({
  detail,
  history,
  mutation,
  layoutContext,
}: AdminAccessDetailData & {
  readonly mutation: AdminAccessDetailMutationController;
  readonly layoutContext: AdminAccessDetailLayoutContext;
}) {
  const eligibility = deriveAdminAccessEligibility(detail);
  const roleRequestsTruncated = isAdminAccessHistoryTruncated(
    history.roleRequests,
  );
  const loginHistoryTruncated = isAdminAccessHistoryTruncated(
    history.loginHistory,
  );
  const confirmDialog =
    mutation.confirmAction && mutation.confirmAction !== 'REJECT'
      ? {
          action: mutation.confirmAction,
          ...mutationDialogCopy(mutation.confirmAction, detail),
        }
      : null;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-5 sm:p-8">
      {mutation.conflictNotice ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>접근 상태가 변경되었습니다</AlertTitle>
          <AlertDescription>{mutation.conflictNotice}</AlertDescription>
        </Alert>
      ) : null}
      {mutation.successMessage ? (
        <div
          className="rounded-lg border border-border bg-background px-4 py-3 text-sm shadow-sm"
          role="status"
        >
          {mutation.successMessage}
        </div>
      ) : null}
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
        stacked={layoutContext === 'overlay'}
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
                  <dt className="text-muted-foreground">기본 정보 입력</dt>
                  <dd>{detail.profile.isComplete ? '완료' : '미완료'}</dd>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    이름·학번·학과 입력 여부이며, 요청 승인의 전제 조건입니다.
                  </p>
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
            <AdminAccessMutationActions
              detail={detail}
              processingAction={mutation.processingAction}
              onRequestAction={mutation.onRequestAction}
            />
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
      {mutation.confirmAction === 'REJECT' ? (
        <AdminAccessMutationRejectDialog
          githubLogin={detail.githubLogin}
          reason={mutation.rejectReason}
          isProcessing={mutation.processingAction === 'REJECT'}
          errorMessage={mutation.dialogError}
          onReasonChange={mutation.onReasonChange}
          onCancel={mutation.onCancel}
          onConfirm={mutation.onConfirm}
        />
      ) : null}
      {confirmDialog ? (
        <AdminAccessMutationConfirmDialog
          action={confirmDialog.action}
          title={confirmDialog.title}
          description={confirmDialog.description}
          confirmLabel={confirmDialog.confirmLabel}
          destructive={confirmDialog.destructive}
          isProcessing={mutation.processingAction === confirmDialog.action}
          errorMessage={mutation.dialogError}
          onCancel={mutation.onCancel}
          onConfirm={mutation.onConfirm}
        />
      ) : null}
    </main>
  );
}

export function AdminAccessDetailContentForState({
  state,
  onRetry,
  mutation,
  layoutContext = 'standalone',
}: {
  readonly state: AdminAccessDetailState;
  readonly onRetry: () => void;
  readonly mutation: AdminAccessDetailMutationController;
  readonly layoutContext?: AdminAccessDetailLayoutContext;
}) {
  if (state.kind === 'loading') return <LoadingState />;
  if (state.kind === 'error') return <ErrorState onRetry={onRetry} />;
  if (state.kind === 'not-found') return <NotFoundState />;
  return (
    <AdminAccessDetailContent
      detail={state.detail}
      history={state.history}
      mutation={mutation}
      layoutContext={layoutContext}
    />
  );
}

/**
 * `/admin/access/users/[userId]` 표준 상세 화면(PR04E) — 직접 진입·하드
 * 새로고침 모두에서 마운트 시 `loadAdminAccessDetail`로 프로필·요청/로그인
 * 이력을 가져온다. 목록(PR04C/04D)과 달리 URL 쿼리 상태가 없어
 * `useSearchParams()`를 쓰지 않으므로 Suspense 경계가 필요 없다. 오버레이
 * (PR04F)도 이 컴포넌트를 그대로 재사용하므로, 쓰기 UI(PR04G)도 여기 하나에서
 * 구현하면 두 진입점 모두에 자동으로 적용된다.
 *
 * 쓰기 흐름: 성공 시 `retry()`로 전체 재조회해 프로필·이력·CAS 필드를 모두
 * 최신화한다(기존 로딩 패턴 재사용). 409 CAS 충돌(`ROL_013`)은 재조회 대신
 * 에러 응답에 실린 authoritative projection으로 `state.detail`만 직접
 * 교체한다 — 이렇게 하면 그 자리에서 바로 "다른 관리자가 먼저 변경했다"는
 * 사실이 반영되고, 방금 실패한 쓰기가 새 상태에 대해 자동으로 재시도되는
 * 일이 없다(사용자가 다이얼로그를 다시 열어야만 재시도된다).
 */
export function AdminAccessDetailView({
  userId,
  layoutContext = 'standalone',
}: {
  readonly userId: string;
  readonly layoutContext?: AdminAccessDetailLayoutContext;
}) {
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

  const [confirmAction, setConfirmAction] =
    useState<AdminAccessMutationAction | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [processingAction, setProcessingAction] =
    useState<AdminAccessMutationAction | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);
  const [mutationSuccess, setMutationSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!mutationSuccess) return;
    const timeout = window.setTimeout(() => setMutationSuccess(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [mutationSuccess]);

  const requestAction = (action: AdminAccessMutationAction) => {
    setConfirmAction(action);
    setRejectReason('');
    setDialogError(null);
  };

  const cancelAction = () => {
    setConfirmAction(null);
    setRejectReason('');
    setDialogError(null);
  };

  const confirmMutation = async () => {
    if (state.kind !== 'ready' || !confirmAction) return;
    const action = confirmAction;
    const detailAtConfirm = state.detail;
    setProcessingAction(action);
    setDialogError(null);
    try {
      const body = buildAdminAccessPatchRequest(action, detailAtConfirm, {
        reason: rejectReason,
      });
      await patchAdminAccess(userId, body);
      setConfirmAction(null);
      setRejectReason('');
      setConflictNotice(null);
      setMutationSuccess(
        adminAccessMutationSuccessMessage(action, detailAtConfirm.githubLogin),
      );
      retry();
    } catch (error) {
      const projection = parseAdminAccessConflictProjection(error);
      if (projection) {
        setState({
          kind: 'ready',
          detail: applyAdminAccessConflictProjection(
            detailAtConfirm,
            projection,
          ),
          history: state.history,
        });
        setConfirmAction(null);
        setRejectReason('');
        setMutationSuccess(null);
        setConflictNotice(
          '다른 관리자가 먼저 변경했습니다. 최신 정보로 갱신했으니 다시 확인한 뒤 진행해 주세요.',
        );
        return;
      }
      setDialogError(adminAccessMutationErrorMessage(error));
    } finally {
      setProcessingAction(null);
    }
  };

  const mutation: AdminAccessDetailMutationController = {
    confirmAction,
    processingAction,
    rejectReason,
    dialogError,
    conflictNotice,
    successMessage: mutationSuccess,
    onRequestAction: requestAction,
    onCancel: cancelAction,
    onConfirm: () => void confirmMutation(),
    onReasonChange: setRejectReason,
  };

  return (
    <AdminAccessDetailContentForState
      state={state}
      onRetry={retry}
      mutation={mutation}
      layoutContext={layoutContext}
    />
  );
}
