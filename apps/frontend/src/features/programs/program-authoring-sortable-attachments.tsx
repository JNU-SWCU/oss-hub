'use client';

import { GripVertical } from 'lucide-react';
import {
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import type { ProgramAuthoringRequirement } from './program-authoring-model';
import {
  milestoneDocumentDropZones,
  milestoneDocumentDropTarget,
  type MilestoneDocumentDropZone,
} from './milestone-document-pointer';

interface DragPosition {
  readonly activeId: string;
  readonly overId: string | null;
  readonly pointerId: number | null;
  readonly dropZones: readonly MilestoneDocumentDropZone[];
}

export function ProgramAuthoringSortableAttachments({
  milestoneId,
  requirements,
  children,
  onReorder,
}: {
  readonly milestoneId: string;
  readonly requirements: readonly ProgramAuthoringRequirement[];
  readonly children: (
    requirement: ProgramAuthoringRequirement,
    reorderHandle: ReactNode,
  ) => ReactNode;
  readonly onReorder: (requirementIds: readonly string[]) => void;
}) {
  const [drag, setDrag] = useState<DragPosition | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const instructionsId = `milestone-${milestoneId}-attachment-reorder-instructions`;
  const reorderDisabled = requirements.length < 2;
  const previewOrder =
    drag?.overId === null || drag === null || drag.pointerId !== null
      ? null
      : plannedOrder(requirements, drag.activeId, drag.overId);
  const displayedRequirements = orderByIds(requirements, previewOrder);

  function announcePosition(requirementId: string, overId: string) {
    const requirement = requirements.find((item) => item.id === requirementId);
    const planned = plannedOrder(requirements, requirementId, overId);
    const position =
      planned?.findIndex((candidateId) => candidateId === requirementId) ??
      positionOf(requirements, requirementId);
    if (requirement) {
      setAnnouncement(
        `${requirement.name} 항목을 ${position + 1}번째로 옮겼습니다.`,
      );
    }
  }

  function start(
    requirementId: string,
    pointerId: number | null,
    dropZones: readonly MilestoneDocumentDropZone[] = [],
  ) {
    if (reorderDisabled) return;
    setDrag({
      activeId: requirementId,
      overId: requirementId,
      pointerId,
      dropZones,
    });
    const requirement = requirements.find((item) => item.id === requirementId);
    if (requirement) {
      setAnnouncement(
        `${requirement.name} 항목을 집었습니다. 원하는 위치로 옮긴 뒤 놓으세요.`,
      );
    }
  }

  function cancel() {
    if (drag !== null) setAnnouncement('순서 이동을 취소했습니다.');
    setDrag(null);
  }

  function commit(activeId: string, overId: string | null) {
    const requirementIds =
      overId === null ? null : plannedOrder(requirements, activeId, overId);
    setDrag(null);
    if (requirementIds === null) return;
    onReorder(requirementIds);
    const requirement = requirements.find((item) => item.id === activeId);
    setAnnouncement(
      `${requirement?.name ?? '첨부파일'} 항목 순서를 저장했습니다.`,
    );
  }

  function overFromPoint(event: PointerEvent<HTMLButtonElement>) {
    if (drag === null || drag.pointerId !== event.pointerId) return;
    const overId = milestoneDocumentDropTarget(drag.dropZones, {
      x: event.clientX,
      y: event.clientY,
    });
    if (overId && drag.overId !== overId)
      announcePosition(drag.activeId, overId);
    setDrag({ ...drag, overId });
  }

  function handlePointerDown(
    event: PointerEvent<HTMLButtonElement>,
    requirementId: string,
  ) {
    if (event.button !== 0 || reorderDisabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rows =
      event.currentTarget
        .closest('ul')
        ?.querySelectorAll<HTMLElement>('[data-sortable-document-id]') ?? [];
    start(requirementId, event.pointerId, milestoneDocumentDropZones(rows));
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
    commit(drag.activeId, overId);
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    requirementId: string,
  ) {
    if (reorderDisabled) return;
    if (drag === null) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      start(requirementId, null);
      return;
    }
    if (drag.activeId !== requirementId) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      commit(drag.activeId, drag.overId);
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const currentIndex = positionOf(requirements, drag.overId ?? drag.activeId);
    const next =
      requirements[currentIndex + (event.key === 'ArrowUp' ? -1 : 1)];
    if (!next) return;
    setDrag({ ...drag, overId: next.id });
    announcePosition(drag.activeId, next.id);
  }

  return (
    <>
      <p id={instructionsId} className="sr-only">
        {requirements.length < 2
          ? '첨부파일이 2개 이상이면 왼쪽 손잡이로 순서를 바꿀 수 있습니다.'
          : '왼쪽 손잡이를 끌어 순서를 바꾸세요. 키보드는 Enter로 집고 방향키로 옮긴 뒤 Enter로 놓습니다.'}
      </p>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <ul
        className="grid gap-2"
        data-testid="program-authoring-attachment-rows"
      >
        {displayedRequirements.map((requirement) => {
          const isActive = drag?.activeId === requirement.id;
          const isPointerTarget =
            drag?.pointerId !== null &&
            drag?.overId === requirement.id &&
            !isActive;
          return (
            <li
              key={requirement.id}
              data-sortable-document-id={requirement.id}
              className={
                isActive
                  ? 'relative z-10 scale-[1.01] shadow-md'
                  : isPointerTarget
                    ? 'rounded-control ring-2 ring-primary/30 ring-offset-2'
                    : undefined
              }
            >
              {children(
                requirement,
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="touch-none cursor-grab active:cursor-grabbing"
                  disabled={reorderDisabled}
                  aria-label={`${requirement.name} 순서 이동`}
                  aria-describedby={instructionsId}
                  aria-pressed={isActive}
                  onKeyDown={(event) => handleKeyDown(event, requirement.id)}
                  onPointerDown={(event) =>
                    handlePointerDown(event, requirement.id)
                  }
                  onPointerMove={overFromPoint}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={cancel}
                >
                  <GripVertical aria-hidden />
                </Button>,
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function plannedOrder(
  requirements: readonly ProgramAuthoringRequirement[],
  activeId: string,
  overId: string,
): readonly string[] | null {
  const activeIndex = positionOf(requirements, activeId);
  const overIndex = positionOf(requirements, overId);
  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex)
    return null;
  const ids = requirements.map((requirement) => requirement.id);
  const [moved] = ids.splice(activeIndex, 1);
  if (moved === undefined) return null;
  ids.splice(overIndex, 0, moved);
  return ids;
}

function orderByIds(
  requirements: readonly ProgramAuthoringRequirement[],
  ids: readonly string[] | null,
): readonly ProgramAuthoringRequirement[] {
  if (ids === null) return requirements;
  const byId = new Map(
    requirements.map((requirement) => [requirement.id, requirement]),
  );
  const ordered = ids.flatMap((id) => {
    const requirement = byId.get(id);
    return requirement === undefined ? [] : [requirement];
  });
  return ordered.length === requirements.length ? ordered : requirements;
}

function positionOf(
  requirements: readonly ProgramAuthoringRequirement[],
  requirementId: string,
): number {
  return requirements.findIndex(
    (requirement) => requirement.id === requirementId,
  );
}
