'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  validateMilestoneForm,
  validateProgramEditForm,
  type ProgramEditableField,
  type ProgramEditErrors,
  type ProgramEditForm,
  type ProgramMilestoneEditor,
  type ProgramMilestoneField,
} from './program-edit-flow';
import {
  addDirtyField,
  hasUnsavedMilestoneEdit,
  removeMilestone,
  type ProgramEditLoadState,
  updateMilestoneEditor,
  updateProgramForm,
  updateReadyProgram,
  upsertMilestone,
} from './program-edit-state';
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
  const milestoneEditTriggerRef = useRef<HTMLElement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EditableMilestone | null>(
    null,
  );
  /**
   * 방금 만든 마일스톤. 저장하면 편집기가 닫히므로, 그 카드의 「제출 항목」을
   * 펼친 채로 띄워 "저장 → 제출 항목 등록"을 한 동선으로 잇는다.
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
  const editRegionRef = useRef<HTMLDivElement>(null);

  const isDirty = dirtyFields.length > 0;
  const hasUnsavedMilestoneChanges = hasUnsavedMilestoneEdit(
    milestoneEditor,
    milestoneDirtyFields,
  );
  // 훅은 조건부 이른 반환(state.kind === 'failed' 등)보다 위에서 호출해야 한다.
  // 나가기 확인은 기본 정보뿐 아니라 마일스톤 편집기에 남은 입력도 지켜야 한다(#867).
  useProgramExitGuard(isDirty || hasUnsavedMilestoneChanges);

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

  useEffect(() => {
    if (Object.keys(errors).length === 0) return;
    const firstInvalidField =
      editRegionRef.current?.querySelector<HTMLElement>(
        '[aria-invalid="true"]',
      ) ?? null;
    if (firstInvalidField === null) return;
    firstInvalidField.focus({ preventScroll: true });
    firstInvalidField.scrollIntoView?.({ block: 'center' });
  }, [errors]);

  useEffect(() => {
    if (
      milestoneEditor.mode === 'closed' ||
      Object.keys(milestoneEditor.errors).length === 0
    ) {
      return;
    }
    const firstInvalidField =
      editRegionRef.current?.querySelector<HTMLElement>(
        '[id^="milestone-"][aria-invalid="true"]:not(:disabled), [data-testid="program-schedule-calendar-scroll"][aria-invalid="true"]',
      ) ?? null;
    firstInvalidField?.focus({ preventScroll: true });
    firstInvalidField?.scrollIntoView?.({ block: 'center' });
  }, [milestoneEditor]);

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
    if (form === null || state.kind !== 'ready') return;
    const currentScheduleForm = {
      ...form,
      // 마일스톤을 방금 저장했을 때는 최초 로드 시점의 form 사본이 아니라
      // 현재 화면의 일정으로 검증해야 한다. 아래 전송 직전에만 덞어쓰면 클라이언트
      // 검증이 예전 마감으로 먼저 막아 요청 자체가 나가지 않는다.
      milestoneStartAts: state.program.milestones.map(
        (milestone) => milestone.startAt,
      ),
      milestoneDueAts: state.program.milestones.map(
        (milestone) => milestone.dueAt,
      ),
    };
    const clientFieldErrors = validateProgramEditForm(currentScheduleForm);
    if (Object.values(clientFieldErrors).some(Boolean)) {
      setErrors(clientFieldErrors);
      return;
    }
    setIsSaving(true);
    setErrors({});
    setGeneralAlert(null);
    try {
      const updated = await updateProgram(
        programId,
        buildProgramEditInput(currentScheduleForm, dirtyFields),
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
    milestoneEditTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const initialForm = toMilestoneForm(milestone);
    setMilestoneEditor({
      mode: 'edit',
      form: initialForm,
      initialForm,
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
    setGeneralAlert(null);
    const validationErrors = validateMilestoneForm(
      milestoneEditor.form,
      form?.startAt ?? '',
      form?.endAtUndecided === true ? null : (form?.endAt ?? null),
    );
    if (Object.keys(validationErrors).length > 0) {
      setMilestoneEditor((current) =>
        current.mode === 'closed'
          ? current
          : { ...current, errors: validationErrors },
      );
      return;
    }
    setIsMilestoneBusy(true);
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
    <div ref={editRegionRef} className="contents">
      <ProgramEditView
        program={state.program}
        form={form}
        errors={errors}
        toastMessage={toastMessage}
        generalAlert={generalAlert}
        isSaving={isSaving}
        milestoneEditor={milestoneEditor}
        milestoneEditTriggerRef={milestoneEditTriggerRef}
        deleteTarget={deleteTarget}
        expandedDocumentsMilestoneId={createdMilestoneId}
        isMilestoneBusy={isMilestoneBusy}
        isLifecycleBusy={isLifecycleBusy}
        isLifecycleConfirming={isLifecycleConfirming}
        lifecycleError={lifecycleError}
        isAdmin={isAdmin}
        onFieldChange={updateField}
        onSubmit={(event) => void submit(event)}
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
    </div>
  );
}
