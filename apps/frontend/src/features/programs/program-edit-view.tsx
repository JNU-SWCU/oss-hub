import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { EditableMilestone, EditableProgram } from './api';
import { ProgramEditBasicForm } from './program-edit-basic-form';
import { ProgramEditMilestones } from './program-edit-milestones';
import {
  type ProgramEditableField,
  type ProgramEditErrors,
  type ProgramEditForm,
  type ProgramMilestoneEditor,
  type ProgramMilestoneField,
} from './program-edit-flow';

interface ProgramEditViewProps {
  readonly program: EditableProgram;
  readonly form: ProgramEditForm;
  readonly errors: ProgramEditErrors;
  readonly toastMessage: string | null;
  readonly generalAlert: string | null;
  readonly isSaving: boolean;
  readonly milestoneEditor: ProgramMilestoneEditor;
  readonly deleteTarget: EditableMilestone | null;
  readonly isMilestoneBusy: boolean;
  readonly onFieldChange: (
    field: ProgramEditableField,
    value: string | boolean,
  ) => void;
  readonly onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  readonly onAddMilestone: () => void;
  readonly onEditMilestone: (milestone: EditableMilestone) => void;
  readonly onCancelMilestone: () => void;
  readonly onMilestoneFieldChange: (
    field: ProgramMilestoneField,
    value: string,
  ) => void;
  readonly onSaveMilestone: (event: React.FormEvent<HTMLFormElement>) => void;
  readonly onRequestDeleteMilestone: (milestone: EditableMilestone) => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: () => void;
}

export function ProgramEditSkeleton() {
  return (
    <main
      className="mx-auto grid max-w-4xl gap-6 px-4 py-8"
      aria-label="프로그램 편집 불러오는 중"
    >
      <div className="h-20 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-72 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-48 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
    </main>
  );
}

export function ProgramEditLoadFailure({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <Alert variant="destructive">
        <AlertTitle>프로그램을 불러오지 못했습니다</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      <Button type="button" className="mt-4" onClick={onRetry}>
        다시 시도
      </Button>
    </main>
  );
}

export function ProgramEditView({
  program,
  form,
  errors,
  toastMessage,
  generalAlert,
  isSaving,
  milestoneEditor,
  deleteTarget,
  isMilestoneBusy,
  onFieldChange,
  onSubmit,
  onAddMilestone,
  onEditMilestone,
  onCancelMilestone,
  onMilestoneFieldChange,
  onSaveMilestone,
  onRequestDeleteMilestone,
  onCancelDelete,
  onConfirmDelete,
}: ProgramEditViewProps) {
  return (
    <main className="mx-auto grid w-full max-w-4xl gap-6 px-4 py-6">
      <header className="grid gap-2">
        <h1 className="text-3xl font-bold tracking-tight">프로그램 편집</h1>
        <p className="text-sm text-muted-foreground">{program.name}</p>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-3">
            <dt className="text-muted-foreground">템플릿 키</dt>
            <dd className="font-medium">{program.applicationTemplateKey}</dd>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <dt className="text-muted-foreground">템플릿 버전</dt>
            <dd className="font-medium">
              v{program.applicationTemplateVersion}
            </dd>
          </div>
        </dl>
      </header>
      {toastMessage ? (
        <div
          role="status"
          className="rounded-lg border border-status-approved-bg bg-status-approved-bg px-3 py-2 text-sm text-status-approved-fg"
        >
          {toastMessage}
        </div>
      ) : null}
      {generalAlert ? (
        <Alert variant="destructive">
          <AlertTitle>처리 실패</AlertTitle>
          <AlertDescription>{generalAlert}</AlertDescription>
        </Alert>
      ) : null}
      <ProgramEditBasicForm
        program={program}
        form={form}
        errors={errors}
        isSaving={isSaving}
        onFieldChange={onFieldChange}
        onSubmit={onSubmit}
      />
      <Card>
        <CardContent className="pt-6">
          <ProgramEditMilestones
            milestones={program.milestones}
            editor={milestoneEditor}
            deleteTarget={deleteTarget}
            isBusy={isMilestoneBusy}
            onAdd={onAddMilestone}
            onEdit={onEditMilestone}
            onCancelEdit={onCancelMilestone}
            onFieldChange={onMilestoneFieldChange}
            onSave={onSaveMilestone}
            onRequestDelete={onRequestDeleteMilestone}
            onCancelDelete={onCancelDelete}
            onConfirmDelete={onConfirmDelete}
          />
        </CardContent>
      </Card>
    </main>
  );
}
