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
        활동 수집·랭킹 안내를 정리했습니다
      </h2>
      <p className="break-keep text-sm text-muted-foreground">
        2026년 10월 19일, 공개 랭킹의 학과 표시와 다섯 가지 지표, 활동 수집
        범위를 현재 운영 기준에 맞춰 안내했습니다. 기존 동의는 유지되며 추가
        동의 없이 이용할 수 있습니다.
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
