import { Fragment } from 'react';
import { cn } from '@/lib/utils';

export const SETTINGS_ONBOARDING_NOTICE_HEADING = '가입이 아직 진행 중입니다';

export const SETTINGS_ONBOARDING_NOTICE_SENTENCES = [
  '승인 전에도 이름·학과 수정은 가능합니다.',
  '학번은 처음 한 번만 입력합니다.',
  '나머지 기능은 가입 후 열립니다.',
] as const;

export const SETTINGS_ONBOARDING_NOTICE_BODY =
  SETTINGS_ONBOARDING_NOTICE_SENTENCES.join(' ');

export function SettingsOnboardingNotice() {
  return (
    <section
      aria-labelledby="settings-onboarding-notice-heading"
      className={cn(
        'mx-auto mt-8 flex w-full max-w-2xl flex-col items-start gap-2',
        'rounded-card border border-border bg-card px-6 py-4 sm:mt-16',
      )}
      role="status"
      aria-live="polite"
    >
      <h2
        id="settings-onboarding-notice-heading"
        className="text-base font-semibold text-foreground"
      >
        {SETTINGS_ONBOARDING_NOTICE_HEADING}
      </h2>
      <p className="break-keep text-sm text-muted-foreground">
        {SETTINGS_ONBOARDING_NOTICE_SENTENCES.map((sentence, index) => (
          <Fragment key={sentence}>
            {index === 0 ? null : ' '}
            <span className="inline-block">{sentence}</span>
          </Fragment>
        ))}
      </p>
    </section>
  );
}
