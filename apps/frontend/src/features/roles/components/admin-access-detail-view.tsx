'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ExternalLink, RotateCcw, UserRound } from 'lucide-react';

import {
  DetailPanelLayout,
  EmptyState,
  PageHeader,
  StatusBadge,
} from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

import {
  fetchAdminAccessHistory,
  parseAdminAccessConflictProjection,
  patchAdminAccess,
} from '../admin-access-api';
import type {
  AdminAccessDetail,
  AdminAccessLoginHistoryItem,
  AdminAccessRoleRequestHistoryItem,
} from '../admin-access-api';
import {
  ADMIN_ACCESS_DETAIL_HISTORY_LIMIT,
  AdminAccessDetailNotFoundError,
  adminAccessHistoryPageCount,
  formatAdminAccessDateTime,
  loadAdminAccessDetail,
  type AdminAccessDetailData,
} from '../admin-access-detail-api';
import {
  ACCOUNT_STATUS_LABEL,
  ROLE_LABEL,
  adminAccessMutationErrorMessage,
  adminAccessMutationSuccessMessage,
  applyAdminAccessConflictProjection,
  buildAdminAccessPatchRequest,
  roleForAction,
  type AdminAccessMutationAction,
  type AdminAccessSetRoleAction,
} from '../admin-access-mutation-policy';
import {
  adminAccessRoleChangeDialogDescription,
  isAdminAccessRoleDowngrade,
} from '../admin-access-revocation';
import {
  AdminAccessMutationActions,
  AdminAccessPendingRequestCard,
} from './admin-access-mutation-actions';
import { AdminAccessMutationConfirmDialog } from './admin-access-mutation-confirm-dialog';
import { AdminAccessMutationRejectDialog } from './admin-access-mutation-reject-dialog';
import { AdminAccessProfileSection } from './admin-access-profile-section';

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

/**
 * 상세 본문을 감싸는 바깥 요소.
 *
 * `standalone`은 라우트가 통째로 이 화면이라 `<main>` landmark가 맞다. 반면
 * `overlay`는 Radix `Dialog.Content`(`role="dialog" aria-modal="true"`) **안에**
 * 그려지므로 같은 `<main>`을 쓰면 landmark가 다이얼로그 안에 갇힌다 — 그러면
 * 문서에 최상위 `main`이 하나도 남지 않고(모달이 열린 동안 목록 쪽은
 * `aria-hidden` 처리된다), landmark 검사에도 걸린다. 오버레이에서는 landmark가
 * 아닌 `<div>`로 낮춘다.
 */
function detailRootTag(
  layoutContext: AdminAccessDetailLayoutContext,
): 'main' | 'div' {
  return layoutContext === 'overlay' ? 'div' : 'main';
}

export type DetailHeadingTag = 'h2' | 'h3';

/**
 * 상세 본문의 제목 레벨 한 쌍.
 *
 * `standalone`은 페이지의 최상위 제목이 사용자 이름(`h1`)이고 그 아래 섹션이
 * `h2`다. `overlay`는 Radix `Dialog.Title`이 이미 `h2`를 차지하므로 한 단계씩
 * 내려 `h2`/`h3`로 쓴다 — 그대로 두면 다이얼로그 안에서 `h2` 다음에 `h1`이
 * 나와 제목 레벨이 역행한다.
 */
function detailHeadingTags(layoutContext: AdminAccessDetailLayoutContext): {
  readonly title: 'h1' | 'h2';
  readonly section: DetailHeadingTag;
} {
  return layoutContext === 'overlay'
    ? { title: 'h2', section: 'h3' }
    : { title: 'h1', section: 'h2' };
}

/**
 * 상세 본문 바깥 요소의 공통 클래스.
 *
 * `standalone`은 페이지 폭 전체를 쓰므로 가운데 정렬 + 뷰포트 계단 여백
 * (`p-5 sm:p-8`)이 맞다. `overlay`는 **뷰포트가 아무리 넓어도** 렌더 폭이
 * `max-w-md`(448px)로 고정된 패널 안이라, 뷰포트 기준 `sm:` 계단을 그대로 쓰면
 * 768px·1280px에서 다이얼로그 자체 여백(`p-5`/`p-6`)에 32px이 겹쳐 얹혀
 * 실제 내용 폭이 336px까지 줄어든다. 오버레이는 여백을 다이얼로그에 맡기고
 * 최대 폭 제한도 걸지 않는다.
 */
