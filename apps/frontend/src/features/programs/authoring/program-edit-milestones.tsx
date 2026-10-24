'use client';

import { useRef } from 'react';
import { DialogShell } from '@/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type {
  EditableMilestone,
  EditableMilestoneEditSnapshot,
  EditableMilestoneDocument,
} from './dto';
import {
  type ProgramMilestoneEditor,
  type ProgramMilestoneField,
  type ProgramMilestoneDraft,
} from './program-edit-flow';
import { ReadOnlyMilestoneDocuments } from '../documents/milestone-document-editor';
import { formatSeoulShortRange } from '../catalog/program-detail-format';
import { ProgramEditMilestoneForm } from './program-edit-milestone-form';
import type { ProgramScheduleCalendarEvent } from './program-schedule-calendar-model';
import { ProgramEditMilestoneDialog } from './program-edit-milestone-dialog';
import { ProgramMilestoneCard } from './program-milestone-card';
interface ProgramEditMilestonesProps {
  readonly milestones: readonly EditableMilestone[];
  readonly editor: ProgramMilestoneEditor;
  readonly editTriggerRef?: React.RefObject<HTMLElement | null>;
  readonly deleteTarget: EditableMilestone | null;
  readonly deleteError?: string | null;
  readonly operationStartAt: string;
  readonly operationEndAt: string;
  readonly contextEvents: readonly ProgramScheduleCalendarEvent[];
  readonly isBusy: boolean;
  readonly milestoneSnapshot?: EditableMilestoneEditSnapshot | null;
  readonly latestMilestoneSnapshot?: EditableMilestoneEditSnapshot | null;
  readonly snapshotLoadFailed?: boolean;
  readonly canonicalDocumentsByMilestoneId?: ReadonlyMap<
    string,
    readonly EditableMilestoneDocument[]
  >;
  readonly onAdd: () => void;
  readonly onEdit: (milestone: EditableMilestone) => void;
  readonly onCancelEdit: () => void;
  readonly onFieldChange: (field: ProgramMilestoneField, value: string) => void;
  readonly onSave: (
    event: React.FormEvent<HTMLFormElement>,
    documents?: ProgramMilestoneDraft['documents'],
  ) => void;
  readonly onRefreshMilestone?: () => void;
  readonly onDocumentsDirtyChange?: (dirty: boolean) => void;
  readonly onRestartMilestoneFromLatest?: (
    snapshot: EditableMilestoneEditSnapshot,
  ) => void;
  readonly onRequestDelete: (milestone: EditableMilestone) => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: () => void;
}

export function ProgramEditMilestones({
  milestones,
  editor,
  editTriggerRef,
  deleteTarget,
  deleteError,
  operationStartAt,
  operationEndAt,
  contextEvents,
  isBusy,
  milestoneSnapshot,
  latestMilestoneSnapshot,
  snapshotLoadFailed,
  canonicalDocumentsByMilestoneId,
  onAdd,
  onEdit,
  onCancelEdit,
  onFieldChange,
  onSave,
  onRefreshMilestone,
  onDocumentsDirtyChange,
  onRestartMilestoneFromLatest,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: ProgramEditMilestonesProps) {
  return (
    <section
      id="milestones"
      className="grid gap-4"
      aria-labelledby="milestones-title"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2
            id="milestones-title"
            className="font-heading text-section font-semibold tracking-[-0.02em]"
          >
            마일스톤
          </h2>
          <p className="text-small text-muted-foreground">
            학생이 제출물을 올릴 마일스톤을 등록·수정·삭제할 수 있습니다.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={isBusy}
          onClick={onAdd}
        >
          추가
        </Button>
      </div>
      {editor.mode === 'create' ? (
        <ProgramEditMilestoneForm
          editor={editor}
          operationStartAt={operationStartAt}
          operationEndAt={operationEndAt}
          contextEvents={contextEvents}
          isBusy={isBusy}
          onCancel={onCancelEdit}
          onFieldChange={onFieldChange}
          onSave={onSave}
        />
      ) : null}
      {editor.mode === 'edit' ? (
        <ProgramEditMilestoneDialog
          editor={editor}
          operationStartAt={operationStartAt}
          operationEndAt={operationEndAt}
          contextEvents={contextEvents}
          isBusy={isBusy}
          snapshot={milestoneSnapshot}
          latestSnapshot={latestMilestoneSnapshot}
          snapshotLoadFailed={snapshotLoadFailed}
          returnFocusRef={editTriggerRef}
          onRefresh={onRefreshMilestone}
          onDocumentsDirtyChange={onDocumentsDirtyChange}
          onRestartFromLatest={
            onRestartMilestoneFromLatest ?? (() => undefined)
          }
          onCancel={onCancelEdit}
          onFieldChange={onFieldChange}
          onSave={onSave}
        />
      ) : null}
      <div className="grid gap-3">
        {milestones.length === 0 ? (
          <Card>
            <CardContent className="grid gap-1 py-8 text-small text-muted-foreground">
              <p className="font-semibold text-foreground">
                아직 등록된 마일스톤이 없습니다.
              </p>
              <p>
                위의 ‘추가’를 눌러 첫 마일스톤을 만드세요. 기본 제출 항목도
                자동으로 함께 만들어지며, 필요하면 이름을 바꾸거나 항목을 더할
                수 있습니다.
              </p>
            </CardContent>
          </Card>
        ) : (
          milestones.map((milestone) => (
            <ProgramMilestoneCard
              key={milestone.id}
              id={milestone.id}
              disabled={isBusy}
              name={milestone.name}
              period={formatSeoulShortRange(milestone.startAt, milestone.dueAt)}
              notice={milestone.instructions}
              onEdit={() => onEdit(milestone)}
              onDelete={() => onRequestDelete(milestone)}
            >
              <ReadOnlyMilestoneDocuments
                milestoneId={milestone.id}
                canonicalDocuments={canonicalDocumentsByMilestoneId?.get(
                  milestone.id,
                )}
              />
            </ProgramMilestoneCard>
          ))
        )}
      </div>
      {deleteTarget ? (
        <DeleteMilestoneDialog
          milestone={deleteTarget}
          error={deleteError}
          isBusy={isBusy}
          onCancel={onCancelDelete}
          onConfirm={onConfirmDelete}
        />
      ) : null}
    </section>
  );
}

function DeleteMilestoneDialog({
  milestone,
  error,
  isBusy,
  onCancel,
  onConfirm,
}: {
  readonly milestone: EditableMilestone;
  readonly error?: string | null;
  readonly isBusy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const returnFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );

  return (
    <DialogShell
      kind="alert"
      title="마일스톤을 되돌릴 수 없이 삭제할까요?"
      description={`${milestone.name}에 등록된 제출 항목도 삭제됩니다. 양식 파일은 OSS Hub에서 더 이상 이용할 수 없습니다. 학생이 올린 제출물이 하나라도 있으면 삭제되지 않습니다.`}
      busy={isBusy}
      returnFocusRef={returnFocusRef}
      className="max-w-md break-keep [overflow-wrap:anywhere]"
      bodyClassName="mt-0"
      onCancel={onCancel}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isBusy}
          >
            취소
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={isBusy}
          >
            삭제 확정
          </Button>
        </>
      }
    >
      {error ? (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </DialogShell>
  );
}
