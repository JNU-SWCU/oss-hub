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
import { PageBody } from '@/components';

/** 폼 화면은 읽기 폭을 좁게 잡는다 — 본문 여백·최대폭의 나머지는 PageBody가 갖는다. */
const FORM_WIDTH = 'max-w-4xl';

const SECTIONS = 'flex min-w-0 flex-col gap-16';

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
    <PageBody className={FORM_WIDTH} aria-label="프로그램 편집 불러오는 중">
      <div className="h-20 animate-pulse rounded-card bg-muted motion-reduce:animate-none" />
      <div className={SECTIONS}>
        <div className="h-72 animate-pulse rounded-card bg-muted motion-reduce:animate-none" />
        <div className="h-48 animate-pulse rounded-card bg-muted motion-reduce:animate-none" />
      </div>
    </PageBody>
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
    <PageBody className={FORM_WIDTH}>
      <Alert variant="destructive">
        <AlertTitle>프로그램을 불러오지 못했습니다</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      <Button type="button" className="mt-6 self-start" onClick={onRetry}>
        다시 시도
      </Button>
    </PageBody>
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
    <PageBody className={FORM_WIDTH}>
      <header className="grid gap-4">
        <div className="grid gap-3">
          <h1 className="font-heading text-page font-bold tracking-[-0.03em] leading-[1.15]">
            프로그램 편집
          </h1>
          <p className="text-muted-foreground">{program.name}</p>
        </div>
        <dl className="grid gap-4 text-small sm:grid-cols-2">
          <div className="rounded-card border border-border bg-card p-card">
            <dt className="text-muted-foreground">신청서 양식</dt>
            <dd className="mt-1 font-semibold">
              {program.applicationTemplateKey}
            </dd>
          </div>
          <div className="rounded-card border border-border bg-card p-card">
            <dt className="text-muted-foreground">양식 버전</dt>
            <dd className="mt-1 font-semibold">
              v{program.applicationTemplateVersion}
            </dd>
          </div>
        </dl>
      </header>
      <div className={SECTIONS}>
        {toastMessage ? (
          <div
            role="status"
            className="rounded-card border border-status-approved-bg bg-status-approved-bg px-4 py-3 text-small text-status-approved-fg"
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
          <CardContent className="pt-card">
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
      </div>
    </PageBody>
  );
}
