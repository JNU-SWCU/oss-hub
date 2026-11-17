import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
const STEPS = ['공고 선택', '불러오기', '내용 추출', '변경 확인'] as const;
export function ProgramNoticeSteps({ step }: { readonly step: number }) {
  return (
    <ol className="flex w-full items-center text-small" aria-label="진행 단계">
      {STEPS.map((label, index) => (
        <li
          key={label}
          aria-current={index === step ? 'step' : undefined}
          className={cn(
            'flex min-w-0 items-center gap-1 sm:gap-2',
            index < STEPS.length - 1 && 'flex-1',
          )}
        >
          <span
            className={cn(
              'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
              index < step
                ? 'bg-primary text-primary-foreground'
                : index === step
                  ? 'border-2 border-primary text-primary'
                  : 'bg-muted text-muted-foreground',
            )}
          >
            {index < step ? (
              <Check className="size-3" aria-hidden="true" />
            ) : (
              index + 1
            )}
          </span>
          <span
            className={cn(
              'break-keep',
              index === step
                ? 'font-semibold text-foreground'
                : 'text-muted-foreground',
            )}
          >
            {label}
          </span>
          {index < STEPS.length - 1 ? (
            <span
              className={cn(
                'mx-1 h-px flex-1 sm:mx-2',
                index < step ? 'bg-primary' : 'bg-border',
              )}
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}
