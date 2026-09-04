'use client';

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { RouteNotice } from './_shell/route-notice';

/**
 * 화면을 그리다 예외가 났을 때 그 route 자리를 대신하는 안내 (#1103).
 *
 * 이 파일이 없으면 렌더 실패도 프레임워크 기본 화면이 받는다 — 배포 빌드에서는 영어
 * 한 줄만 남고 빠져나갈 수단이 없다. 그래서 재시도(`reset`)와 대체 경로(`/programs`)를
 * 함께 준다(R-10 「재시도 또는 대체 경로」).
 *
 * `error.message`는 화면에 내지 않는다. 배포 빌드에서 서버가 던진 메시지는 Next가
 * 지우고 digest만 남기므로 여기서 읽어도 사용자에게 쓸모가 없고, 개발 빌드에서는
 * 내부 구현이 그대로 영어로 드러난다. 문의 창구가 로그와 맞춰 볼 수 있게 digest만
 * 본문 아래 작게 남긴다.
 */
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