function detailRootClassName(
  layoutContext: AdminAccessDetailLayoutContext,
  standaloneClassName: string,
): string {
  return layoutContext === 'overlay'
    ? 'flex w-full min-w-0 flex-col gap-6'
    : standaloneClassName;
}

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

function isSetRoleAction(
  action: AdminAccessMutationAction,
): action is AdminAccessSetRoleAction {
  return (
    action === 'SET_ROLE_STUDENT' ||
    action === 'SET_ROLE_STAFF' ||
    action === 'SET_ROLE_ADMIN'
  );
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
  if (action === 'APPROVE') {
    return {
      title: '요청 승인',
      description: `${detail.githubLogin}님의 교직원 권한 요청을 승인하면 즉시 교직원 권한이 부여됩니다.`,
      confirmLabel: '승인 확정',
      destructive: false,
    };
  }
  if (isSetRoleAction(action)) {
    const target = roleForAction(action);
    const destructive = isAdminAccessRoleDowngrade(detail.role, target);
    // #765: 강등도 승격과 같은 「권한 변경」/「변경 확정」 문구를 쓴다 — 직접
    // 강등은 REVOKED 이력을 남기지 않아 "회수"를 자칭할 근거가 없다
    // (admin-access-revocation.ts 참고). 파괴적 스타일(destructive)만 유지해
    // 되돌리기 어려운 변경이라는 신호는 남긴다.
    return {
      title: '권한 변경',
      description: adminAccessRoleChangeDialogDescription(
        detail.role,
        target,
        detail.githubLogin,
      ),
      confirmLabel: '변경 확정',
      destructive,
    };
  }
  if (action === 'SET_STATUS_ACTIVE') {
    return {
      title: '계정 재활성화',
      description: `${detail.githubLogin}님의 계정을 다시 활성화합니다.`,
      confirmLabel: '재활성화 확정',
      destructive: false,
    };
  }
  if (action === 'SET_STATUS_DEACTIVATED') {
    return {
      title: '계정 비활성화',
      description: `${detail.githubLogin}님의 계정을 비활성화합니다. 비활성화되면 로그인할 수 없습니다.`,
      confirmLabel: '비활성화 확정',
      destructive: true,
    };
  }
  return assertNeverMutationAction(action);
}

function assertNeverMutationAction(value: never): never {
  throw new TypeError(
    `Unsupported admin access mutation action: ${String(value)}`,
  );
}

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

function LoadingState({
  layoutContext,
}: {
  readonly layoutContext: AdminAccessDetailLayoutContext;
}) {
  const Root = detailRootTag(layoutContext);
  return (
    <Root
      // 이름은 landmark일 때만 붙인다 — 오버레이의 `<div>`는 role이 없어
      // 접근 가능한 이름을 가질 자리가 아니고, 다이얼로그 제목이 그 역할을 한다.
      aria-label={
        layoutContext === 'overlay'
          ? undefined
          : '관리자 접근 상세를 불러오는 중'
      }
      className={detailRootClassName(
        layoutContext,
        'mx-auto grid w-full max-w-6xl gap-6 p-5 sm:p-8',
      )}
    >
      <div className="h-24 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
      <div className="h-64 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
    </Root>
  );
}

function ErrorState({
  onRetry,
  layoutContext,
}: {
  readonly onRetry: () => void;
  readonly layoutContext: AdminAccessDetailLayoutContext;
}) {
  const Root = detailRootTag(layoutContext);
  return (
    <Root
      className={detailRootClassName(
        layoutContext,
        'mx-auto grid w-full max-w-3xl gap-6 p-5 sm:p-8',
      )}
    >
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
    </Root>
  );
}

