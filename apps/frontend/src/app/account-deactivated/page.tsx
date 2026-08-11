import Link from 'next/link';
import { CircleCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AccountDeactivatedPage() {
  return (
    <main className="mx-auto flex min-h-[60svh] w-full max-w-2xl flex-col justify-center gap-6 px-6 py-16 break-keep">
      <CircleCheck
        aria-hidden="true"
        className="size-12 text-status-approved-fg"
      />
      <div className="space-y-2">
        <h1 className="font-heading text-3xl font-bold tracking-tight">
          계정이 비활성화되었습니다
        </h1>
        <p role="status" className="text-sm leading-6 text-muted-foreground">
          이 서비스에서 로그아웃되었습니다. 제출물과{' '}
          <span className="whitespace-nowrap">동의·활동 이력은</span> 그대로
          보존됩니다.
        </p>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">
        계정을 다시 사용하려면 관리자에게 재활성화를 요청해 주세요.
      </p>
      <div>
        <Button asChild variant="outline">
          <Link href="/">홈으로 돌아가기</Link>
        </Button>
      </div>
    </main>
  );
}
