import Link from 'next/link';
import { Button } from '@/components/ui/button';

export function AccessDenied({ homePath }: { readonly homePath: string }) {
  return (
    <section
      aria-labelledby="access-denied-heading"
      className="flex min-h-[50svh] flex-col items-center justify-center gap-4 px-6 py-16 text-center"
    >
      <div className="space-y-1">
        <h1
          id="access-denied-heading"
          className="text-lg font-semibold text-foreground"
        >
          접근 권한이 없습니다
        </h1>
        <p className="mx-auto max-w-md break-keep text-sm text-muted-foreground">
          현재 계정으로는 이 화면을 이용할 수 없습니다.
        </p>
      </div>
      <Button asChild className="min-h-11" variant="outline" size="sm">
        <Link href={homePath}>내 화면으로 돌아가기</Link>
      </Button>
    </section>
  );
}
