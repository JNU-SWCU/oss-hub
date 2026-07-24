import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { EditableMilestone } from './api';
import {
  type ProgramMilestoneEditor,
  type ProgramMilestoneField,
} from './program-edit-flow';
import { formatSeoulDate } from './program-detail-format';
import { ProgramEditMilestoneForm } from './program-edit-milestone-form';
interface ProgramEditMilestonesProps {
  readonly milestones: readonly EditableMilestone[];
  readonly editor: ProgramMilestoneEditor;
  readonly deleteTarget: EditableMilestone | null;
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
  deleteTarget,
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
            className="font-heading text-xl font-semibold"
          >
            마일스톤
          </h2>
          <p className="text-sm text-muted-foreground">
            canonical ID 기준으로 등록, 수정, 삭제합니다.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={onAdd}>
          추가
        </Button>
      </div>
      {editor.mode === 'closed' ? null : (
        <ProgramEditMilestoneForm
          editor={editor}
          isBusy={isBusy}
          onCancel={onCancelEdit}
          onFieldChange={onFieldChange}
          onSave={onSave}
        />
      )}
      <div className="grid gap-3">
        {milestones.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-sm text-muted-foreground">
              아직 등록된 마일스톤이 없습니다.
            </CardContent>
          </Card>
        ) : (
          milestones.map((milestone) => (
            <Card key={milestone.id} data-canonical-id={milestone.id}>
              <CardHeader className="gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="grid gap-1">
                  <CardTitle>{milestone.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    ID {milestone.id} · {formatSeoulDate(milestone.dueAt)} ·{' '}
                    <code>{milestone.submissionType}</code>
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onEdit(milestone)}
                  >
                    수정
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => onRequestDelete(milestone)}
                  >
                    삭제
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                  {milestone.instructions ?? '제출 안내가 없습니다.'}
                </p>
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
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg">
        <h2
          id="milestone-delete-title"
          className="font-heading text-xl font-bold"
        >
          마일스톤 삭제
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {milestone.name} 마일스톤을 삭제합니다. 제출물이 있으면 삭제할 수
          없습니다.
        </p>
        <div className="mt-5 flex justify-end gap-2">
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
