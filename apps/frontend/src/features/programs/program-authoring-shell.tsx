import { Check } from 'lucide-react';
import { PageBody, PageHeader } from '@/components';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  PROGRAM_AUTHORING_STEPS,
  type ProgramAuthoringStep,
} from './program-authoring-model';

export function ProgramAuthoringShell({
  currentStep,
  children,
  onNavigate,
}: {
  readonly currentStep: ProgramAuthoringStep;
  readonly children: React.ReactNode;
  readonly onNavigate: (step: ProgramAuthoringStep) => void;
}) {
  const currentIndex = PROGRAM_AUTHORING_STEPS.findIndex(
    (step) => step.id === currentStep,
  );
  return (
    <PageBody>
      <PageHeader
        title="프로그램 만들기"
        description="최종 확인 전에는 프로그램이 생성되지 않습니다. 입력 내용은 이 탭에서 새로고침해도 복구됩니다."
      />
      <div className="grid min-w-0 gap-8 lg:grid-cols-[var(--sidebar-open-width)_minmax(0,1fr)]">
        <aside className="self-start lg:sticky lg:top-6">
          <nav aria-label="작성 단계" className="hidden lg:block">
            <ol className="grid gap-2">
              {PROGRAM_AUTHORING_STEPS.map((step, index) => (
                <li key={step.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    className={cn(
                      'w-full justify-start gap-3 px-4',
                      step.id === currentStep &&
                        'bg-sidebar-current text-sidebar-current-foreground',
                    )}
                    aria-current={step.id === currentStep ? 'step' : undefined}
                    onClick={() => onNavigate(step.id)}
                  >
                    <span
                      className="grid size-6 shrink-0 place-items-center rounded-full border border-border text-small"
                      aria-hidden="true"
                    >
                      {index < currentIndex ? (
                        <Check className="size-3" />
                      ) : (
                        index + 1
                      )}
                    </span>
                    {step.label}
                  </Button>
                </li>
              ))}
            </ol>
          </nav>
        </aside>
        <div className="min-w-0">
          <div
            className="mb-8 grid gap-2 rounded-card border border-border bg-card p-4 lg:hidden"
            aria-label="작성 진행률"
          >
            <div className="flex items-center justify-between gap-3 text-small">
              <strong>{PROGRAM_AUTHORING_STEPS[currentIndex]?.label}</strong>
              <span className="text-muted-foreground">
                {currentIndex + 1} / {PROGRAM_AUTHORING_STEPS.length}
              </span>
            </div>
            <progress
              className="h-2 w-full accent-primary"
              max={PROGRAM_AUTHORING_STEPS.length}
              value={currentIndex + 1}
            />
          </div>
          <div
            className="mb-8 hidden items-center gap-4 text-small lg:flex"
            aria-label="작성 진행률"
          >
            <progress
              className="h-2 min-w-0 flex-1 accent-primary"
              max={PROGRAM_AUTHORING_STEPS.length}
              value={currentIndex + 1}
            />
            <span className="shrink-0 text-muted-foreground">
              {currentIndex + 1} / {PROGRAM_AUTHORING_STEPS.length}
            </span>
          </div>
          <div className="mx-auto max-w-4xl">{children}</div>
        </div>
      </div>
    </PageBody>
  );
}
