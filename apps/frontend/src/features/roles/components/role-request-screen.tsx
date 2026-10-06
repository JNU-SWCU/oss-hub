'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Clock3, RefreshCw, TriangleAlert, UserPen } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { StatusBadge } from '@/components/status-badge';
import { StatusMessagePage } from '@/components/status-message-page';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';

import { requestStaffRole } from '../api';
import type { StaffAccessRequest, StaffAccessRequestStatus } from '../types';

export const ROLE_REQUEST_RETRY_FAILURE_MESSAGE =
  '교직원 승인 요청을 제출하지 못했습니다. 요청이 접수됐는지 확인되지 않았으니, 아래 ‘상태 새로고침’으로 지금 상태를 확인한 뒤 여전히 반려면 ‘다시 승인 요청하기’를 눌러 주세요.';

const ROLE_REQUEST_RETRY_CONFLICT_STATUS = 409;

export function staffAccessRequestRetryFailureMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return ROLE_REQUEST_RETRY_FAILURE_MESSAGE;
  }

  const reason = error.message.trim();
  if (reason.length === 0) {
    return ROLE_REQUEST_RETRY_FAILURE_MESSAGE;
  }

  const nextAction =
    error.problem.status === ROLE_REQUEST_RETRY_CONFLICT_STATUS
      ? '이 화면의 상태가 오래됐을 수 있으니 아래 ‘상태 새로고침’을 눌러 확인해 주세요.'
      : '잠시 후 아래 ‘다시 승인 요청하기’를 눌러 주세요.';

  return `${reason} ${nextAction}`;
}

export const PENDING_PROFILE_EDIT_PATH = '/settings';

type StaffAccessRequestView = Pick<
  StaffAccessRequest,
  'status' | 'rejectionReason'
>;

interface StaffAccessRequestStatusViewProps {
  readonly request: StaffAccessRequestView;
  readonly isRetrying: boolean;
  readonly errorMessage: string | null;
  readonly onRefresh: () => void;
  readonly onRetry: () => void;
}

interface StatusPresentation {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly badge: ReactNode;
}

function statusPresentation(
  request: StaffAccessRequestView,
): StatusPresentation {
  switch (request.status) {
    case 'PENDING':
    case 'APPROVED':
      return {
        icon: <Clock3 className="size-8" />,
        title: '교직원 승인을 기다리고 있습니다',

        description:
          '사업단 관리자가 승인하면 프로그램을 개설·운영할 수 있습니다. 별도 알림은 보내지 않으니 이 화면에서 승인 상태를 확인해 주세요.',
        badge: <StatusBadge variant="pending">승인 대기</StatusBadge>,
      };
    case 'REJECTED':
      return {
        icon: <TriangleAlert className="size-8" />,
        title: '교직원 역할 요청이 반려되었습니다',
        description: '반려 사유를 확인한 뒤 다시 승인을 요청할 수 있습니다.',
        badge: <StatusBadge variant="rejected">반려</StatusBadge>,
      };
    case 'REVOKED':
      return {
        icon: <RefreshCw className="size-8" />,
        title: '교직원 역할이 회수되었습니다',
        description: '학생 또는 교직원 역할을 다시 선택할 수 있습니다.',
        badge: <StatusBadge variant="closed">회수</StatusBadge>,
      };
  }
}

