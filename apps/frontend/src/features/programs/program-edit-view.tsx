import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { EditableMilestone, EditableProgram } from './api';
import { ProgramEditBasicForm } from './program-edit-basic-form';
import { ProgramEditDangerZoneSection } from './program-edit-danger-zone-section';
import { ProgramEditLifecycleSection } from './program-edit-lifecycle-section';
import { ProgramEditMilestones } from './program-edit-milestones';
import {
  type ProgramEditableField,
  type ProgramEditErrors,
  type ProgramEditForm,
  type ProgramMilestoneEditor,
  type ProgramMilestoneField,
} from './program-edit-flow';
import { programHref } from './program-paths';
import { PROGRAM_TEMPLATE_DEFINITIONS } from './program-templates';
import { editScheduleEvents } from './program-schedule-overview-model';
import { PageBody, PageHeader } from '@/components';

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
  /** 방금 만든 마일스톤 — 저장 직후 그 카드의 「제출 항목」이 펼쳐진 채로 뜬다. */
  readonly expandedDocumentsMilestoneId: string | null;
  readonly isMilestoneBusy: boolean;
  readonly isLifecycleBusy: boolean;
  readonly isLifecycleConfirming: boolean;
  readonly lifecycleError: string | null;
  /** ADMIN만 「위험 영역」(영구 삭제) 섹션을 본다(#875). */
  readonly isAdmin: boolean;
  readonly onFieldChange: (
    field: ProgramEditableField,
    value: string | boolean,
  ) => void;
  readonly onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  readonly onRequestLifecycleToggle: () => void;
  readonly onCancelLifecycleToggle: () => void;
  readonly onConfirmLifecycleToggle: () => void;
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
      <p className="mt-4 text-small text-muted-foreground">
        다시 시도해도 열리지 않으면 프로그램 목록으로 돌아갈 수 있습니다.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button type="button" onClick={onRetry}>
          다시 시도
        </Button>
        <Button asChild variant="outline">
          <Link href="/programs">프로그램 목록</Link>
        </Button>
      </div>
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
  expandedDocumentsMilestoneId,
  isMilestoneBusy,
  isLifecycleBusy,
  isLifecycleConfirming,
  lifecycleError,
  isAdmin,
  onFieldChange,
  onSubmit,
  onRequestLifecycleToggle,
  onCancelLifecycleToggle,
  onConfirmLifecycleToggle,
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
      {/*
        페이지에서 나가는 길은 제목 위의 이 링크 하나다. 폼 안에 두면 「기본 정보」
        섹션의 변경을 취소하는 것처럼 읽히는데, 이 페이지는 그 아래에서 마일스톤도
        편집한다 — 한 섹션의 액션이 페이지 전체를 떠나게 하면 안 된다.
      */}
      <div className="flex flex-col gap-4">
        <Button asChild variant="ghost" size="sm" className="self-start">
          <Link href={programHref(program.id)}>← 프로그램 개요</Link>
        </Button>
        <PageHeader title="프로그램 편집" description={program.name} />
        {/*
          양식 키(`oss-contest`)와 버전은 구현 식별자다. 화면에는 사람이 읽을 양식명만
          두고, 버전은 평소 볼 일이 없으므로 접어 둔다.
        */}
        <details className="rounded-card border border-border bg-card p-card text-small">
          <summary className="cursor-pointer font-semibold">
            신청서 양식 · {applicationTemplateName(program)}
          </summary>
          <p className="mt-2 text-muted-foreground">
            양식 버전 v{program.applicationTemplateVersion} — 양식과 버전은
            프로그램 유형이 정하며 이 화면에서 바꿀 수 없습니다.
          </p>
        </details>
      </div>
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
            <AlertDescription className="grid gap-1">
              <span>{generalAlert}</span>
              <span>
                안내에 따라 아래 입력값이나 마일스톤 설정을 고친 뒤 다시 시도해
                주세요.
              </span>
            </AlertDescription>
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
              expandedDocumentsMilestoneId={expandedDocumentsMilestoneId}
              operationStartAt={form.startAt}
              operationEndAt={form.endAtUndecided ? '' : form.endAt}
              contextEvents={editScheduleEvents(
                form,
                program.milestones,
                milestoneEditor,
              )}
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
        <ProgramEditLifecycleSection
          lifecycle={program.lifecycle}
          isBusy={isLifecycleBusy}
          isConfirming={isLifecycleConfirming}
          error={lifecycleError}
          onRequestToggle={onRequestLifecycleToggle}
          onCancelToggle={onCancelLifecycleToggle}
          onConfirmToggle={onConfirmLifecycleToggle}
        />
        <div className="border-t border-border pt-10">
          <ProgramEditDangerZoneSection
            programId={program.id}
            programName={program.name}
            isAdmin={isAdmin}
            deletionProtected={program.deletionProtected ?? false}
          />
        </div>
      </div>
    </PageBody>
  );
}

function applicationTemplateName(program: EditableProgram): string {
  return (
    PROGRAM_TEMPLATE_DEFINITIONS.find(
      (item) => item.template.key === program.applicationTemplateKey,
    )?.template.name ?? '기본 신청서'
  );
}
