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

/**
 * 공용 창 껍데기(R-06). 제목 · 설명 · 위에서 아래로 흐르는 본문 · 버튼 줄을 한 자리에서
 * 정하고, 오버레이·크기·저장 중 닫기 차단·초점 복귀를 소유한다.
 *
 * 바닥 줄은 둘 중 하나다. 저장 창은 `onSave`를 주면 「취소 · 저장」이 붙고, 저장이라는
 * 개념이 없는 창(예: 초대 검색)은 `footer`로 자기 버튼 줄을 직접 준다.
 * 아무 일도 하지 않는 `onSave`를 넘겨 저장 버튼을 숨기는 편법을 막는다.
 *
 * `kind="alert"`는 되돌릴 수 없는 일을 확인받는 창이다. 낭독기에 `alertdialog`로
 * 알리고 바깥 클릭으로 닫히지 않게 한다 — 실수로 흘려보내면 안 되는 질문이라
 * 명시적으로 답하게 한다. Radix `AlertDialog`로 갈아타지 않고 역할과 닫기 규칙만
 * 바꾼다. 두 벌을 유지하면 초점 복귀·저장 중 닫기 차단 같은 규칙이 곧 갈라진다.
 */
interface DialogShellBaseProps {
  readonly title: string;
  readonly description?: string | null;
  readonly children: React.ReactNode;
  /** md = 최대 폭 xl, lg = 최대 폭 2xl. 폭 외의 시각은 같다. */
  readonly size?: 'md' | 'lg';
  /**
   * `alert`는 되돌릴 수 없는 일을 확인받는 창이다. `role="alertdialog"`가 되고
   * 바깥 클릭으로 닫히지 않는다. Escape 와 취소는 그대로 닫는다 — 빠져나갈
   * 길까지 막으면 갇힌다.
   */
  readonly kind?: 'dialog' | 'alert';
  readonly className?: string;
  readonly bodyClassName?: string;
  /**
   * 되돌릴 수 없는 요청이 도는 동안에는 닫기(Escape·바깥 클릭·취소)를 막는다.
   * 진행 중인 요청을 화면만 먼저 지우면 사용자는 결과를 볼 자리를 잃는다.
   */
  readonly busy?: boolean;
  /**
   * 닫은 뒤 초점을 되돌릴 트리거. 넘기지 않으면 Radix 기본 복원을 그대로 둔다.
   */
  readonly returnFocusRef?: React.RefObject<HTMLElement | null>;
  /** 열림 여부. 기본 true — 호출부가 조건부 렌더로 열고 닫는 기존 관행을 그대로 받는다. */
  readonly open?: boolean;
  /** Escape · 바깥 클릭 · 취소로 닫으려 할 때. busy 중에는 부르지 않는다. */
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
        /*
         * `role`을 조건부로만 편다. Radix 는 자기 `role: 'dialog'` **뒤에**
         * contentProps 를 펼치므로(react-dialog dist/index.mjs:222-227),
         * `role={undefined}` 를 넘기면 기본 역할이 지워진다.
         */
        {...(kind === 'alert' ? { role: 'alertdialog' as const } : {})}
        showCloseButton={false}
        onPointerDownOutside={(event) => {
          // 되돌릴 수 없는 질문은 바깥을 잘못 눌러 사라지지 않는다.
          if (kind === 'alert') event.preventDefault();
        }}
        // 오버레이는 기존 창들과 같은 어두운 반투명이다(동규 결정, 2026-09-19). 흐림은 쓰지 않는다.
        overlayClassName="bg-foreground/35 backdrop-blur-none"
        className={cn(
          'flex flex-col gap-0 overflow-hidden p-card',
          SIZE_CLASS[size],
          className,
        )}
        onEscapeKeyDown={(event) => {
          if (busy) {
            event.preventDefault();
            return;
          }
          // 달력처럼 Escape를 자기 것으로 쓰는 컨트롤 위에서는 창을 닫지 않는다.
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
          data-slot="dialog-shell-footer"
          // 좁은 폭에서도 버튼 줄을 세로로 쌓지 않는다 — 기존 창들과 같은 오른쪽 정렬 한 줄.
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
