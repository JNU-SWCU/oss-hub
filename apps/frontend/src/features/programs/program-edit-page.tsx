'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
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
import { programHref } from './program-paths';

const REDIRECT_DELAY_MS = 1000;

export function ProgramEditPage({ programId }: { readonly programId: string }) {
  const router = useRouter();
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
      endAt:
        form.endAt && new Date(form.endAt) < new Date(form.applicationEndAt)
          ? '종료일은 신청 종료일 이후여야 합니다.'
          : undefined,
    };
    if (
      clientFieldErrors.name ||
      clientFieldErrors.organizer ||
      clientFieldErrors.description ||
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
      setToastMessage('저장되었습니다. 상세 화면으로 이동합니다.');
      setTimeout(
        () => router.replace(programHref(updated.id)),
        REDIRECT_DELAY_MS,
      );
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
  const toggleLifecycle = async () => {
    const lifecycle =
      state.kind === 'ready' && state.program.lifecycle === 'PUBLISHED'
        ? 'ARCHIVED'
        : 'PUBLISHED';
    const message =
      lifecycle === 'ARCHIVED'
        ? '프로그램을 내리면 익명 사용자에게 보이지 않고 신청이 차단됩니다. 계속할까요?'
        : '내린 프로그램을 다시 발행할까요?';
    if (!window.confirm(message)) return;
    setIsLifecycleBusy(true);
    try {
      await updateProgramLifecycle(programId, lifecycle);
      await load();
    } catch {
      setGeneralAlert(
        '상태를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      );
    } finally {
      setIsLifecycleBusy(false);
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
    <>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          className="rounded-md border border-destructive px-4 py-2 text-sm font-medium text-destructive"
          disabled={isLifecycleBusy}
          onClick={() => void toggleLifecycle()}
        >
          {state.program.lifecycle === 'PUBLISHED'
            ? '프로그램 내리기'
            : '프로그램 복구하기'}
        </button>
      </div>
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
        onFieldChange={updateField}
        onSubmit={(event) => void submit(event)}
        onAddMilestone={openAddMilestone}
        onEditMilestone={openEditMilestone}
        onCancelMilestone={() => setMilestoneEditor({ mode: 'closed' })}
        onMilestoneFieldChange={updateMilestoneField}
        onSaveMilestone={(event) => void saveMilestone(event)}
        onRequestDeleteMilestone={setDeleteTarget}
        onCancelDelete={() => setDeleteTarget(null)}
        onConfirmDelete={() => void confirmDelete()}
      />
    </>
  );
}
