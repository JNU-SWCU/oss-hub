import { Check } from 'lucide-react';
import { PageBody, PageHeader } from '@/components';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PROGRAM_AUTHORING_STEPS } from './program-authoring-model';

export function ProgramAuthoringShell<
  Step extends { readonly id: string; readonly label: string } =
    (typeof PROGRAM_AUTHORING_STEPS)[number],
>({
  currentStep,
  children,
  onNavigate,
  title = '프로그램 만들기',
  description = '최종 확인 전에는 프로그램이 생성되지 않습니다.',
  steps = PROGRAM_AUTHORING_STEPS as unknown as readonly Step[],
}: {
  readonly currentStep: Step['id'];
  readonly children: React.ReactNode;
  readonly onNavigate: (step: Step['id']) => void;
  readonly title?: string;
  readonly description?: string;
  readonly steps?: readonly Step[];
}) {
  const currentIndex = steps.findIndex((step) => step.id === currentStep);
  return (
    <PageBody>
      <PageHeader title={title} description={description} />
      <div className="grid min-w-0 gap-8 lg:grid-cols-[var(--sidebar-open-width)_minmax(0,1fr)]">
        <aside className="self-start lg:sticky lg:top-6">
          <nav aria-label="작성 단계" className="hidden lg:block">
            <ol className="grid gap-2">
              {steps.map((step, index) => (
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
              <strong>{steps[currentIndex]?.label}</strong>
              <span className="text-muted-foreground">
                {currentIndex + 1} / {steps.length}
              </span>
            </div>
            <progress
              className="h-2 w-full accent-primary"
              max={steps.length}
              value={currentIndex + 1}
            />
          </div>
          <div className="mx-auto max-w-4xl">{children}</div>
        </div>
      </div>
    </PageBody>
  );
}
