import { describe, expect, it } from 'vitest';
import type { EditableMilestone, EditableProgram } from './api';
import {
  buildMilestoneInput,
  changedMilestoneFields,
  emptyMilestoneForm,
  toMilestoneForm,
  type ProgramMilestoneField,
} from './program-edit-flow';
import {
  hasUnsavedMilestoneEdit,
  isMilestoneFormDirty,
  updateMilestoneEditor,
  upsertMilestone,
} from './program-edit-state';

const milestone: EditableMilestone = {
  id: 'milestone-1',
  name: '기획서',
  startAt: '2026-08-16T09:30:59.000Z',
  dueAt: '2026-08-20T09:30:59.000Z',
  submissionType: 'TEXT',
  instructions: '초안 제출',
};

const program: EditableProgram = {
  id: 'program-1',
  name: 'OSS',
  organizer: 'Center',
  trackType: 'EXTRACURRICULAR',
  lifecycle: 'PUBLISHED',
  applicationTemplateKey: 'oss-contest',
  applicationTemplateVersion: 1,
  applicationCount: 0,
  applicationStartAt: '2026-08-01T09:30:59.000Z',
  applicationEndAt: '2026-08-15T09:30:59.000Z',
  startAt: '2026-08-16T09:30:59.000Z',
  endAt: '2026-08-31T09:30:59.000Z',
  repositoryProvisioningEnabled: false,
  notifyOnDeadline: false,
  description: 'overview',
  teamMinSize: 2,
  teamMaxSize: 4,
  milestones: [],
};

