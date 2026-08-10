import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { SIGNUP_ENTRY } from '@/features/auth/signup-entry-link';

/**
 * 로그인이 필요한 화면에 비로그인(anonymous)으로 들어왔을 때의 안내.
 *
 * 예전에는 조용히 랜딩(`/`)으로 되돌리기만 했다(role-gate.tsx). 링크를 눌렀는데
 * 안내 없이 다른 화면이 떠 있으면 사용자는 "왜 튕겼지?" 하며 같은 시도를 반복한다
 * (QA46). `AccessDenied`·`SessionError`와 같은 자리(화면 전체를 대신하는 상태)에 세워
 * 무슨 일이 있었는지 말해 주고, 로그인하거나 홈으로 돌아갈 수단을 함께 준다.
 */
export function LoginRequiredNotice() {
  return (
    <section
      aria-labelledby="login-required-heading"
      className="flex min-h-[50svh] flex-col items-center justify-center gap-4 px-6 py-16 text-center"
    >
      <div className="space-y-1">
        <h1
          id="login-required-heading"
          className="text-lg font-semibold text-foreground"
          role="alert"
        >
          로그인이 필요한 페이지입니다
        </h1>
        <p className="mx-auto max-w-md break-keep text-sm text-muted-foreground">
          로그인한 계정만 볼 수 있는 화면입니다. 로그인하거나 홈으로 돌아가
          주세요.
        </p>
      </div>
      <div className="flex gap-2">
        <Button asChild className="min-h-11" size="sm">
          <Link href={SIGNUP_ENTRY.href}>로그인</Link>
        </Button>
        <Button asChild className="min-h-11" variant="outline" size="sm">
          <Link href="/">홈으로</Link>
        </Button>
      </div>
    </section>
  );
}