function NotFoundState({
  layoutContext,
}: {
  readonly layoutContext: AdminAccessDetailLayoutContext;
}) {
  const Root = detailRootTag(layoutContext);
  return (
    <Root
      className={detailRootClassName(
        layoutContext,
        'mx-auto flex w-full max-w-3xl flex-col gap-6 p-5 sm:p-8',
      )}
    >
      <EmptyState
        icon={<UserRound className="size-8" />}
        title="사용자를 찾을 수 없습니다"
        description="존재하지 않는 사용자이거나 삭제된 계정입니다."
        action={
          <Button asChild variant="outline">
            <Link href="/admin/access">사용자 목록으로</Link>
          </Button>
        }
      />
    </Root>
  );
}

/** 목록 화면(`admin-access-view.tsx`)의 "이전/다음 + n / m 페이지" 패턴을 이력 섹션에 맞춰 재사용한다. */
function HistoryPaginationControls({
  page,
  totalPages,
  isLoading,
  onPageChange,
}: {
  readonly page: number;
  readonly totalPages: number;
  readonly isLoading: boolean;
  readonly onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-3 text-sm">
      <span>
        {page} / {totalPages} 페이지
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={page <= 1 || isLoading}
        onClick={() => onPageChange(page - 1)}
      >
        이전
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={page >= totalPages || isLoading}
        onClick={() => onPageChange(page + 1)}
      >
        다음
      </Button>
    </div>
  );
}

