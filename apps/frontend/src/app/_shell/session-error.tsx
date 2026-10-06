'use client';

import { Button } from '@/components/ui/button';

export function SessionError({ onRetry }: { onRetry: () => void }) {
  return (
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
