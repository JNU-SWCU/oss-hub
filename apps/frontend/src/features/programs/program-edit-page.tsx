'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditableMilestone, EditableMilestoneEditSnapshot } from './api';
import {
  createMilestone,
  deleteMilestone,
  getEditableProgram,
  getEditableMilestone,
  editableMilestoneSnapshotFailure,
  updateEditableMilestone,
  updateProgram,
} from './api';
import {
  buildMilestoneInput,
  buildProgramEditInput,
  changedMilestoneFields,
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
  type ProgramMilestoneDraft,
} from './program-edit-flow';
import {
  buildLocalMilestoneDocumentInputs,
  validateLocalMilestoneDocuments,
} from './milestone-document-editor-flow';
import {
  cleanupPreparedUploads,
  createProgramSubmissionRuntime,
  preparePendingUploads,
} from './program-authoring-submit';
import {
  deleteAuthoringUpload,
  uploadAuthoringFile,
} from './program-authoring-api';
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
  canDeleteProgram,
}: {
  readonly programId: string;
  /**
   * 삭제 권한이 있는 사용자만 「위험 영역」(영구 삭제) 섹션을 본다 — 셸의
   * `ProgramEditRoute`가 교직원 또는 관리자로 판정한다(#1095).
   */
  readonly canDeleteProgram: boolean;
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
  const milestoneEditTriggerRef = useRef<HTMLElement | null>(null);
  const milestoneUploadRuntimeRef = useRef(createProgramSubmissionRuntime());
  const [deleteTarget, setDeleteTarget] = useState<EditableMilestone | null>(
    null,
  );
  const [isMilestoneBusy, setIsMilestoneBusy] = useState(false);
  const [milestoneSnapshot, setMilestoneSnapshot] =
    useState<EditableMilestoneEditSnapshot | null>(null);
  const [latestMilestoneSnapshot, setLatestMilestoneSnapshot] =
    useState<EditableMilestoneEditSnapshot | null>(null);
  const [milestoneSnapshotLoadFailed, setMilestoneSnapshotLoadFailed] =
    useState(false);
  const milestoneSnapshotRequestRef = useRef(0);
  const [canonicalDocumentsByMilestoneId, setCanonicalDocumentsByMilestoneId] =
    useState<ReadonlyMap<string, EditableMilestoneEditSnapshot['documents']>>(
      new Map(),
    );
  const [hasUnsavedMilestoneDocuments, setHasUnsavedMilestoneDocuments] =
    useState(false);
  const editRegionRef = useRef<HTMLDivElement>(null);

  const isDirty = dirtyFields.length > 0;
  const hasUnsavedMilestoneChanges = hasUnsavedMilestoneEdit(milestoneEditor);
  // 훅은 조건부 이른 반환(state.kind === 'failed' 등)보다 위에서 호출해야 한다.
  // 나가기 확인은 기본 정보뿐 아니라 마일스톤 편집기에 남은 입력도 지켜야 한다(#867).
  const { completeAndNavigate } = useProgramExitGuard(
    isDirty || hasUnsavedMilestoneChanges || hasUnsavedMilestoneDocuments,
  );

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
    if (milestoneUploadRuntimeRef.current.submitting) return;
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
    if (isMilestoneBusy) return;
    const initialForm = emptyMilestoneForm();
    setMilestoneEditor({
      mode: 'create',
      form: initialForm,
      initialForm,
      errors: {},
    });
    setGeneralAlert(null);
  };
  const refreshMilestoneSnapshot = (milestoneId: string) => {
    const requestId = (milestoneSnapshotRequestRef.current += 1);
    setLatestMilestoneSnapshot(null);
    void getEditableMilestone(milestoneId)
      .then((snapshot) => {
        if (requestId !== milestoneSnapshotRequestRef.current) return;
        if (milestoneSnapshot === null) {
          setMilestoneSnapshot(snapshot);
          setMilestoneSnapshotLoadFailed(false);
          setMilestoneEditor((current) => {
            if (current.mode !== 'edit' || current.form.id !== milestoneId)
              return current;
            const form = toMilestoneForm(snapshot.milestone);
            return { ...current, form, initialForm: form, errors: {} };
          });
        } else {
          setLatestMilestoneSnapshot(snapshot);
        }
      })
      .catch(() => {
        if (requestId === milestoneSnapshotRequestRef.current)
          setMilestoneSnapshotLoadFailed(true);
      });
  };
  const openEditMilestone = (milestone: EditableMilestone) => {
    if (isMilestoneBusy) return;
    milestoneEditTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setMilestoneSnapshot(null);
    setLatestMilestoneSnapshot(null);
    setMilestoneSnapshotLoadFailed(false);
    const requestId = (milestoneSnapshotRequestRef.current += 1);
    void getEditableMilestone(milestone.id)
      .then((snapshot) => {
        if (requestId !== milestoneSnapshotRequestRef.current) return;
        setMilestoneSnapshot(snapshot);
        setMilestoneEditor((current) => {
          if (current.mode !== 'edit' || current.form.id !== milestone.id)
            return current;
          const form = toMilestoneForm(snapshot.milestone);
          return { ...current, form, initialForm: form, errors: {} };
        });
      })
      .catch(() => {
        if (requestId === milestoneSnapshotRequestRef.current)
          setMilestoneSnapshotLoadFailed(true);
      });
    setMilestoneEditor({
      mode: 'edit',
      form: toMilestoneForm(milestone),
      initialForm: toMilestoneForm(milestone),
      errors: {},
    });
    setGeneralAlert(null);
  };
  const updateMilestoneField = (
    field: ProgramMilestoneField,
    value: string,
  ) => {
    setMilestoneEditor((current) =>
      updateMilestoneEditor(current, field, value),
    );
  };

  const saveMilestone = async (
    event: React.FormEvent<HTMLFormElement>,
    documents?: ProgramMilestoneDraft['documents'],
  ) => {
    event.preventDefault();
    if (milestoneUploadRuntimeRef.current.submitting) return;
    if (milestoneEditor.mode === 'closed') return;
    if (milestoneEditor.mode === 'edit' && milestoneEditor.blocked) return;
    if (state.kind !== 'ready') return;
    setGeneralAlert(null);
    const persistedProgramForm = toProgramEditForm(state.program);
    const operation =
      milestoneEditor.mode === 'edit' && milestoneSnapshot !== null
        ? milestoneSnapshot.operation
        : {
            startAt:
              persistedProgramForm.originalStartAt ??
              persistedProgramForm.startAt,
            endAt: persistedProgramForm.endAtUndecided
              ? null
              : persistedProgramForm.originalEndAt,
          };
    const milestoneChanges = changedMilestoneFields(
      milestoneEditor.initialForm,
      milestoneEditor.form,
    );
    const validationForm = {
      ...milestoneEditor.form,
      startAt: milestoneChanges.includes('startAt')
        ? milestoneEditor.form.startAt
        : (milestoneEditor.form.originalStartAt ??
          milestoneEditor.form.startAt),
      dueAt: milestoneChanges.includes('dueAt')
        ? milestoneEditor.form.dueAt
        : (milestoneEditor.form.originalDueAt ?? milestoneEditor.form.dueAt),
    };
    const validationErrors = validateMilestoneForm(
      validationForm,
      operation.startAt,
      operation.endAt,
    );
    if (Object.keys(validationErrors).length > 0) {
      setMilestoneEditor((current) =>
        current.mode === 'closed'
          ? current
          : { ...current, errors: validationErrors },
      );
      return;
    }
    milestoneUploadRuntimeRef.current.submitting = true;
    setIsMilestoneBusy(true);
    try {
      if (
        milestoneEditor.mode === 'edit' &&
        documents !== undefined &&
        milestoneSnapshot !== null
      ) {
        const milestoneId = milestoneEditor.form.id;
        if (milestoneId === null) return;
        const documentError = validateLocalMilestoneDocuments(documents);
        if (documentError !== null) {
          setMilestoneEditor((current) =>
            current.mode === 'closed'
              ? current
              : { ...current, errors: { general: documentError } },
          );
          return;
        }
        const candidates = documents.current.flatMap((document) =>
          document.selectedFile === null
            ? []
            : [{ localId: document.localId, file: document.selectedFile }],
        );
        const uploadFailure = await preparePendingUploads({
          candidates,
          runtime: milestoneUploadRuntimeRef.current,
          api: {
            uploadFile: uploadAuthoringFile,
            deleteUpload: deleteAuthoringUpload,
          },
        });
        if (uploadFailure !== null) {
          setMilestoneEditor((current) =>
            current.mode === 'closed'
              ? current
              : { ...current, errors: { general: uploadFailure.message } },
          );
          return;
        }
        const uploads = candidates.flatMap((candidate) => {
          const upload = milestoneUploadRuntimeRef.current.uploads.get(
            candidate.localId,
          );
          return upload === undefined
            ? []
            : [{ localId: candidate.localId, uploadId: upload.id }];
        });
        const canonical = await updateEditableMilestone(milestoneId, {
          expectedFingerprint: milestoneSnapshot.fingerprint,
          name: milestoneEditor.form.name.trim(),
          startAt: buildMilestoneInput(
            milestoneEditor.form,
            changedMilestoneFields(
              milestoneEditor.initialForm,
              milestoneEditor.form,
            ),
          ).startAt,
          dueAt: buildMilestoneInput(
            milestoneEditor.form,
            changedMilestoneFields(
              milestoneEditor.initialForm,
              milestoneEditor.form,
            ),
          ).dueAt,
          instructions: milestoneEditor.form.instructions.trim() || null,
          documents: buildLocalMilestoneDocumentInputs(documents, uploads),
        });
        setCanonicalDocumentsByMilestoneId((current) => {
          const next = new Map(current);
          next.set(milestoneId, canonical.documents);
          return next;
        });
        setState((current) =>
          updateReadyProgram(current, (program) => ({
            ...program,
            milestones: program.milestones.map((milestone) =>
              milestone.id === milestoneId
                ? {
                    ...milestone,
                    ...canonical.milestone,
                  }
                : milestone,
            ),
          })),
        );
        uploads.forEach(({ localId }) => {
          milestoneUploadRuntimeRef.current.uploads.delete(localId);
          milestoneUploadRuntimeRef.current.uploadFiles.delete(localId);
        });
      } else if (milestoneEditor.mode === 'edit') {
        setMilestoneEditor((current) =>
          current.mode === 'closed'
            ? current
            : {
                ...current,
                errors: {
                  general:
                    '제출 항목을 불러오지 못했습니다. 다시 열어 새로고침해 주세요.',
                },
              },
        );
        return;
      } else {
        const input = buildMilestoneInput(
          milestoneEditor.form,
          changedMilestoneFields(
            milestoneEditor.initialForm,
            milestoneEditor.form,
          ),
        );
        const saved = await createMilestone(programId, input);
        setState((current) =>
          updateReadyProgram(current, (program) =>
            upsertMilestone(program, saved),
          ),
        );
      }
      setMilestoneEditor({ mode: 'closed' });
      setHasUnsavedMilestoneDocuments(false);
    } catch (error: unknown) {
      if (milestoneEditor.mode === 'edit') {
        const failure = editableMilestoneSnapshotFailure(error);
        setMilestoneEditor((current) =>
          current.mode === 'closed'
            ? current
            : {
                ...current,
                ...(failure.kind === 'known' ? {} : { blocked: true }),
                errors: {
                  general:
                    failure.kind === 'known'
                      ? failure.message
                      : failure.kind === 'conflict'
                        ? '다른 변경과 충돌했습니다. 입력은 유지됩니다. 새로고침한 뒤 내용을 확인하세요.'
                        : '저장 결과를 확인할 수 없습니다. 입력은 유지됩니다. 새로고침으로 서버 상태를 확인하세요.',
                },
              },
        );
        if (failure.kind === 'known') {
          failure.fieldErrors
            .filter(
              (field) =>
                field.code === 'INVALID_UPLOAD_TOKEN' &&
                /^documents\[(\d+)\]\.templateUploadId$/u.test(field.field),
            )
            .forEach((field) => {
              const index = Number(
                /^documents\[(\d+)\]\.templateUploadId$/u.exec(
                  field.field,
                )?.[1],
              );
              const localId = documents?.current[index]?.localId;
              if (localId === undefined) return;
              milestoneUploadRuntimeRef.current.uploads.delete(localId);
              milestoneUploadRuntimeRef.current.uploadFiles.delete(localId);
            });
          setMilestoneEditor((current) =>
            current.mode === 'closed'
              ? current
              : {
                  ...current,
                  errors: {
                    ...current.errors,
                    name: failure.fieldErrors.find(
                      (field) => field.field === 'name',
                    )?.message,
                    startAt: failure.fieldErrors.find(
                      (field) => field.field === 'startAt',
                    )?.message,
                    dueAt: failure.fieldErrors.find(
                      (field) => field.field === 'dueAt',
                    )?.message,
                    instructions: failure.fieldErrors.find(
                      (field) => field.field === 'instructions',
                    )?.message,
                  },
                },
          );
        }
        return;
      }
      setMilestoneEditor((current) =>
        current.mode === 'closed'
          ? current
          : { ...current, errors: mapMilestoneError(error) },
      );
    } finally {
      milestoneUploadRuntimeRef.current.submitting = false;
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
        isMilestoneBusy={isMilestoneBusy}
        milestoneSnapshot={milestoneSnapshot}
        canonicalDocumentsByMilestoneId={canonicalDocumentsByMilestoneId}
        canDeleteProgram={canDeleteProgram}
        onProgramDeleted={(notice) =>
          completeAndNavigate(
            notice
              ? `/programs?purged=${encodeURIComponent(notice)}`
              : '/programs',
          )
        }
        onFieldChange={updateField}
        onSubmit={(event) => void submit(event)}
        onAddMilestone={openAddMilestone}
        onEditMilestone={openEditMilestone}
        onCancelMilestone={() => {
          milestoneSnapshotRequestRef.current += 1;
          void cleanupPreparedUploads({
            runtime: milestoneUploadRuntimeRef.current,
            localIds: [...milestoneUploadRuntimeRef.current.uploads.keys()],
            deleteUpload: deleteAuthoringUpload,
          });
          setMilestoneEditor({ mode: 'closed' });
          setHasUnsavedMilestoneDocuments(false);
        }}
        onMilestoneFieldChange={updateMilestoneField}
        onSaveMilestone={(event, documents) =>
          void saveMilestone(event, documents)
        }
        onRefreshMilestone={() => {
          if (milestoneEditor.mode === 'edit' && milestoneEditor.form.id)
            refreshMilestoneSnapshot(milestoneEditor.form.id);
        }}
        latestMilestoneSnapshot={latestMilestoneSnapshot}
        milestoneSnapshotLoadFailed={milestoneSnapshotLoadFailed}
        onMilestoneDocumentsDirtyChange={setHasUnsavedMilestoneDocuments}
        onRestartMilestoneFromLatest={(snapshot) => {
          setMilestoneSnapshot(snapshot);
          setLatestMilestoneSnapshot(null);
          setMilestoneEditor((current) =>
            current.mode === 'edit'
              ? {
                  ...current,
                  form: toMilestoneForm(snapshot.milestone),
                  initialForm: toMilestoneForm(snapshot.milestone),
                  errors: {},
                  blocked: false,
                }
              : current,
          );
          setHasUnsavedMilestoneDocuments(false);
        }}
        onRequestDeleteMilestone={setDeleteTarget}
        onCancelDelete={() => setDeleteTarget(null)}
        onConfirmDelete={() => void confirmDelete()}
      />
    </div>
  );
}
