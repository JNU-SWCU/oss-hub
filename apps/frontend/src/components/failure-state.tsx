import { AlertCircle, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface FailureStateProps {
  readonly title: string;

  readonly description?: ReactNode;

  readonly onRetry?: () => void;

  readonly action?: ReactNode;
  readonly className?: string;
}

export function FailureState({
  title,
  description = '잠시 후 다시 시도해 주세요.',
  onRetry,
  action,
  className,
}: FailureStateProps) {
  const hasControl = Boolean(onRetry) || Boolean(action);
  return (
    <Alert
      variant="destructive"
      data-slot="failure-state"
      className={cn(className)}
    >
      <AlertCircle aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription
        className={cn(
          hasControl && 'flex flex-wrap items-center justify-between gap-3',
        )}
      >
        <span>{description}</span>
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw aria-hidden="true" />
            다시 시도
          </Button>
        ) : null}
        {action}
      </AlertDescription>
    </Alert>
  );
}
