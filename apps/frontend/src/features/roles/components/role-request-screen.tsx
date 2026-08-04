'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  CircleCheck,
  Clock3,
  RefreshCw,
  TriangleAlert,
  UserPen,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { StatusBadge } from '@/components/status-badge';
import { StatusMessagePage } from '@/components/status-message-page';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';

import { fetchMyRoleRequest, requestStaffRole } from '../api';
import type { RoleRequest } from '../types';

/**
 * 재요청 제출이 실패했는데 **원인을 알 수 없을** 때의 안내.
 * 서버가 ProblemDetail을 돌려주지 못한 경우(연결 끊김, 형식이 다른 응답)라
 * 요청이 서버에 닿았는지조차 알 수 없다. 그래서 남은 상태를 단정하지 않고,
 * 지금 화면이 최신인지 확인할 수단(바로 아래 ‘상태 새로고침’)을 함께 준다.
 */
export const ROLE_REQUEST_RETRY_FAILURE_MESSAGE =
  '교직원 승인 요청을 제출하지 못했습니다. 요청이 접수됐는지 확인되지 않았으니, 아래 ‘상태 새로고침’으로 지금 상태를 확인한 뒤 여전히 반려면 ‘다시 승인 요청하기’를 눌러 주세요.';

/** 같은 버튼을 다시 눌러도 결과가 달라지는 실패인가 — 409는 서버 상태가 이미 다르다. */
const ROLE_REQUEST_RETRY_CONFLICT_STATUS = 409;

/**
 * 재요청 실패 안내를 만든다.
 *
 * 서버가 준 사유(`ProblemDetail.detail`)는 버리지 않는다. 이 엔드포인트의 실패는
 * “처리 중인 교직원 권한 요청이 이미 있습니다”, “이미 확정된 역할은 변경할 수
 * 없습니다” 처럼 사용자가 곧바로 이해하는 문장이라(`roles-error-code.enum.ts`),
 * 우리 문구로 덮으면 실제로 무슨 일이 일어났는지가 사라진다. 대신 서버 문장은
 * 원인만 말하고 다음 행동을 말해 주지 않으므로, 원인 뒤에 우리가 행동을 붙인다.
 */
export function roleRequestRetryFailureMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return ROLE_REQUEST_RETRY_FAILURE_MESSAGE;
  }

  const reason = error.message.trim();
  if (reason.length === 0) {
    return ROLE_REQUEST_RETRY_FAILURE_MESSAGE;
  }

  // 409는 서버가 이미 다른 상태라는 뜻이다(대기 중 요청 존재·역할 확정 등).
  // 같은 버튼을 다시 눌러도 같은 답만 돌아오므로 화면을 최신으로 맞추는 쪽을 준다.
  const nextAction =
    error.problem.status === ROLE_REQUEST_RETRY_CONFLICT_STATUS
      ? '이 화면의 상태가 오래됐을 수 있으니 아래 ‘상태 새로고침’을 눌러 확인해 주세요.'
      : '잠시 후 아래 ‘다시 승인 요청하기’를 눌러 주세요.';

  return `${reason} ${nextAction}`;
}

