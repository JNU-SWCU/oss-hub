'use client';

import { Button } from '@/components/ui/button';

/**
 * 세션·역할 조회 실패 표시. 게이트마다 문구를 따로 두지 않고 이 컴포넌트 하나를 공유한다.
 *
 * 실패를 비로그인으로 처리하면 로그인한 사용자가 랜딩으로 밀려나고, 사용자는 그것을
 * "로그아웃됐다"로 읽는다. 실제 원인(일시적 조회 실패)과 화면이 어긋나므로 재시도할
 * 생각도 못 한다. 그래서 실패는 별도 상태로 드러내고 재시도 수단을 함께 준다.
 */
export function SessionError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 p-6" role="alert">
      <div className="space-y-1">
        <p className="text-sm font-semibold">
          로그인 정보를 확인하지 못했습니다.
        </p>
        <p className="text-sm text-muted-foreground">
          일시적인 통신 문제일 수 있습니다. 로그아웃된 것은 아니니 다시 시도해
          주세요.
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        다시 시도
      </Button>
    </div>
  );
}