describe('milestone edit dialog state', () => {
  const trackedChanges: ReadonlyArray<{
    readonly field: ProgramMilestoneField;
    readonly value: string;
  }> = [
    { field: 'name', value: '변경' },
    { field: 'startAt', value: '2026-08-17T10:00' },
    { field: 'dueAt', value: '2026-08-21T18:00' },
    { field: 'instructions', value: '수정 안내' },
  ];

  it.each(trackedChanges)(
    '$field 필드 하나만 바꾸면 해당 필드만 변경으로 파생한다',
    ({ field, value }) => {
      // Given
      const initial = toMilestoneForm(milestone);
      const current = { ...initial, [field]: value };

      // When / Then
      expect(changedMilestoneFields(initial, current)).toEqual([field]);
      expect(isMilestoneFormDirty(initial, current)).toBe(true);
    },
  );

  it('여러 필드를 바꾸고 일부만 되돌리면 선언 순서의 나머지 변경만 남는다', () => {
    // Given
    const initial = toMilestoneForm(milestone);
    const changed = {
      ...initial,
      instructions: '변경 안내',
      name: '변경 이름',
      startAt: '2026-08-17T10:00',
      dueAt: '2026-08-22T18:00',
    };

    // When
    const partiallyReverted = {
      ...changed,
      name: initial.name,
      startAt: initial.startAt,
    };

    // Then
    expect(changedMilestoneFields(initial, partiallyReverted)).toEqual([
      'dueAt',
      'instructions',
    ]);
    expect(changedMilestoneFields(initial, { ...initial })).toEqual([]);
    expect(isMilestoneFormDirty(initial, { ...initial })).toBe(false);
  });

  it('API null 안내는 빈 폼으로 정규화되고 빈 값으로 되돌리면 다시 clean 이다', () => {
    // Given
    const initial = toMilestoneForm({ ...milestone, instructions: null });
    const changed = { ...initial, instructions: '안내 추가' };

    // When / Then
    expect(initial.instructions).toBe('');
    expect(changedMilestoneFields(initial, changed)).toEqual(['instructions']);
    expect(
      changedMilestoneFields(initial, { ...changed, instructions: '' }),
    ).toEqual([]);
  });

  it('create와 edit 모두 초기 스냅샷으로 clean을 판정하고 현재 폼 변경이 스냅샷을 바꾸지 않는다', () => {
    // Given
    const empty = emptyMilestoneForm();
    const editInitial = toMilestoneForm(milestone);
    const createEditor = {
      mode: 'create',
      initialForm: empty,
      form: empty,
      errors: {},
    } as const;
    const editEditor = {
      mode: 'edit',
      initialForm: editInitial,
      form: editInitial,
      errors: {},
    } as const;

    // When
    const changedCreate = updateMilestoneEditor(
      createEditor,
      'name',
      '새 마일스톤',
    );
    const changedEdit = updateMilestoneEditor(
      editEditor,
      'name',
      '수정 마일스톤',
    );
    const revertedCreate = updateMilestoneEditor(
      changedCreate,
      'name',
      empty.name,
    );

    // Then
    expect(hasUnsavedMilestoneEdit(createEditor)).toBe(false);
    expect(hasUnsavedMilestoneEdit(editEditor)).toBe(false);
    expect(hasUnsavedMilestoneEdit(changedCreate)).toBe(true);
    expect(hasUnsavedMilestoneEdit(changedEdit)).toBe(true);
    expect(hasUnsavedMilestoneEdit(revertedCreate)).toBe(false);
    expect(createEditor.initialForm).toBe(empty);
    expect(createEditor.form).toBe(empty);
    expect(createEditor.initialForm.name).toBe('');
    expect(editEditor.initialForm.name).toBe(milestone.name);
  });

  it('닫고 다른 편집기를 열면 새 스냅샷에서 clean으로 시작한다', () => {
    // Given
    const firstInitial = toMilestoneForm(milestone);
    const dirtyFirst = updateMilestoneEditor(
      {
        mode: 'edit',
        initialForm: firstInitial,
        form: firstInitial,
        errors: {},
      },
      'name',
      '첫 편집',
    );
    const secondInitial = toMilestoneForm({
      ...milestone,
      id: 'milestone-2',
      name: '발표',
    });

    // When
    const reopened = {
      mode: 'edit',
      initialForm: secondInitial,
      form: secondInitial,
      errors: {},
    } as const;

    // Then
    expect(hasUnsavedMilestoneEdit(dirtyFirst)).toBe(true);
    expect(hasUnsavedMilestoneEdit({ mode: 'closed' })).toBe(false);
    expect(hasUnsavedMilestoneEdit(reopened)).toBe(false);
  });

  it('변경하지 않은 ISO 날짜는 바이트 단위로 유지하고 한 날짜만 바꾸면 그 날짜만 직렬화한다', () => {
    // Given
    const initial = toMilestoneForm(milestone);
    const dueOnly = { ...initial, dueAt: '2026-08-21T18:00' };

    // When
    const unchangedInput = buildMilestoneInput(
      initial,
      changedMilestoneFields(initial, initial),
    );
    const dueOnlyInput = buildMilestoneInput(
      dueOnly,
      changedMilestoneFields(initial, dueOnly),
    );
    const revertedInput = buildMilestoneInput(
      { ...dueOnly, dueAt: initial.dueAt },
      changedMilestoneFields(initial, { ...dueOnly, dueAt: initial.dueAt }),
    );

    // Then
    expect(unchangedInput.startAt).toBe(milestone.startAt);
    expect(unchangedInput.dueAt).toBe(milestone.dueAt);
    expect(dueOnlyInput.startAt).toBe(milestone.startAt);
    expect(dueOnlyInput.dueAt).toBe('2026-08-21T09:00:00.000Z');
    expect(revertedInput.dueAt).toBe(milestone.dueAt);
  });

  it('startAt만 바꾸면 dueAt은 원본 ISO 바이트를 유지한다', () => {
    // Given
    const initial = toMilestoneForm(milestone);
    const current = { ...initial, startAt: '2026-08-17T10:00' };

    // When
    const input = buildMilestoneInput(
      current,
      changedMilestoneFields(initial, current),
    );

    // Then
    expect(input.startAt).toBe('2026-08-17T01:00:00.000Z');
    expect(input.dueAt).toBe(milestone.dueAt);
  });

  it('treats an unchanged or reverted form as clean', () => {
    const initial = toMilestoneForm(milestone);
    expect(isMilestoneFormDirty(initial, initial)).toBe(false);
    expect(isMilestoneFormDirty(initial, { ...initial, name: '변경' })).toBe(
      true,
    );
    expect(
      isMilestoneFormDirty(initial, { ...initial, name: initial.name }),
    ).toBe(false);
    expect(
      hasUnsavedMilestoneEdit({
        mode: 'edit',
        initialForm: initial,
        form: { ...initial, name: initial.name },
        errors: {},
      }),
    ).toBe(false);
  });

  it('preserves the original startAt when only the name changes', () => {
    const initial = toMilestoneForm(milestone);
    expect(initial.originalStartAt).toBe(milestone.startAt);
  });

  it('upserts only the saved milestone and leaves its neighbor unchanged', () => {
    const adjacent = { ...milestone, id: 'milestone-2', name: '발표' };
    const saved = { ...milestone, name: '기획서 수정' };
    const updated = upsertMilestone(
      { ...program, milestones: [milestone, adjacent] },
      saved,
    );
    expect(updated.milestones.find(({ id }) => id === adjacent.id)).toBe(
      adjacent,
    );
    expect(updated.milestones.find(({ id }) => id === milestone.id)).toEqual(
      saved,
    );
  });
});
