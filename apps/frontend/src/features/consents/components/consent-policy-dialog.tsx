'use client';

import { useRef } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { ConsentRequiredItem } from '../api';
import {
  ConsentPolicyCloseButton,
  ConsentPolicyDocumentFrame,
} from './consent-policy-document';

export const consentPolicyDialogClassName = cn(
  'fixed z-50 flex flex-col overflow-hidden bg-cosmos-near focus:outline-none',
  'top-[env(safe-area-inset-top)] right-0 bottom-[env(safe-area-inset-bottom)] left-0 translate-x-0 translate-y-0',
  'sm:top-1/2 sm:right-auto sm:bottom-auto sm:left-1/2 sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)] sm:max-w-3xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-card sm:border sm:border-cosmos-border sm:shadow-lg',
);

export function ConsentPolicyDialog({
  item,
  onClose,
  onCloseFocusTrigger,
}: {
  readonly item: ConsentRequiredItem | null;
  readonly onClose: () => void;
  readonly onCloseFocusTrigger: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <Dialog
      open={item !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        ref={contentRef}
        data-surface="inverted"
        className={consentPolicyDialogClassName}
        overlayClassName="bg-cosmos-void/80 backdrop-blur-none"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onCloseFocusTrigger();
        }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-cosmos-border px-5 sm:py-3">
          <DialogTitle className="font-heading text-lg font-semibold text-cosmos-copy">
            {item?.label} 전문
          </DialogTitle>
          <DialogClose asChild>
            <ConsentPolicyCloseButton />
          </DialogClose>
        </div>
        <DialogDescription className="sr-only">
          {item?.label}의 전체 내용을 확인합니다.
        </DialogDescription>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {item ? (
            <ConsentPolicyDocumentFrame
              item={item}
              className="h-full min-h-[52dvh]"
            />
          ) : null}
        </div>
        <div className="flex shrink-0 justify-end border-t border-cosmos-border px-5 sm:py-3">
          <DialogClose asChild>
            <Button
              className="border-cosmos-border text-cosmos-copy hover:bg-cosmos-muted/10 hover:text-cosmos-copy"
              type="button"
              variant="outline"
            >
              닫기
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