export function StaffAccessRequestStatusView({
  request,
  isRetrying,
  errorMessage,
  onRefresh,
  onRetry,
}: StaffAccessRequestStatusViewProps) {
  const presentation = statusPresentation(request);

  const isAwaitingApproval =
    request.status === 'PENDING' || request.status === 'APPROVED';

  return (
    <div data-status={request.status}>
      <StatusMessagePage
        className="break-keep"
        icon={presentation.icon}
        title={presentation.title}
        description={presentation.description}
        action={
          <div className="flex w-full max-w-md flex-col items-center gap-3">
            {presentation.badge}

            {request.status === 'REJECTED' && request.rejectionReason ? (
              <Alert variant="destructive">
                <AlertTitle>반려 사유</AlertTitle>
                <AlertDescription>{request.rejectionReason}</AlertDescription>
              </Alert>
            ) : null}

            {errorMessage ? (
              <Alert variant="destructive">
                <AlertTitle>요청을 처리하지 못했습니다</AlertTitle>
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            ) : null}

            {request.status === 'REJECTED' ? (
              <Button
                type="button"
                size="lg"
                disabled={isRetrying}
                onClick={onRetry}
              >
                {isRetrying ? '요청 중…' : '다시 승인 요청하기'}
              </Button>
            ) : null}

            {request.status === 'REVOKED' ? (
              <Button asChild size="lg">
                <a href="/onboarding/role">역할 다시 선택하기</a>
              </Button>
            ) : null}

            {isAwaitingApproval || request.status === 'REJECTED' ? (
              <Button
                type="button"
                variant="outline"
                disabled={isRetrying}
                onClick={onRefresh}
              >
                <RefreshCw />
                상태 새로고침
              </Button>
            ) : null}

            {isAwaitingApproval ? (
              <Button asChild variant="ghost">
                <Link href={PENDING_PROFILE_EDIT_PATH}>
                  <UserPen />
                  이름·학과 고치기
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />
    </div>
  );
}

type RequestViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly request: StaffAccessRequestView };

function unreachable(value: never): never {
  throw new TypeError(`처리하지 않은 역할 요청 화면 상태: ${String(value)}`);
}

export function StaffAccessRequestScreen({
  staffAccessRequestStatus,
  staffAccessRequestRejectionReason,
  onRefresh,
}: {
  readonly staffAccessRequestStatus: StaffAccessRequestStatus | null;
  readonly staffAccessRequestRejectionReason: string | null;

  readonly onRefresh: () => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<RequestViewState>(() => {
    if (
      staffAccessRequestStatus === 'PENDING' ||
      staffAccessRequestStatus === 'REJECTED' ||
      staffAccessRequestStatus === 'APPROVED'
    ) {
      return {
        kind: 'ready',
        request: {
          status: staffAccessRequestStatus,
          rejectionReason: staffAccessRequestRejectionReason,
        },
      };
    }
    return { kind: 'loading' };
  });
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  useEffect(() => {
    switch (staffAccessRequestStatus) {
      case 'PENDING':
      case 'REJECTED':
      case 'APPROVED':
        setState({
          kind: 'ready',
          request: {
            status: staffAccessRequestStatus,
            rejectionReason: staffAccessRequestRejectionReason,
          },
        });
        return;
      case 'REVOKED':
      case null:
        router.replace('/onboarding/role');
        return;
      default: {
        const exhaustive: never = staffAccessRequestStatus;
        unreachable(exhaustive);
      }
    }
  }, [staffAccessRequestRejectionReason, staffAccessRequestStatus, router]);

  async function handleRetry(): Promise<void> {
    if (isRetrying) {
      return;
    }

    setIsRetrying(true);
    setRetryError(null);

    try {
      await requestStaffRole();

      onRefresh();
    } catch (error) {
      setRetryError(staffAccessRequestRetryFailureMessage(error));
    } finally {
      setIsRetrying(false);
    }
  }

  switch (state.kind) {
    case 'loading':
      return (
        <StatusMessagePage
          icon={<Clock3 className="size-8" />}
          title="승인 상태를 확인하고 있습니다"
          description="잠시만 기다려 주세요."
        />
      );
    case 'ready':
      return (
        <StaffAccessRequestStatusView
          request={state.request}
          isRetrying={isRetrying}
          errorMessage={retryError}
          onRefresh={() => {
            setRetryError(null);
            onRefresh();
          }}
          onRetry={() => void handleRetry()}
        />
      );
    default:
      return unreachable(state);
  }
}