function RoleRequestHistorySection({
  items,
  page,
  totalPages,
  isLoading,
  onPageChange,
  headingTag: HeadingTag,
}: {
  readonly items: readonly AdminAccessRoleRequestHistoryItem[];
  readonly page: number;
  readonly totalPages: number;
  readonly isLoading: boolean;
  readonly onPageChange: (page: number) => void;
  readonly headingTag: DetailHeadingTag;
}) {
  return (
    <section
      aria-labelledby="admin-access-role-request-history"
      className="grid gap-3"
    >
      <HeadingTag
        id="admin-access-role-request-history"
        className="font-heading text-lg font-semibold"
      >
        요청 이력
      </HeadingTag>
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
                    신청 {formatAdminAccessDateTime(request.createdAt)}
                  </span>
                </div>
                {request.decidedAt ? (
                  <span className="text-muted-foreground">
                    처리 {formatAdminAccessDateTime(request.decidedAt)}
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
      <HistoryPaginationControls
        page={page}
        totalPages={totalPages}
        isLoading={isLoading}
        onPageChange={onPageChange}
      />
    </section>
  );
}

function LoginHistorySection({
  items,
  page,
  totalPages,
  isLoading,
  onPageChange,
  lastLoginAt,
  headingTag: HeadingTag,
}: {
  readonly items: readonly AdminAccessLoginHistoryItem[];
  readonly page: number;
  readonly totalPages: number;
  readonly isLoading: boolean;
  readonly onPageChange: (page: number) => void;
  readonly lastLoginAt: string | null;
  readonly headingTag: DetailHeadingTag;
}) {
  return (
    <section
      aria-labelledby="admin-access-login-history"
      className="grid gap-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <HeadingTag
          id="admin-access-login-history"
          className="font-heading text-lg font-semibold"
        >
          로그인 이력
        </HeadingTag>
        <span className="text-sm text-muted-foreground">
          마지막 로그인{' '}
          {lastLoginAt ? formatAdminAccessDateTime(lastLoginAt) : '기록 없음'}
        </span>
      </div>
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
                {formatAdminAccessDateTime(event.loginAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <HistoryPaginationControls
        page={page}
        totalPages={totalPages}
        isLoading={isLoading}
        onPageChange={onPageChange}
      />
    </section>
  );
}

function AdminAccessDetailContent({
  detail,
  history,
  mutation,
  layoutContext,
  historyLoading,
  onRoleRequestPageChange,
  onLoginHistoryPageChange,
  onProfileSaved,
}: AdminAccessDetailData & {
  readonly mutation: AdminAccessDetailMutationController;
  readonly layoutContext: AdminAccessDetailLayoutContext;
  readonly historyLoading: boolean;
  readonly onRoleRequestPageChange: (page: number) => void;
  readonly onLoginHistoryPageChange: (page: number) => void;
  readonly onProfileSaved: () => void;
}) {
  const Root = detailRootTag(layoutContext);
  const isOverlay = layoutContext === 'overlay';
  const heading = detailHeadingTags(layoutContext);
  const confirmDialog =
    mutation.confirmAction && mutation.confirmAction !== 'REJECT'
      ? {
          action: mutation.confirmAction,
          ...mutationDialogCopy(mutation.confirmAction, detail),
        }
      : null;

  return (
    <Root
      className={detailRootClassName(
        layoutContext,
        'mx-auto flex w-full max-w-6xl flex-col gap-8 p-5 sm:p-8',
      )}
    >
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
        titleAs={heading.title}
        // 오버레이는 뷰포트가 넓어도 448px 고정 폭 패널 안이라 뷰포트 기준 `sm:`
        // 계단을 그대로 쓰면 안 된다 — 768px·1280px에서 머리말이 가로 배치로
        // 바뀌면서 오른쪽 배지가 밀리고 제목이 40px로 커진다. 두 계단 모두
        // 좁은 화면 값으로 고정한다.
        className={isOverlay ? 'sm:flex-col sm:justify-start' : undefined}
        titleClassName={isOverlay ? 'sm:text-section' : undefined}
        title={detail.name ?? '이름 미등록'}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            @{detail.githubLogin}
            <a
              href={`https://github.com/${detail.githubLogin}`}
              target="_blank"
              rel="noreferrer"
              aria-label={`${detail.githubLogin}의 GitHub 프로필 (새 탭에서 열림)`}
              className="inline-flex items-center text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="size-4" aria-hidden="true" />
            </a>
          </span>
        }
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
              <AdminAccessProfileSection
                userId={detail.id}
                profile={detail.profile}
                headingTag={heading.section}
                isOverlay={isOverlay}
                onSaved={onProfileSaved}
              />
            </section>
            <RoleRequestHistorySection
              items={history.roleRequests.items}
              page={history.roleRequests.page}
              totalPages={adminAccessHistoryPageCount(history.roleRequests)}
              isLoading={historyLoading}
              onPageChange={onRoleRequestPageChange}
              headingTag={heading.section}
            />
            <LoginHistorySection
              items={history.loginHistory.items}
              page={history.loginHistory.page}
              totalPages={adminAccessHistoryPageCount(history.loginHistory)}
              isLoading={historyLoading}
              onPageChange={onLoginHistoryPageChange}
              lastLoginAt={detail.lastLoginAt}
              headingTag={heading.section}
            />
          </div>
        }
        secondary={
          <div className="grid gap-4">
            <AdminAccessPendingRequestCard
              detail={detail}
              processingAction={mutation.processingAction}
              onRequestAction={mutation.onRequestAction}
            />
            <AdminAccessMutationActions
              detail={detail}
              processingAction={mutation.processingAction}
              onRequestAction={mutation.onRequestAction}
            />
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
    </Root>
  );
}

export function AdminAccessDetailContentForState({
  state,
  onRetry,
  mutation,
  layoutContext = 'standalone',
  historyLoading = false,
  onRoleRequestPageChange = () => {},
  onLoginHistoryPageChange = () => {},
  onProfileSaved = () => {},
}: {
  readonly state: AdminAccessDetailState;
  readonly onRetry: () => void;
  readonly mutation: AdminAccessDetailMutationController;
  readonly layoutContext?: AdminAccessDetailLayoutContext;
  readonly historyLoading?: boolean;
  readonly onRoleRequestPageChange?: (page: number) => void;
  readonly onLoginHistoryPageChange?: (page: number) => void;
  readonly onProfileSaved?: () => void;
}) {
  if (state.kind === 'loading') {
    return <LoadingState layoutContext={layoutContext} />;
  }
  if (state.kind === 'error') {
    return <ErrorState onRetry={onRetry} layoutContext={layoutContext} />;
  }
  if (state.kind === 'not-found') {
    return <NotFoundState layoutContext={layoutContext} />;
  }
  return (
    <AdminAccessDetailContent
      detail={state.detail}
      history={state.history}
      mutation={mutation}
      layoutContext={layoutContext}
      historyLoading={historyLoading}
      onRoleRequestPageChange={onRoleRequestPageChange}
      onLoginHistoryPageChange={onLoginHistoryPageChange}
      onProfileSaved={onProfileSaved}
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
 * 최신화한다(기존 로딩 패턴 재사용, 이력 페이지도 1페이지로 되돌아간다).
 * 409 CAS 충돌(`ROL_013`)은 재조회 대신 에러 응답에 실린 authoritative
 * projection으로 `state.detail`만 직접 교체한다 — 이렇게 하면 그 자리에서
 * 바로 "다른 관리자가 먼저 변경했다"는 사실이 반영되고, 방금 실패한 쓰기가
 * 새 상태에 대해 자동으로 재시도되는 일이 없다(사용자가 다이얼로그를 다시
 * 열어야만 재시도된다).
 *
 * 이력 페이지 이동: 요청 이력·로그인 이력은 독립적으로 페이지가 넘어간다
 * (`total` 기반 페이지 수는 `adminAccessHistoryPageCount`). 페이지를 옮길 때는
 * 상세 전체를 다시 불러오지 않고 `fetchAdminAccessHistory`만 다시 호출해
 * `state.history`만 교체한다 — 실패하면 조용히 이전 페이지 그대로 둔다(버튼을
 * 다시 누르면 재시도된다).
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
  const [historyLoading, setHistoryLoading] = useState(false);
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

  const changeRoleRequestPage = async (nextPage: number) => {
    if (state.kind !== 'ready') return;
    setHistoryLoading(true);
    try {
      const history = await fetchAdminAccessHistory(userId, {
        roleRequestPage: nextPage,
        roleRequestLimit: ADMIN_ACCESS_DETAIL_HISTORY_LIMIT,
        loginPage: state.history.loginHistory.page,
        loginLimit: ADMIN_ACCESS_DETAIL_HISTORY_LIMIT,
      });
      setState((current) =>
        current.kind === 'ready' ? { ...current, history } : current,
      );
    } catch {
      // 조용히 실패 — 이전 페이지를 그대로 보여주고, 버튼을 다시 누르면 재시도된다.
    } finally {
      setHistoryLoading(false);
    }
  };

  const changeLoginHistoryPage = async (nextPage: number) => {
    if (state.kind !== 'ready') return;
    setHistoryLoading(true);
    try {
      const history = await fetchAdminAccessHistory(userId, {
        roleRequestPage: state.history.roleRequests.page,
        roleRequestLimit: ADMIN_ACCESS_DETAIL_HISTORY_LIMIT,
        loginPage: nextPage,
        loginLimit: ADMIN_ACCESS_DETAIL_HISTORY_LIMIT,
      });
      setState((current) =>
        current.kind === 'ready' ? { ...current, history } : current,
      );
    } catch {
      // 조용히 실패 — 이전 페이지를 그대로 보여주고, 버튼을 다시 누르면 재시도된다.
    } finally {
      setHistoryLoading(false);
    }
  };

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

  // 프로필 저장은 CAS가 없는 단순 PATCH라 접근 변경 흐름의 conflict projection이
  // 적용되지 않는다 — 성공하면 늘 `retry()`로 상세 전체(이름·학번·학과·isComplete)를
  // 다시 가져온다.
  const handleProfileSaved = () => {
    if (state.kind === 'ready') {
      setMutationSuccess(
        `${state.detail.githubLogin}님의 프로필을 저장했습니다.`,
      );
    }
    retry();
  };

  return (
    <AdminAccessDetailContentForState
      state={state}
      onRetry={retry}
      mutation={mutation}
      layoutContext={layoutContext}
      historyLoading={historyLoading}
      onRoleRequestPageChange={(page) => void changeRoleRequestPage(page)}
      onLoginHistoryPageChange={(page) => void changeLoginHistoryPage(page)}
      onProfileSaved={handleProfileSaved}
    />
  );
}
