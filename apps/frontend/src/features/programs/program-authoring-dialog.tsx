'use client';

import { useRef, type ReactNode, type RefObject } from 'react';
import { Dialog } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ProgramAuthoringDialogBaseProps {
  readonly title: string;
  readonly description?: string | null;
  readonly children: ReactNode;
  readonly size?: 'md' | 'lg';
  readonly className?: string;
  readonly bodyClassName?: string;
  /**
   * 되돌릴 수 없는 요청이 도는 동안에는 닫기(Escape·바깥 클릭·취소)를 막는다.
   * 진행 중인 요청을 화면만 먼저 지우면 학생은 결과를 볼 자리를 잃는다.
   */
  readonly busy?: boolean;
  /**
   * 닫은 뒤 초점을 되돌릴 트리거. 넘기지 않으면 Radix 기본 복원을 그대로 둔다 —
   * 기존 작성 다이얼로그 호출부의 동작을 바꾸지 않기 위해서다.
   */
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  readonly onCancel: () => void;
}

/**
 * 바닥 줄은 둘 중 하나다. 저장 다이얼로그는 지금처럼 `onSave`를 주고, 저장이라는
 * 개념이 없는 다이얼로그(예: 초대 검색)는 `footer`로 자기 버튼 줄을 직접 준다.
 * 아무 일도 하지 않는 `onSave`를 넘겨 저장 버튼을 숨기는 편법을 막는다.
 */
type ProgramAuthoringDialogFooterProps =
  | {
      readonly onSave: () => void;
      readonly confirmLabel?: string;
      readonly footer?: never;
    }
  | {
      readonly footer: ReactNode;
      readonly onSave?: never;
      readonly confirmLabel?: never;
    };

export type ProgramAuthoringDialogProps = ProgramAuthoringDialogBaseProps &
  ProgramAuthoringDialogFooterProps;

export function ProgramAuthoringDialog(props: ProgramAuthoringDialogProps) {
  const {
    title,
    description,
    children,
    size = 'md',
    className,
    bodyClassName,
    busy = false,
    returnFocusRef,
    onCancel,
  } = props;
  const blockNextClose = useRef(false);

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (open) return;
        if (busy) return;
        if (blockNextClose.current) {
          blockNextClose.current = false;
          return;
        }
        onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/35" />
        <Dialog.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card border border-border bg-background p-card shadow-xl outline-none',
            size === 'lg' ? 'max-w-2xl' : 'max-w-xl',
            className,
          )}
          onEscapeKeyDown={(event) => {
            if (busy) {
              event.preventDefault();
              return;
            }
            const escapeTarget = event.target;
            if (
              (escapeTarget instanceof HTMLElement &&
                escapeTarget.hasAttribute('data-keep-dialog-on-escape')) ||
              (document.activeElement instanceof HTMLElement &&
                document.activeElement.hasAttribute(
                  'data-keep-dialog-on-escape',
                ))
            )
              blockNextClose.current = true;
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
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          {description ? (
            <Dialog.Description className="mt-1 text-small text-muted-foreground">
              {description}
            </Dialog.Description>
          ) : null}
          <div
            className={cn(
              'mt-5 grid min-h-0 gap-5 overflow-y-auto pr-1',
              bodyClassName,
            )}
          >
            {children}
          </div>
          <div className="mt-5 flex justify-end gap-2">
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
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
