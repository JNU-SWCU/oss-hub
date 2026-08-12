'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EditableMilestone } from './api';
import {
  createMilestone,
  deleteMilestone,
  getEditableProgram,
  updateMilestone,
  updateProgram,
  updateProgramLifecycle,
} from './api';
import {
  buildMilestoneInput,
  buildProgramEditInput,
  emptyMilestoneForm,
  mapMilestoneDeleteError,
  mapMilestoneError,
  mapProgramEditError,
  toMilestoneForm,
  toProgramEditForm,
  type ProgramEditableField,
  type ProgramEditErrors,
  type ProgramEditForm,
  type ProgramMilestoneEditor,
  type ProgramMilestoneField,
} from './program-edit-flow';
import {
  addDirtyField,
  removeMilestone,
  type ProgramEditLoadState,
  updateMilestoneEditor,
  updateProgramForm,
  updateReadyProgram,
  upsertMilestone,
} from './program-edit-state';
import { PROGRAM_TEMPLATE_DEFINITIONS } from './program-templates';
import {
  ProgramEditLoadFailure,
  ProgramEditSkeleton,
  ProgramEditView,
} from './program-edit-view';
import { useProgramExitGuard } from './use-program-exit-guard';

export function ProgramEditPage({
  programId,
  isAdmin,
}: {
  readonly programId: string;
  /** ADMIN만 「위험 영역」(영구 삭제) 섹션을 본다(#875) — 셸의 `ProgramEditRoute`가 판정한다. */
  readonly isAdmin: boolean;
}) {
  const [state, setState] = useState<ProgramEditLoadState>({ kind: 'loading' });
  const [form, setForm] = useState<ProgramEditForm | null>(null);
  const [dirtyFields, setDirtyFields] = useState<
    readonly ProgramEditableField[]
  >([]);
  const [errors, setErrors] = useState<ProgramEditErrors>({});
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [generalAlert, setGeneralAlert] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [milestoneEditor, setMilestoneEditor] =
    useState<ProgramMilestoneEditor>({ mode: 'closed' });
  const [milestoneDirtyFields, setMilestoneDirtyFields] = useState<
    readonly ProgramMilestoneField[]
  >([]);
  const [deleteTarget, setDeleteTarget] = useState<EditableMilestone | null>(
    null,
  );
  /**
   * 방금 만든 마일스톤. 저장하면 편집기가 닫히므로, 그 카드의 「받을 서류」를
   * 펼친 채로 띄워 "저장 → 서류 등록"을 한 동선으로 잇는다.
   */
  const [createdMilestoneId, setCreatedMilestoneId] = useState<string | null>(
    null,
  );
  const [isMilestoneBusy, setIsMilestoneBusy] = useState(false);
  const [isLifecycleBusy, setIsLifecycleBusy] = useState(false);
  const [isLifecycleConfirming, setIsLifecycleConfirming] = useState(false);
  /**
   * 게시 상태 전환 실패 메시지는 generalAlert(페이지 맨 위)가 아니라 따로 갖는다.
   * 게시 상태 버튼은 페이지 아래쪽 「게시 상태」 섹션에 있어서, generalAlert에
   * 실으면 원인 버튼과 멀리 떨어진 곳에 뜬다 — 화면 아래에서 누른 사람은
   * 실패 이유를 보지 못한 채 버튼만 다시 눌러 보게 된다.
   */
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);

  const isDirty = dirtyFields.length > 0;
  // 지금 열려 있는 마일스톤 편집기에 저장 안 한 입력이 있는지. isDirty와 따로
  // 두는 이유 — 「변경 취소」는 기본 폼만 되돌리는데, 두 값을 합치면 마일스톤만
  // 고친 상태에서도 그 버튼이 활성화되고 눌러도 아무 일도 안 일어난다.
  const hasUnsavedMilestoneEdit =
    milestoneEditor.mode !== 'closed' && milestoneDirtyFields.length > 0;
  // 훅은 조건부 이른 반환(state.kind === 'failed' 등)보다 위에서 호출해야 한다.
  // 나가기 확인은 기본 정보뿐 아니라 마일스톤 편집기에 남은 입력도 지켜야 한다(#867).
  useProgramExitGuard(isDirty || hasUnsavedMilestoneEdit);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    setForm(null);
    try {
      const program = await getEditableProgram(programId);
      setState({ kind: 'ready', program });
      setForm(toProgramEditForm(program));
      setDirtyFields([]);
      setErrors({});
      setGeneralAlert(null);
    } catch {
      setState({ kind: 'failed', message: '잠시 후 다시 시도해 주세요.' });
    }
  }, [programId]);

  useEffect(() => {
    void load();
  }, [load]);

  const requiresTeam = useMemo(() => {
    const category = form?.category;
    const template = PROGRAM_TEMPLATE_DEFINITIONS.find(
      (item) => item.category === category,
    );
    return template?.template.participation === 'team';
  }, [form?.category]);

  const updateField = (
    field: ProgramEditableField,
    value: string | boolean,
  ) => {
    setForm((current) =>
      current ? updateProgramForm(current, field, value) : current,
    );
    setDirtyFields((current) => addDirtyField(current, field));
    setErrors({});
    setGeneralAlert(null);
    // 다시 편집을 시작하면 방금 전 저장 성공 메시지는 더 이상 지금 상태를 말하지 않는다.
    setToastMessage(null);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (form === null) return;
    const clientFieldErrors: ProgramEditErrors = {
      name: form.name.trim() ? undefined : '프로그램 이름을 입력해 주세요.',
      organizer: form.organizer.trim() ? undefined : '주최를 입력해 주세요.',
      description: form.description.trim()
        ? undefined
        : '프로그램 설명을 입력해 주세요.',
      startAt: form.startAt ? undefined : '운영 시작일을 입력해 주세요.',
      endAt:
        form.endAt && new Date(form.endAt) < new Date(form.applicationEndAt)
          ? '종료일은 신청 종료일 이후여야 합니다.'
          : undefined,
    };
    if (
      clientFieldErrors.name ||
      clientFieldErrors.organizer ||
      clientFieldErrors.description ||
      clientFieldErrors.startAt ||
      clientFieldErrors.endAt
    ) {
      setErrors(clientFieldErrors);
      return;
    }
    setIsSaving(true);
    setErrors({});
    setGeneralAlert(null);
    try {
      const updated = await updateProgram(
        programId,
        buildProgramEditInput(form, requiresTeam, dirtyFields),
      );
      setState({ kind: 'ready', program: updated });
      setForm(toProgramEditForm(updated));
      setDirtyFields([]);
      setToastMessage('저장되었습니다.');
    } catch (error: unknown) {
      setErrors(mapProgramEditError(error));
    } finally {
      setIsSaving(false);
    }
  };

  const openAddMilestone = () => {
    setMilestoneEditor({
      mode: 'create',
      form: emptyMilestoneForm(),
      errors: {},
    });
    setMilestoneDirtyFields([]);
    setGeneralAlert(null);
  };
  const openEditMilestone = (milestone: EditableMilestone) => {
    setMilestoneEditor({
      mode: 'edit',
      form: toMilestoneForm(milestone),
      errors: {},
    });
    setMilestoneDirtyFields([]);
    setGeneralAlert(null);
  };
  const updateMilestoneField = (
    field: ProgramMilestoneField,
    value: string,
  ) => {
    setMilestoneEditor((current) =>
      updateMilestoneEditor(current, field, value),
    );
    setMilestoneDirtyFields((current) => addDirtyField(current, field));
  };

  const saveMilestone = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (milestoneEditor.mode === 'closed') return;
    setIsMilestoneBusy(true);
    setGeneralAlert(null);
    try {
      const input = buildMilestoneInput(
        milestoneEditor.form,
        milestoneDirtyFields,
      );
      const isCreate = milestoneEditor.form.id === null;
      const saved = milestoneEditor.form.id
        ? await updateMilestone(milestoneEditor.form.id, input)
        : await createMilestone(programId, input);
      setState((current) =>
        updateReadyProgram(current, (program) =>
          upsertMilestone(program, saved),
        ),
      );
      if (isCreate) setCreatedMilestoneId(saved.id);
      setMilestoneEditor({ mode: 'closed' });
      setMilestoneDirtyFields([]);
    } catch (error: unknown) {
      setMilestoneEditor((current) =>
        current.mode === 'closed'
          ? current
          : { ...current, errors: mapMilestoneError(error) },
      );
    } finally {
      setIsMilestoneBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (deleteTarget === null) return;
    setIsMilestoneBusy(true);
    setGeneralAlert(null);
    try {
      await deleteMilestone(deleteTarget.id);
      setState((current) => removeMilestone(current, deleteTarget.id));
      setDeleteTarget(null);
    } catch (error: unknown) {
      setGeneralAlert(mapMilestoneDeleteError(error));
    } finally {
      setIsMilestoneBusy(false);
    }
  };
  const requestLifecycleToggle = () => setIsLifecycleConfirming(true);
  const cancelLifecycleToggle = () => setIsLifecycleConfirming(false);
  const confirmLifecycleToggle = async () => {
    if (state.kind !== 'ready') return;
    const lifecycle =
      state.program.lifecycle === 'PUBLISHED' ? 'ARCHIVED' : 'PUBLISHED';
    setIsLifecycleBusy(true);
    // 새로 시도하는 순간 지난번 실패 메시지는 더 이상 지금 상태를 말하지 않는다.
    setLifecycleError(null);
    try {
      const updated = await updateProgramLifecycle(programId, lifecycle);
      // load()로 통째로 다시 불러오면 그사이 화면이 스켈레톤으로 통째로 갈아치워져
      // form이 사라지고, 돌아왔을 때 서버 값으로 되돌아가 저장 안 한 기본 정보
      // 입력이 날아간다. 게시 상태는 폼 내용과 무관하니 마일스톤 저장과 같은
      // 패턴(updateReadyProgram)으로 program만 그 자리에서 갈아 끼운다.
      setState((current) =>
        updateReadyProgram(current, (program) => ({
          ...program,
          lifecycle: updated.lifecycle,
        })),
      );
    } catch {
      // 실패 원인은 generalAlert(페이지 맨 위)가 아니라 게시 상태 섹션 안
      // lifecycleError로 드러난다 — 버튼과 같은 자리에 있어야 한다.
      setLifecycleError(
        '상태를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      );
    } finally {
      // 성공이든 실패든 대화상자가 열린 채 멈추거나 버튼이 계속 비활성으로
      // 남으면 안 되므로 finally에서 함께 정리한다.
      setIsLifecycleBusy(false);
      setIsLifecycleConfirming(false);
    }
  };

  const reset = () => {
    if (state.kind !== 'ready') return;
    setForm(toProgramEditForm(state.program));
    setDirtyFields([]);
    setErrors({});
    setToastMessage(null);
  };

  if (state.kind === 'failed') {
    return (
      <ProgramEditLoadFailure
        message={state.message}
        onRetry={() => void load()}
      />
    );
  }
  if (state.kind === 'loading' || form === null) {
    return <ProgramEditSkeleton />;
  }

  return (
    <ProgramEditView
      program={state.program}
      form={form}
      errors={errors}
      toastMessage={toastMessage}
      generalAlert={generalAlert}
      isSaving={isSaving}
      milestoneEditor={milestoneEditor}
      deleteTarget={deleteTarget}
      expandedDocumentsMilestoneId={createdMilestoneId}
      isMilestoneBusy={isMilestoneBusy}
      isDirty={isDirty}
      isLifecycleBusy={isLifecycleBusy}
      isLifecycleConfirming={isLifecycleConfirming}
      lifecycleError={lifecycleError}
      isAdmin={isAdmin}
      onFieldChange={updateField}
      onSubmit={(event) => void submit(event)}
      onReset={reset}
      onRequestLifecycleToggle={requestLifecycleToggle}
      onCancelLifecycleToggle={cancelLifecycleToggle}
      onConfirmLifecycleToggle={() => void confirmLifecycleToggle()}
      onAddMilestone={openAddMilestone}
      onEditMilestone={openEditMilestone}
      onCancelMilestone={() => setMilestoneEditor({ mode: 'closed' })}
      onMilestoneFieldChange={updateMilestoneField}
      onSaveMilestone={(event) => void saveMilestone(event)}
      onRequestDeleteMilestone={setDeleteTarget}
      onCancelDelete={() => setDeleteTarget(null)}
      onConfirmDelete={() => void confirmDelete()}
    />
  );
}
