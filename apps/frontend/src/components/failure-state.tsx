import { AlertCircle, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface FailureStateProps {
  /** 무엇을 불러오지 못했는지. 「…를 불러오지 못했습니다」 형태로 적는다. */
  readonly title: string;
  /** 다음에 무엇을 하면 되는지(R-15). 기본값이 그 역할을 한다. */
  readonly description?: ReactNode;
  /** 같은 요청을 다시 보낸다. 주면 「다시 시도」 버튼이 선다. */
  readonly onRetry?: () => void;
  /** 재시도로 풀리지 않는 실패에서 내보낼 다른 경로(목록으로 가기 등). */
  readonly action?: ReactNode;
  readonly className?: string;
}

/**
 * 불러오기에 실패한 자리를 그리는 단 하나의 표면(R-10).
 *
 * 래퍼(`main`·`PageBody`·`div`)를 넣지 않는다 — 부르는 쪽마다 감싸는 것이
 * 다르고 패널 안에서는 래퍼가 없어야 한다. 여기서 정하면 절반이 못 쓴다.
 *
 * `EmptyState`를 실패에 쓰지 않는다. 점선 회색 상자는 「아직 안 채워진 자리」를
 * 뜻해서, 그것으로 실패를 그리면 사용자가 고장을 빈 목록으로 읽는다.
 */
export function FailureState({
  title,
  description = '잠시 후 다시 시도해 주세요.',
  onRetry,
  action,
  className,
}: FailureStateProps) {
  const hasControl = Boolean(onRetry) || Boolean(action);
  return (
    <Alert
      variant="destructive"
      data-slot="failure-state"
      className={cn(className)}
    >
      <AlertCircle aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription
        className={cn(
          hasControl && 'flex flex-wrap items-center justify-between gap-3',
        )}
      >
        <span>{description}</span>
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw aria-hidden="true" />
            다시 시도
          </Button>
        ) : null}
        {action}
      </AlertDescription>
    </Alert>
  );
}
