'use client';

import type { ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function ProgramAuthoringDialog({
  title,
  description,
  children,
  size = 'md',
  bodyClassName,
  onCancel,
  onSave,
}: {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
  readonly size?: 'md' | 'lg';
  readonly bodyClassName?: string;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/35" />
        <Dialog.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card border border-border bg-background p-card shadow-xl outline-none',
            size === 'lg' ? 'max-w-2xl' : 'max-w-xl',
          )}
        >
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="mt-1 text-small text-muted-foreground">
            {description}
          </Dialog.Description>
          <div
            className={cn(
              'mt-5 grid min-h-0 gap-5 overflow-y-auto pr-1',
              bodyClassName,
            )}
          >
            {children}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              취소
            </Button>
            <Button type="button" onClick={onSave}>
              저장
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
