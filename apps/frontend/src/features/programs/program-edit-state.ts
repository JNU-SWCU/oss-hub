import type { EditableMilestone, EditableProgram } from './api';
import {
  changedMilestoneFields,
  type ProgramEditableField,
  type ProgramEditForm,
  type ProgramMilestoneEditor,
  type ProgramMilestoneField,
  type ProgramMilestoneForm,
} from './program-edit-flow';
import { PROGRAM_TEMPLATE_DEFINITIONS } from './program-templates';

export type ProgramEditLoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly program: EditableProgram };

export function updateProgramForm(
  form: ProgramEditForm,
  field: ProgramEditableField,
  value: string | boolean,
): ProgramEditForm {
  switch (field) {
    case 'repositoryProvisioningEnabled':
      return typeof value === 'boolean'
        ? { ...form, repositoryProvisioningEnabled: value }
        : form;
    case 'notifyOnDeadline':
      return typeof value === 'boolean'
        ? { ...form, notifyOnDeadline: value }
        : form;
    /**
     * 「미정」을 켜면 날짜 칸을 비운다 — 비활성 칸에 남은 날짜는 저장에 쓰이지
     * 않으므로(`buildProgramEditInput`) 화면에 남겨 두면 뜻이 두 개로 보인다.
     */
    case 'endAtUndecided':
      return typeof value === 'boolean'
        ? { ...form, endAtUndecided: value, endAt: value ? '' : form.endAt }
        : form;
    case 'category':
      return typeof value === 'string'
        ? { ...form, category: toCategory(value, form.category) }
        : form;
    default:
      return typeof value === 'string' ? { ...form, [field]: value } : form;
  }
}

export function updateMilestoneEditor(
  editor: ProgramMilestoneEditor,
  field: ProgramMilestoneField,
  value: string,
): ProgramMilestoneEditor {
  if (editor.mode === 'closed') return editor;
  return {
    ...editor,
    errors: {},
    form: {
      ...editor.form,
      [field]: value,
    },
  };
}

export function addDirtyField<T extends string>(
  current: readonly T[],
  field: T,
): readonly T[] {
  return current.includes(field) ? current : [...current, field];
}

export function isMilestoneFormDirty(
  initial: ProgramMilestoneForm,
  current: ProgramMilestoneForm,
): boolean {
  return changedMilestoneFields(initial, current).length > 0;
}

export function hasUnsavedMilestoneEdit(
  editor: ProgramMilestoneEditor,
): boolean {
  switch (editor.mode) {
    case 'closed':
      return false;
    case 'create':
    case 'edit':
      return isMilestoneFormDirty(editor.initialForm, editor.form);
  }
}

export function updateReadyProgram(
  state: ProgramEditLoadState,
  update: (program: EditableProgram) => EditableProgram,
): ProgramEditLoadState {
  return state.kind === 'ready'
    ? { kind: 'ready', program: update(state.program) }
    : state;
}

export function upsertMilestone(
  program: EditableProgram,
  saved: EditableMilestone,
): EditableProgram {
  const exists = program.milestones.some(
    (milestone) => milestone.id === saved.id,
  );
  const milestones = exists
    ? program.milestones.map((milestone) =>
        milestone.id === saved.id ? saved : milestone,
      )
    : [...program.milestones, saved];
  return {
    ...program,
    milestones: sortMilestones(milestones),
  };
}

/** dueAt ASC, then id ASC as a stable tie-break when createdAt is not on the DTO. */
export function sortMilestones(
  milestones: readonly EditableMilestone[],
): EditableMilestone[] {
  return [...milestones].sort((a, b) => {
    const byDue = a.dueAt.localeCompare(b.dueAt);
    if (byDue !== 0) return byDue;
    return a.id.localeCompare(b.id);
  });
}

export function removeMilestone(
  state: ProgramEditLoadState,
  milestoneId: string,
): ProgramEditLoadState {
  return updateReadyProgram(state, (program) => ({
    ...program,
    milestones: program.milestones.filter(
      (milestone) => milestone.id !== milestoneId,
    ),
  }));
}

function toCategory(
  value: string,
  fallback: ProgramEditForm['category'],
): ProgramEditForm['category'] {
  const match = PROGRAM_TEMPLATE_DEFINITIONS.find(
    (item) => item.category === value,
  );
  return match?.category ?? fallback;
}
