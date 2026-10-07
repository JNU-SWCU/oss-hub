'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface DialogShellBaseProps {
  readonly title: string;
  readonly description?: string | null;
  readonly children: React.ReactNode;

  readonly size?: 'md' | 'lg';

  readonly kind?: 'dialog' | 'alert';
  readonly className?: string;
  readonly bodyClassName?: string;

  readonly busy?: boolean;

  readonly returnFocusRef?: React.RefObject<HTMLElement | null>;

  readonly open?: boolean;

  readonly onCancel: () => void;
}

type DialogShellFooterProps =
  | {
      readonly onSave: () => void;
      readonly confirmLabel?: string;
      readonly footer?: never;
    }
  | {
      readonly footer: React.ReactNode;
      readonly onSave?: never;
      readonly confirmLabel?: never;
    };

export type DialogShellProps = DialogShellBaseProps & DialogShellFooterProps;

const SIZE_CLASS = {
  md: 'max-w-xl',
  lg: 'max-w-2xl',
} as const;

function DialogShell(props: DialogShellProps) {
  const {
    title,
    description,
    children,
    size = 'md',
    kind = 'dialog',
    className,
    bodyClassName,
    busy = false,
    returnFocusRef,
    open = true,
    onCancel,
  } = props;
  const blockNextClose = React.useRef(false);
  const footerRef = React.useRef<HTMLDivElement>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next || busy) return;
        if (blockNextClose.current) {
          blockNextClose.current = false;
          return;
        }
        onCancel();
      }}
    >
      <DialogContent
        data-slot="dialog-shell"
        data-size={size}
        data-kind={kind}

        {...(kind === 'alert' ? { role: 'alertdialog' as const } : {})}
        showCloseButton={false}
        onPointerDownOutside={(event) => {
          if (kind === 'alert') event.preventDefault();
        }}

        overlayClassName="bg-foreground/35 backdrop-blur-none"
        className={cn(
          'flex flex-col gap-0 overflow-hidden p-card',
          SIZE_CLASS[size],
          className,
        )}
        onOpenAutoFocus={(event) => {
          if (kind !== 'alert') return;

          const cancelButton =
            footerRef.current?.querySelector<HTMLButtonElement>('button');
          if (!cancelButton) return;
          event.preventDefault();
          cancelButton.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (busy) {
            event.preventDefault();
            return;
          }

          const keepOpen = (node: EventTarget | Element | null) =>
            node instanceof HTMLElement &&
            node.hasAttribute('data-keep-dialog-on-escape');
          if (keepOpen(event.target) || keepOpen(document.activeElement)) {
            blockNextClose.current = true;
          }
          if (blockNextClose.current) {
            event.preventDefault();
            queueMicrotask(() => {
              blockNextClose.current = false;
            });
          }
        }}
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef) return;
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        {description ? (
          <DialogDescription className="mt-1 text-small">
            {description}
          </DialogDescription>
        ) : null}
        <div
          data-slot="dialog-shell-body"
          className={cn(
            'mt-5 grid min-h-0 gap-5 overflow-y-auto pr-1',
            bodyClassName,
          )}
        >
          {children}
        </div>
        <DialogFooter
          ref={footerRef}
          data-slot="dialog-shell-footer"

          className="mt-5 flex-row justify-end"
        >
          {props.footer !== undefined ? (
            props.footer
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onCancel}
              >
                취소
              </Button>
              <Button type="button" disabled={busy} onClick={props.onSave}>
                {props.confirmLabel ?? '저장'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { DialogShell };