/**
 * 승인을 기다리는 교직원이 자기 이름·학과를 고치러 가는 자리(#598).
 *
 * 고칠 **수단**은 이미 있었다 — 설정 화면이 그들에게 열려 있다(#581). 없던 것은
 * 그 화면으로 가는 **길**이다. 설정으로 가는 입구가 머리글 계정 메뉴 하나뿐이라
 * (2026-08-04 실측: 세 역할 × 세 폭 아홉 조합 모두 계정 메뉴 1개), 그 메뉴를 모르는
 * 사람에게는 이름의 오타 하나가 영영 고쳐지지 않았다. 그래서 이미 서 있는 자리에
 * 입구를 하나 더 낸다.
 *
 * 프로필 입력 단계(`/onboarding/profile`)로 보내지 않는다. 두 가지 이유다.
 *
 * 1. 그 화면은 `STEP 3 / 3`·`가입 마치기`를 말하는 **가입 절차의 마지막 칸**이다.
 *    이미 가입을 마치고 승인만 기다리는 사람에게 다시 열면 가입이 되돌아간 것으로
 *    읽힌다. 게다가 프로필이 이미 완료라 그 화면은 스스로 되돌아 나온다
 *    (`features/profile/profile-state.ts`의 `getProfileRedirect`).
 * 2. 설정 화면은 이 사람을 위해 만들어졌다 — 학번은 잠그고 이름·학과만 열며
 *    "가입이 아직 진행 중입니다" 안내를 함께 세운다
 *    (`app/settings/settings-onboarding-notice.tsx`).
 *
 * 역할 선택 단계는 여기서 **열지 않는다.** 승인 대기 중에 역할을 다시 고르면 요청이
 * 하나 더 만들어져 관리자 승인 목록에 같은 사람이 두 번 뜬다.
 */
export const PENDING_PROFILE_EDIT_PATH = '/settings';

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
        // 누가·언제·어떻게 알 수 있는지를 모두 적는다. 이 서비스는 승인 시
        // 알림을 보내지 않으므로, 그 사실을 숨기면 사용자는 알림을 기다리며
        // 무한정 대기하게 된다. 확인 방법을 명시하는 것이 정직하고 실행 가능하다.
        description:
          '사업단 관리자가 요청을 확인한 뒤 승인합니다. 승인 결과는 별도 알림 없이 이 화면에 반영되므로, 잠시 후 다시 방문해 확인해 주세요. 승인이 완료되면 프로그램 개설과 운영 기능을 사용할 수 있습니다.',
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
    case 'REVOKED':
      return {
        icon: <RefreshCw className="size-8" />,
        title: '교직원 역할이 회수되었습니다',
        description: '학생 또는 교직원 역할을 다시 선택할 수 있습니다.',
        badge: <StatusBadge variant="closed">회수</StatusBadge>,
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
                <a href="/dashboard">교직원 화면으로 이동</a>
              </Button>
            ) : null}

            {request.status === 'REVOKED' ? (
              <Button asChild size="lg">
                <a href="/onboarding/role">역할 다시 선택하기</a>
              </Button>
            ) : null}

            {request.status === 'PENDING' || request.status === 'REJECTED' ? (
              <Button type="button" variant="outline" onClick={onRefresh}>
                <RefreshCw />
                상태 새로고침
              </Button>
            ) : null}

            {/* 승인 대기(`PENDING`)에서만 낸다 — 설정 화면의 문(`app/settings/
                settings-access.ts`의 `isSettingsOpenForStaffAwaitingRole`)이 열리는
                갈래와 같아야 한다. 반려·회수는 그 문이 닫혀 있어 링크를 내면 눌러도
                이 화면으로 되돌아오는 제자리 걸음이 된다. 승인은 이 화면에 머무르지
                않고 `/dashboard`로 나간다. 두 곳이 갈라지지 않도록
                `app/onboarding/pending/profile-edit-path.test.ts`가 못박는다. */}
            {request.status === 'PENDING' ? (
              // 링크 문구는 고칠 수 있는 항목을 그대로 적는다 — 학번은 한 번
              // 저장하면 잠기므로(`users.service.ts`의 `STUDENT_ID_IMMUTABLE`)
              // 여기에 넣으면 고치러 갔다가 잠긴 칸을 보고 고장으로 읽는다.
              // `~할 수 있습니다`도 쓰지 않는다: 375px에서 의존명사 `수` 앞뒤로
              // 줄이 갈린다(`settings-onboarding-notice.tsx`와 같은 규칙).
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
        // 회원 공통 입구. STAFF 본문은 세션 역할로 /dashboard에서 고른다.
        router.replace('/dashboard');
        router.refresh();
        return;
      }
      if (request.status === 'REVOKED') {
        router.replace('/onboarding/role');
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
      setRetryError(roleRequestRetryFailureMessage(error));
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
