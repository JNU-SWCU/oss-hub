'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertDialog, Dialog } from 'radix-ui';
import { Button } from '@/components/ui/button';
import type {
  ProgramMilestoneEditor,
  ProgramMilestoneField,
} from './program-edit-flow';
import { ProgramEditMilestoneForm } from './program-edit-milestone-form';
import { isMilestoneFormDirty } from './program-edit-state';
import type { ProgramScheduleCalendarEvent } from './program-schedule-calendar-model';

type EditMilestoneEditor = Extract<ProgramMilestoneEditor, { mode: 'edit' }>;

export function ProgramEditMilestoneDialog({
  editor,
  operationStartAt,
  operationEndAt,
  contextEvents,
  isBusy,
  returnFocusRef,
  onCancel,
  onFieldChange,
  onSave,
}: {
  readonly editor: EditMilestoneEditor;
  readonly operationStartAt: string;
  readonly operationEndAt: string;
  readonly contextEvents: readonly ProgramScheduleCalendarEvent[];
  readonly isBusy: boolean;
  readonly returnFocusRef?: React.RefObject<HTMLElement | null>;
  readonly onCancel: () => void;
  readonly onFieldChange: (field: ProgramMilestoneField, value: string) => void;
  readonly onSave: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const [discardOpen, setDiscardOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (Object.keys(editor.errors).length === 0) return;
    const firstInvalidField =
      contentRef.current?.querySelector<HTMLElement>(
        '[id^="milestone-"][aria-invalid="true"]:not(:disabled), [data-testid="program-schedule-calendar-scroll"][aria-invalid="true"]',
      ) ?? null;
    firstInvalidField?.focus({ preventScroll: true });
    firstInvalidField?.scrollIntoView?.({ block: 'center' });
  }, [editor.errors]);

  const requestClose = () => {
    if (isMilestoneFormDirty(editor.initialForm, editor.form)) {
      setDiscardOpen(true);
      return;
    }
    onCancel();
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && requestClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/40" />
        <Dialog.Content
          ref={contentRef}
          className="fixed inset-0 z-50 flex h-[100dvh] w-full flex-col overflow-hidden bg-background outline-none sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-[min(90dvh,46rem)] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-card sm:border sm:border-border sm:shadow-lg"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusRef?.current?.focus();
          }}
        >
          <Dialog.Title className="shrink-0 border-b border-border px-card py-5 font-heading text-section font-semibold tracking-[-0.02em]">
            {editor.form.name} 수정
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            마일스톤 일정과 제출 안내를 수정합니다.
          </Dialog.Description>
          <ProgramEditMilestoneForm
            editor={editor}
            operationStartAt={operationStartAt}
            operationEndAt={operationEndAt}
            contextEvents={contextEvents}
            isBusy={isBusy}
            layout="dialog"
            onCancel={requestClose}
            onFieldChange={onFieldChange}
            onSave={onSave}
          />
        </Dialog.Content>
      </Dialog.Portal>
      <AlertDialog.Root open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-foreground/45" />
          <AlertDialog.Content className="fixed top-1/2 left-1/2 z-[60] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-card border border-border bg-background p-card shadow-lg outline-none">
            <AlertDialog.Title className="font-heading text-section font-semibold">
              변경사항을 폐기할까요?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-small text-muted-foreground">
              저장하지 않은 마일스톤 변경사항은 복구할 수 없습니다.
            </AlertDialog.Description>
            <div className="mt-6 flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button type="button" variant="outline">
                  계속 편집
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button type="button" variant="destructive" onClick={onCancel}>
                  폐기
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </Dialog.Root>
  );
}
