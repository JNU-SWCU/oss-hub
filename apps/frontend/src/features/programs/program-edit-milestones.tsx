import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type {
  EditableMilestone,
  EditableMilestoneEditSnapshot,
  EditableMilestoneDocument,
} from './api';
import {
  type ProgramMilestoneEditor,
  type ProgramMilestoneField,
  type ProgramMilestoneDraft,
} from './program-edit-flow';
import { ReadOnlyMilestoneDocuments } from './milestone-document-editor';
import { formatSeoulDate } from './program-detail-format';
import { ProgramEditMilestoneForm } from './program-edit-milestone-form';
import type { ProgramScheduleCalendarEvent } from './program-schedule-calendar-model';
import { ProgramEditMilestoneDialog } from './program-edit-milestone-dialog';
import { ProgramMilestoneCard } from './program-milestone-card';
interface ProgramEditMilestonesProps {
  readonly milestones: readonly EditableMilestone[];
  readonly editor: ProgramMilestoneEditor;
  readonly editTriggerRef?: React.RefObject<HTMLElement | null>;
  readonly deleteTarget: EditableMilestone | null;
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
              startAt={formatSeoulDate(milestone.startAt)}
              dueAt={formatSeoulDate(milestone.dueAt)}
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
  isBusy,
  onCancel,
  onConfirm,
}: {
  readonly milestone: EditableMilestone;
  readonly isBusy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="milestone-delete-title"
      aria-describedby="milestone-delete-description"
    >
      <div className="w-full max-w-md rounded-card border border-border bg-background p-card shadow-lg">
        <h2
          id="milestone-delete-title"
          className="font-heading text-section font-semibold tracking-[-0.02em] [word-break:keep-all]"
        >
          마일스톤을 되돌릴 수 없이 삭제할까요?
        </h2>
        <p
          id="milestone-delete-description"
          className="mt-2 text-small text-muted-foreground [word-break:keep-all]"
        >
          <span className="[overflow-wrap:anywhere]">{milestone.name}</span>에
          등록된 제출 항목도 삭제됩니다. 양식 파일은 OSS Hub에서 더 이상 이용할
          수 없습니다. 학생이 올린 제출물이 하나라도 있으면 삭제되지 않습니다.
        </p>
        <div className="mt-6 flex justify-end gap-2">
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
        </div>
      </div>
    </div>
  );
}
