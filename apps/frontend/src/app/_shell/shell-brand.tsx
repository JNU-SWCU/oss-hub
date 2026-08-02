import Link from 'next/link';
import { cn } from '@/lib/utils';

/** 랜딩과 업무 셸이 함께 쓰는 OSS Hub 브랜드 표식. */
export function ShellBrandMark() {
  return (
    <span
      aria-hidden
      data-slot="shell-brand-mark"
      className="grid size-8 shrink-0 place-items-center rounded-control bg-primary text-sm font-bold text-primary-foreground"
    >
      O
    </span>
  );
}

/** 셸 종류와 무관하게 같은 마크·글자 규격으로 홈으로 돌아가는 브랜드 링크. */
export function ShellBrand({ className }: { readonly className?: string }) {
  return (
    <Link
      data-slot="shell-brand"
      href="/"
      className={cn(
        'font-heading flex min-h-control items-center gap-3 rounded-control text-[17px] font-bold tracking-[-0.02em] whitespace-nowrap text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        className,
      )}
    >
      <ShellBrandMark />
      OSS Hub
    </Link>
  );
}
