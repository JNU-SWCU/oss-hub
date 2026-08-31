'use client';

import { GripVertical } from 'lucide-react';
import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Button } from '@/components/ui/button';
import type { MilestoneDocument } from './milestone-document-api';
import { planMilestoneDocumentOrder } from './milestone-document-editor-flow';
import { MilestoneDocumentRow } from './milestone-document-row';
import {
  milestoneDocumentDropZones,
  milestoneDocumentDropTarget,
  type MilestoneDocumentDropZone,
} from './milestone-document-pointer';
import {
  milestoneDocumentPosition,
  orderMilestoneDocumentsByIds,
} from './milestone-document-sortable-flow';
import type {
  MilestoneDocumentDragPosition,
  MilestoneDocumentSortableListProps,
} from './milestone-document-sortable-types';

export function MilestoneDocumentSortableList({
  milestoneId,
  documents,
  isBusy,
  deleteTargetId,
  rowError,
  onReorder,
  onEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onTemplateFile,
}: MilestoneDocumentSortableListProps) {
  const [drag, setDrag] = useState<MilestoneDocumentDragPosition | null>(null);
  const [pendingOrder, setPendingOrder] = useState<readonly string[] | null>(
    null,
  );
  const [announcement, setAnnouncement] = useState('');
  const instructionsId = `milestone-${milestoneId}-document-reorder-instructions`;
  const previewOrder =
    drag?.overId === null || drag === null || drag.pointerId !== null
      ? null
      : planMilestoneDocumentOrder(documents, drag.activeId, drag.overId);
  const displayedDocuments = orderMilestoneDocumentsByIds(
    documents,
    pendingOrder ?? previewOrder,
  );
  const rowBusy = isBusy || pendingOrder !== null;
  const reorderDisabled = rowBusy || documents.length < 2;

  function announcePosition(documentId: string, overId: string) {
    const document = documents.find((item) => item.id === documentId);
    const planned = planMilestoneDocumentOrder(documents, documentId, overId);
    const position =
      planned?.findIndex((candidateId) => candidateId === documentId) ??
      milestoneDocumentPosition(documents, documentId);
    if (document) {
      setAnnouncement(
        `${document.name} 항목을 ${position + 1}번째로 옮겼습니다.`,
      );
    }
  }

  function start(
    documentId: string,
    pointerId: number | null,
    dropZones: readonly MilestoneDocumentDropZone[] = [],
  ) {
    if (reorderDisabled) return;
    setDrag({ activeId: documentId, overId: documentId, pointerId, dropZones });
    const document = documents.find((item) => item.id === documentId);
    if (document) {
      setAnnouncement(
        `${document.name} 항목을 집었습니다. 원하는 위치로 옮긴 뒤 놓으세요.`,
      );
    }
  }

  function cancel() {
    if (drag !== null) setAnnouncement('순서 이동을 취소했습니다.');
    setDrag(null);
  }

  async function commit(activeId: string, overId: string | null) {
    const documentIds =
      overId === null
        ? null
        : planMilestoneDocumentOrder(documents, activeId, overId);
    setDrag(null);
    if (documentIds === null) return;
    setPendingOrder(documentIds);
    const document = documents.find((item) => item.id === activeId);
    setAnnouncement(
      `${document?.name ?? '제출'} 항목 순서를 저장하고 있습니다.`,
    );
    let saved = false;
    try {
      saved = await onReorder(documentIds, activeId);
    } catch {
      saved = false;
    } finally {
      setPendingOrder(null);
    }
    setAnnouncement(
      saved
        ? `${document?.name ?? '제출'} 항목 순서를 저장했습니다.`
        : '순서를 저장하지 못했습니다. 안내를 확인하고 다시 시도해 주세요.',
    );
  }

  function overFromPoint(event: PointerEvent<HTMLButtonElement>) {
    if (drag === null || drag.pointerId !== event.pointerId) return;
    const overId = milestoneDocumentDropTarget(drag.dropZones, {
      x: event.clientX,
      y: event.clientY,
    });
    if (overId && drag.overId !== overId) {
      announcePosition(drag.activeId, overId);
    }
    setDrag({ ...drag, overId });
  }

  function handlePointerDown(
    event: PointerEvent<HTMLButtonElement>,
    documentId: string,
  ) {
    if (event.button !== 0 || reorderDisabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rows =
      event.currentTarget
        .closest('ul')
        ?.querySelectorAll<HTMLElement>('[data-sortable-document-id]') ?? [];
    const dropZones = milestoneDocumentDropZones(rows);
    start(documentId, event.pointerId, dropZones);
  }

  function handlePointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (drag === null || drag.pointerId !== event.pointerId) return;
    const overId = milestoneDocumentDropTarget(drag.dropZones, {
      x: event.clientX,
      y: event.clientY,
    });
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    void commit(drag.activeId, overId);
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    documentId: string,
  ) {
    if (reorderDisabled) return;
    if (drag === null) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      start(documentId, null);
      return;
    }
    if (drag.activeId !== documentId) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void commit(drag.activeId, drag.overId);
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const currentIndex = milestoneDocumentPosition(
      documents,
      drag.overId ?? drag.activeId,
    );
    const offset = event.key === 'ArrowUp' ? -1 : 1;
    const next = documents[currentIndex + offset];
    if (!next) return;
    setDrag({ ...drag, overId: next.id });
    announcePosition(drag.activeId, next.id);
  }

  return (
    <>
      <p
        id={instructionsId}
        className="text-small text-muted-foreground break-keep"
      >
        {documents.length < 2 ? (
          '제출 항목이 2개 이상이면 왼쪽 손잡이를 끌어 순서를 바꿀 수 있습니다.'
        ) : (
          <>
            항목 왼쪽의 손잡이를 끌어 순서를 바꾸세요. 키보드는 손잡이에서
            Enter를 누른 뒤 방향키로 옮기고{' '}
            <span className="whitespace-nowrap">Enter로 놓습니다.</span>
          </>
        )}
      </p>
      {documents.length === 1 ? (
        <p className="text-small text-muted-foreground break-keep">
          마일스톤에는 제출 항목이 하나 이상 필요해 마지막 항목은 삭제할 수
          없습니다. 바꾸려면 새 항목을 먼저 추가하세요.
        </p>
      ) : null}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <ul className="grid gap-2" data-testid="milestone-document-editor-rows">
        {displayedDocuments.map((document) => {
          const isActive = drag?.activeId === document.id;
          const isPointerTarget =
            drag?.pointerId !== null &&
            drag?.overId === document.id &&
            !isActive;
          return (
            <li
              key={document.id}
              data-sortable-document-id={document.id}
              data-testid="milestone-document-editor-row"
              className={
                isActive
                  ? 'relative z-10 scale-[1.01] shadow-md'
                  : isPointerTarget
                    ? 'rounded-control ring-2 ring-primary/30 ring-offset-2'
                    : undefined
              }
            >
              <MilestoneDocumentRow
                document={document}
                isBusy={rowBusy || drag !== null}
                deleteRequested={deleteTargetId === document.id}
                deleteDisabled={documents.length === 1}
                errorMessage={
                  rowError?.documentId === document.id ? rowError.message : null
                }
                reorderHandle={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="touch-none cursor-grab active:cursor-grabbing"
                    disabled={reorderDisabled}
                    aria-label={`${document.name} 순서 이동`}
                    aria-describedby={instructionsId}
                    aria-pressed={isActive}
                    onKeyDown={(event) => handleKeyDown(event, document.id)}
                    onPointerDown={(event) =>
                      handlePointerDown(event, document.id)
                    }
                    onPointerMove={overFromPoint}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={cancel}
                  >
                    <GripVertical aria-hidden />
                  </Button>
                }
                onEdit={onEdit}
                onRequestDelete={onRequestDelete}
                onCancelDelete={onCancelDelete}
                onConfirmDelete={onConfirmDelete}
                onTemplateFile={onTemplateFile}
              />
            </li>
          );
        })}
      </ul>
    </>
  );
}
