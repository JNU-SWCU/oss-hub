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
import { isLocalMilestoneDocumentsDirty } from './milestone-document-editor-flow';
import type { ProgramScheduleCalendarEvent } from './program-schedule-calendar-model';
import type { EditableMilestoneEditSnapshot } from './api';
import { LocalMilestoneDocumentsEditor } from './milestone-document-editor';
import {
  toProgramMilestoneDraft,
  toDateTimeLocal,
  type ProgramMilestoneDraft,
} from './program-edit-flow';

type EditMilestoneEditor = Extract<ProgramMilestoneEditor, { mode: 'edit' }>;

function restoreFocusAfterClose(target: HTMLElement | null | undefined) {
  window.requestAnimationFrame(() => target?.focus());
}

export function ProgramEditMilestoneDialog({
  editor,
  operationStartAt,
  operationEndAt,
  contextEvents,
  isBusy,
  snapshot,
  latestSnapshot,
  snapshotLoadFailed = false,
  returnFocusRef,
  onCancel,
  onFieldChange,
  onSave,
  onRefresh,
  onRestartFromLatest,
  onDocumentsDirtyChange,
}: {
  readonly editor: EditMilestoneEditor;
  readonly operationStartAt: string;
  readonly operationEndAt: string;
  readonly contextEvents: readonly ProgramScheduleCalendarEvent[];
  readonly isBusy: boolean;
  readonly snapshot?: EditableMilestoneEditSnapshot | null;
  readonly latestSnapshot?: EditableMilestoneEditSnapshot | null;
  readonly snapshotLoadFailed?: boolean;
  readonly returnFocusRef?: React.RefObject<HTMLElement | null>;
  readonly onCancel: () => void;
  readonly onFieldChange: (field: ProgramMilestoneField, value: string) => void;
  readonly onSave: (
    event: React.FormEvent<HTMLFormElement>,
    documents?: ProgramMilestoneDraft['documents'],
  ) => void;
  readonly onRefresh?: () => void;
  readonly onRestartFromLatest?: (
    snapshot: EditableMilestoneEditSnapshot,
  ) => void;
  readonly onDocumentsDirtyChange?: (dirty: boolean) => void;
}) {
  const [discardOpen, setDiscardOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const editorFocusRef = useRef<HTMLElement | null>(null);
  const discardingRef = useRef(false);
  const [draft, setDraft] = useState<ProgramMilestoneDraft | null>(() => {
    return snapshot === null || snapshot === undefined
      ? null
      : toProgramMilestoneDraft(snapshot);
  });

  useEffect(() => {
    if (draft === null && snapshot !== null && snapshot !== undefined)
      setDraft(toProgramMilestoneDraft(snapshot));
  }, [draft, snapshot]);

  useEffect(() => {
    onDocumentsDirtyChange?.(
      draft !== null && isLocalMilestoneDocumentsDirty(draft.documents),
    );
  }, [draft, onDocumentsDirtyChange]);

  useEffect(() => {
    if (Object.keys(editor.errors).length === 0) return;
    const firstInvalidField =
      contentRef.current?.querySelector<HTMLElement>(
        '[id^="milestone-"][aria-invalid="true"]:not(:disabled), [data-testid="program-schedule-calendar-scroll"][aria-invalid="true"]',
      ) ?? null;
    firstInvalidField?.focus({ preventScroll: true });
    firstInvalidField?.scrollIntoView?.({ block: 'center' });
  }, [editor.errors]);

  const closeEditor = () => {
    const returnTarget = returnFocusRef?.current;
    onCancel();
    restoreFocusAfterClose(returnTarget);
  };

  const requestClose = () => {
    if (isBusy) return;
    if (
      isMilestoneFormDirty(editor.initialForm, editor.form) ||
      (draft !== null && isLocalMilestoneDocumentsDirty(draft.documents))
    ) {
      discardingRef.current = false;
      const activeElement = document.activeElement;
      editorFocusRef.current =
        activeElement instanceof HTMLElement &&
        contentRef.current?.contains(activeElement)
          ? activeElement
          : contentRef.current;
      setDiscardOpen(true);
      return;
    }
    closeEditor();
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && requestClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/40" />
        <Dialog.Content
          ref={contentRef}
          className="fixed inset-0 z-50 flex h-[100dvh] w-full flex-col overflow-hidden bg-background outline-none sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-[min(90dvh,46rem)] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-card sm:border sm:border-border sm:shadow-lg"
          onEscapeKeyDown={(event) => {
            const active = document.activeElement;
            if (
              active instanceof HTMLElement &&
              active.hasAttribute('data-keep-dialog-on-escape')
            )
              event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusRef?.current?.focus();
          }}
        >
          <Dialog.Title className="shrink-0 border-b border-border px-card py-5 font-heading text-section font-semibold tracking-[-0.02em]">
            {snapshot === null || snapshot === undefined
              ? '마일스톤 수정'
              : `${editor.form.name} 수정`}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            마일스톤 일정과 제출 안내를 수정합니다.
          </Dialog.Description>
          {snapshot === null || snapshot === undefined ? (
            <div className="flex min-h-0 flex-1 flex-col justify-between px-card py-5">
              <p className="text-small text-muted-foreground" role="status">
                {snapshotLoadFailed
                  ? '제출 항목과 최신 마일스톤 정보를 불러오지 못했습니다.'
                  : '제출 항목과 최신 마일스톤 정보를 불러오는 중입니다.'}
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={requestClose}>
                  취소
                </Button>
                <Button type="button" variant="outline" onClick={onRefresh}>
                  새로고침
                </Button>
              </div>
            </div>
          ) : (
            <ProgramEditMilestoneForm
              editor={editor}
              operationStartAt={toDateTimeLocal(snapshot.operation.startAt)}
              operationEndAt={toDateTimeLocal(snapshot.operation.endAt)}
              contextEvents={[
                {
                  id: 'operation',
                  label: '운영 기간',
                  kind: 'OPERATION',
                  startAt: toDateTimeLocal(snapshot.operation.startAt),
                  endAt: toDateTimeLocal(snapshot.operation.endAt),
                },
                {
                  id: editor.form.id ?? 'new-milestone',
                  label: editor.form.name || '새 마일스톤',
                  kind: 'MILESTONE',
                  startAt: editor.form.startAt,
                  endAt: editor.form.dueAt,
                },
              ]}
              isBusy={isBusy}
              isSaveDisabled={Boolean(editor.blocked)}
              layout="dialog"
              onCancel={requestClose}
              onFieldChange={onFieldChange}
              onSave={(event) => onSave(event, draft?.documents)}
            >
              {editor.blocked ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onRefresh}
                >
                  새로고침
                </Button>
              ) : null}
              {draft !== null && snapshot !== null && snapshot !== undefined ? (
                <div>
                  <LocalMilestoneDocumentsEditor
                    milestoneId={draft.id}
                    documents={draft.documents}
                    fileUpload={snapshot.fileUpload}
                    onChange={(documents) =>
                      setDraft((current) =>
                        current === null ? current : { ...current, documents },
                      )
                    }
                  />
                </div>
              ) : null}
              {editor.errors.general &&
              latestSnapshot !== null &&
              latestSnapshot !== undefined ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDraft(toProgramMilestoneDraft(latestSnapshot));
                    onRestartFromLatest?.(latestSnapshot);
                  }}
                >
                  최신 서버 상태로 다시 시작
                </Button>
              ) : null}
            </ProgramEditMilestoneForm>
          )}
        </Dialog.Content>
      </Dialog.Portal>
      <AlertDialog.Root
        open={discardOpen}
        onOpenChange={(open) => {
          setDiscardOpen(open);
          if (!open && !discardingRef.current) {
            restoreFocusAfterClose(editorFocusRef.current);
          }
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-foreground/45" />
          <AlertDialog.Content
            className="fixed top-1/2 left-1/2 z-[60] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-card border border-border bg-background p-card shadow-lg outline-none"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
            }}
          >
            {/*
              제목이 결과를 직접 말한다 — 「저장하지 않은 변경」이 사라진다는 사실이 제목에
              들어 있으므로 같은 말을 반복하는 설명문을 따로 두지 않는다. 종전에는
              제목·본문·버튼이 「변경사항」을 세 번 말했다.

              단, 가역성 고지 자체를 없애지는 않는다 — 되돌릴 수 없는 행동은 그 사실을
              반드시 알려야 한다. 그래서 제목이 「버릴까요」로 결과를 드러낸다.
              `AlertDialog.Description` 은 radix 가 `aria-describedby` 로 쓰므로
              제거하지 않고 버튼이 무엇을 하는지만 짧게 남긴다.
            */}
            <AlertDialog.Title className="font-heading text-section font-semibold">
              저장하지 않은 변경을 버릴까요?
            </AlertDialog.Title>
            <AlertDialog.Description className="sr-only">
              버리면 되돌릴 수 없습니다.
            </AlertDialog.Description>
            <div className="mt-6 flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button type="button" variant="outline">
                  계속 편집
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    discardingRef.current = true;
                    closeEditor();
                  }}
                >
                  버리기
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </Dialog.Root>
  );
}
