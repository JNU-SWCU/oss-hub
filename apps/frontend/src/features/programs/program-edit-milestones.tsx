import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { EditableMilestone } from './api';
import {
  type ProgramMilestoneEditor,
  type ProgramMilestoneField,
} from './program-edit-flow';
import { MilestoneDocumentEditorSection } from './milestone-document-editor';
import { formatSeoulDate } from './program-detail-format';
import { ProgramEditMilestoneForm } from './program-edit-milestone-form';
import type { ProgramScheduleCalendarEvent } from './program-schedule-calendar-model';
import { ProgramEditMilestoneDialog } from './program-edit-milestone-dialog';
interface ProgramEditMilestonesProps {
  readonly milestones: readonly EditableMilestone[];
  readonly editor: ProgramMilestoneEditor;
  readonly editTriggerRef?: React.RefObject<HTMLElement | null>;
  readonly deleteTarget: EditableMilestone | null;
  /** 방금 만든 마일스톤 — 그 카드만 「제출 항목」을 펼친 채로 시작한다. */
  readonly expandedDocumentsMilestoneId: string | null;
  readonly operationStartAt: string;
  readonly operationEndAt: string;
  readonly contextEvents: readonly ProgramScheduleCalendarEvent[];
  readonly isBusy: boolean;
  readonly onAdd: () => void;
  readonly onEdit: (milestone: EditableMilestone) => void;
  readonly onCancelEdit: () => void;
  readonly onFieldChange: (field: ProgramMilestoneField, value: string) => void;
  readonly onSave: (event: React.FormEvent<HTMLFormElement>) => void;
  readonly onRequestDelete: (milestone: EditableMilestone) => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: () => void;
}

export function ProgramEditMilestones({
  milestones,
  editor,
  editTriggerRef,
  deleteTarget,
  expandedDocumentsMilestoneId,
  operationStartAt,
  operationEndAt,
  contextEvents,
  isBusy,
  onAdd,
  onEdit,
  onCancelEdit,
  onFieldChange,
  onSave,
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
        <Button type="button" variant="outline" onClick={onAdd}>
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
          returnFocusRef={editTriggerRef}
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
            <Card key={milestone.id} data-canonical-id={milestone.id}>
              <CardHeader className="gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="grid gap-1">
                  <CardTitle>{milestone.name}</CardTitle>
                  <p className="text-small text-muted-foreground break-keep">
                    {formatSeoulDate(milestone.dueAt)} · 학생이 낼 내용과 참고
                    자료는 아래 제출 항목에서 관리합니다.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onEdit(milestone)}
                  >
                    수정
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => onRequestDelete(milestone)}
                  >
                    삭제
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3">
                <p className="text-small whitespace-pre-wrap text-muted-foreground break-keep">
                  {milestone.instructions ?? '제출 안내가 없습니다.'}
                </p>
                <MilestoneDocumentEditorSection
                  milestoneId={milestone.id}
                  defaultExpanded={
                    expandedDocumentsMilestoneId === milestone.id
                  }
                />
              </CardContent>
            </Card>
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
    >
      <div className="w-full max-w-md rounded-card border border-border bg-background p-card shadow-lg">
        <h2
          id="milestone-delete-title"
          className="font-heading text-section font-semibold tracking-[-0.02em]"
        >
          마일스톤 삭제
        </h2>
        <p className="mt-2 text-small text-muted-foreground">
          {milestone.name} 마일스톤을 삭제합니다. 제출물이 있으면 삭제할 수
          없습니다.
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
