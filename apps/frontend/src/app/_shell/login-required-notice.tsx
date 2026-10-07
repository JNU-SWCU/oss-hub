'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { signupForDestination } from '@/features/auth/login-destination';

export function LoginRequiredNotice() {
  const pathname = usePathname();
  return (
    <section
      aria-labelledby="login-required-heading"
      className="flex min-h-[50svh] flex-col items-center justify-center gap-4 px-6 py-16 text-center"
    >
      <div className="space-y-1">
        <h1
          id="login-required-heading"
          className="text-lg font-semibold text-foreground"
        >
          로그인이 필요합니다
        </h1>
        <p className="mx-auto max-w-md break-keep text-sm text-muted-foreground">
          로그인 후 이 화면을 이용할 수 있습니다.
        </p>
      </div>
      <div className="flex gap-2">
        <Button asChild className="min-h-11" size="sm">
          <Link href={signupForDestination(pathname)}>로그인</Link>
        </Button>
        <Button asChild className="min-h-11" variant="outline" size="sm">
          <Link href="/">홈으로</Link>
        </Button>
      </div>
    </section>
  );
}
