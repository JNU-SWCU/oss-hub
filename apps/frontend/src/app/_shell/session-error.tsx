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
    // 화면 전체를 대신하는 상태라 왼쪽 위에 붙이지 않고 가운데에 세운다.
    // 왼쪽 상단에 작게 붙어 있으면 "화면 한 귀퉁이의 알림"으로 읽혀, 지금 이
    // 화면이 통째로 실패했다는 사실이 전달되지 않는다.
    <div
      className="flex min-h-[50svh] flex-col items-center justify-center gap-4 px-6 py-16 text-center"
      role="alert"
    >
      <div className="space-y-1">
        <p className="text-base font-semibold">
          로그인 정보를 확인하지 못했습니다.
        </p>
        <p className="mx-auto max-w-md break-keep text-sm text-muted-foreground">
          일시적인 통신 문제일 수 있습니다. 로그아웃된 것은 아니니 다시 시도해
          주세요.
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        onClick={onRetry}
      >
        다시 시도
      </Button>
    </div>
  );
}
