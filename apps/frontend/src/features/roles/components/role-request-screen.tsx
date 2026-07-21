'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CircleCheck, Clock3, RefreshCw, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { StatusBadge } from '@/components/status-badge';
import { StatusMessagePage } from '@/components/status-message-page';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';

import { fetchMyRoleRequest, requestStaffRole } from '../api';
import type { RoleRequest } from '../types';

interface RoleRequestStatusViewProps {
  readonly request: RoleRequest;
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

function statusPresentation(request: RoleRequest): StatusPresentation {
  switch (request.status) {
    case 'PENDING':
      return {
        icon: <Clock3 className="size-8" />,
        title: '교직원 승인을 기다리고 있습니다',
        description: '승인이 완료되면 교직원 프로그램 관리 기능을 사용할 수 있습니다.',
        badge: <StatusBadge variant="pending">승인 대기</StatusBadge>,
      };
    case 'REJECTED':
      return {
        icon: <TriangleAlert className="size-8" />,
        title: '교직원 역할 요청이 반려되었습니다',
        description: '반려 사유를 확인한 뒤 다시 승인을 요청할 수 있습니다.',
        badge: <StatusBadge variant="rejected">반려</StatusBadge>,
      };
    case 'APPROVED':
      return {
        icon: <CircleCheck className="size-8" />,
        title: '교직원 역할이 승인되었습니다',
        description: '이제 프로그램 생성과 운영 기능을 사용할 수 있습니다.',
        badge: <StatusBadge variant="approved">승인</StatusBadge>,
      };
  }
}

export function RoleRequestStatusView({
  request,
  isRetrying,
  errorMessage,
  onRefresh,
  onRetry,
}: RoleRequestStatusViewProps) {
  const presentation = statusPresentation(request);

  return (
    <div data-status={request.status}>
      <StatusMessagePage
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

            {request.status === 'APPROVED' ? (
              <Button asChild size="lg">
                <a href="/staff/dashboard">교직원 화면으로 이동</a>
              </Button>
            ) : null}

            {request.status !== 'APPROVED' ? (
              <Button type="button" variant="outline" onClick={onRefresh}>
                <RefreshCw />
                상태 새로고침
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
  | { readonly kind: 'ready'; readonly request: RoleRequest }
  | { readonly kind: 'error'; readonly message: string };

function unreachable(value: never): never {
  throw new TypeError(`처리하지 않은 역할 요청 화면 상태: ${String(value)}`);
}

export function RoleRequestScreen() {
  const router = useRouter();
  const [state, setState] = useState<RequestViewState>({ kind: 'loading' });
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const loadRequest = useCallback(async (): Promise<void> => {
    setState({ kind: 'loading' });

    try {
      const request = await fetchMyRoleRequest();
      if (request === null) {
        router.replace('/onboarding/role');
        return;
      }
      if (request.status === 'APPROVED') {
        router.replace('/staff/dashboard');
        router.refresh();
        return;
      }
      setState({ kind: 'ready', request });
    } catch (error) {
      if (error instanceof ApiError) {
        setState({ kind: 'error', message: error.message });
      } else {
        setState({
          kind: 'error',
          message: '승인 상태를 불러오지 못했습니다.',
        });
      }
    }
  }, [router]);

  useEffect(() => {
    void loadRequest();
  }, [loadRequest]);

  async function handleRetry(): Promise<void> {
    if (isRetrying) {
      return;
    }

    setIsRetrying(true);
    setRetryError(null);

    try {
      const request = await requestStaffRole();
      setState({ kind: 'ready', request });
    } catch (error) {
      if (error instanceof ApiError) {
        setRetryError(error.message);
      } else {
        setRetryError('승인 요청을 다시 제출하지 못했습니다.');
      }
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
        <RoleRequestStatusView
          request={state.request}
          isRetrying={isRetrying}
          errorMessage={retryError}
          onRefresh={() => void loadRequest()}
          onRetry={() => void handleRetry()}
        />
      );
    case 'error':
      return (
        <StatusMessagePage
          icon={<TriangleAlert className="size-8" />}
          title="승인 상태를 불러오지 못했습니다"
          description={state.message}
          action={
            <Button type="button" onClick={() => void loadRequest()}>
              다시 시도
            </Button>
          }
        />
      );
    default:
      return unreachable(state);
  }
}
