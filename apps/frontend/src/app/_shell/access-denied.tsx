import Link from 'next/link';
import { Button } from '@/components/ui/button';

/**
 * 권한이 없는 화면에 들어왔을 때의 안내.
 *
 * 예전에는 조용히 자기 역할 홈으로 되돌리기만 했다. 사용자 입장에서는 링크를
 * 눌렀는데 다른 화면이 떠 있는 셈이라 "왜 튕겼지?" 하고 같은 시도를 반복하게
 * 된다. 무슨 일이 있었는지 말해 주고, 돌아갈 곳을 직접 고르게 한다.
 */
export function AccessDenied({ homePath }: { readonly homePath: string }) {
  return (
    // 화면 전체를 대신하는 상태라 가운데에 세운다 — 세션 실패 화면과 같은 규칙이다.
    <section
      aria-labelledby="access-denied-heading"
      className="flex min-h-[50svh] flex-col items-center justify-center gap-4 px-6 py-16 text-center"
    >
      <div className="space-y-1">
        <h1
          id="access-denied-heading"
          className="text-lg font-semibold text-foreground"
          role="alert"
        >
          접근 권한이 없는 페이지 입니다
        </h1>
        <p className="mx-auto max-w-md break-keep text-sm text-muted-foreground">
          현재 계정으로는 이 화면을 열 수 없습니다. 주소를 다시 확인하거나 아래
          버튼으로 돌아가 주세요.
        </p>
      </div>
      <Button asChild className="min-h-11" variant="outline" size="sm">
        <Link href={homePath}>내 화면으로 돌아가기</Link>
      </Button>
    </section>
  );
}
