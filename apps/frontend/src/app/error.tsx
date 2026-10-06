'use client';

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { RouteNotice } from './_shell/route-notice';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteNotice
      title="화면을 여는 중 문제가 생겼습니다"
      description="잠시 후 다시 시도해 주세요. 다시 시도해도 열리지 않으면 프로그램 목록으로 돌아갈 수 있습니다."
      code={error.digest ? `오류 코드 ${error.digest}` : undefined}
      actions={
        <>
          <Button type="button" className="min-h-11" size="sm" onClick={reset}>
            다시 시도
          </Button>
          <Button asChild className="min-h-11" variant="outline" size="sm">
            <Link href="/programs">프로그램 목록으로</Link>
          </Button>
        </>
      }
    />
  );
}
