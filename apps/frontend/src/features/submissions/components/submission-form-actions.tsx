import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface SubmissionFormActionsProps {
  readonly submitLabel: string;
  readonly submitting: boolean;
  readonly onCancel?: () => void;
}

export function SubmissionFormActions({
  submitLabel,
  submitting,
  onCancel,
}: SubmissionFormActionsProps) {
  return (
    <div
      data-testid="submission-actions"

      className={cn(
        'sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3',
        'border-t border-border bg-background pt-4 pb-5',
        'after:absolute after:inset-x-0 after:top-full after:h-5 after:bg-background',
        'sm:pb-6 sm:after:h-6',
      )}
    >
      <Button type="button" variant="outline" onClick={onCancel}>
        취소
      </Button>
      <Button type="submit" disabled={submitting}>
        {submitLabel}
      </Button>
    </div>
  );
}
