import { cn } from '@/lib/utils';

export function SettingsPolicyUpdateNotice() {
  return (
    <section
      aria-labelledby="settings-policy-update-heading"
      className={cn(
        'mx-auto mt-8 flex w-full max-w-2xl flex-col items-start gap-2',
        'rounded-card border border-border bg-card px-6 py-4 sm:mt-16',
      )}
      role="status"
      aria-live="polite"
    >
      <h2
        id="settings-policy-update-heading"
        className="text-base font-semibold text-foreground"
      >
        비공개 기여 집계와 랭킹 안내를 업데이트했습니다
      </h2>
      <p className="break-keep text-sm text-muted-foreground">
        2026년 11월 1일부터 로그인할 때 조회하는 비공개 저장소 기여 건수를
        랭킹 지표 합계에 포함합니다. 기존 회원은 다음 로그인 때 변경된 안내를
        확인하고 한 번 동의하면 계속 이용할 수 있습니다.
      </p>
      <a
        href="/policies/github-activity"
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-primary underline underline-offset-4"
      >
        변경된 안내 읽기 (새 창)
      </a>
    </section>
  );
}
