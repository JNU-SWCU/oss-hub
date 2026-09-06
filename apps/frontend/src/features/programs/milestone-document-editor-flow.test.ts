import { describe, expect, it } from 'vitest';
import type { MilestoneDocument } from './milestone-document-api';
import {
  addLocalMilestoneDocument,
  buildLocalMilestoneDocumentInputs,
  isLocalMilestoneDocumentsDirty,
  removeLocalMilestoneDocument,
  reorderLocalMilestoneDocuments,
  toLocalMilestoneDocuments,
  updateLocalMilestoneDocument,
  validateLocalMilestoneDocuments,
} from './milestone-document-editor-flow';
import { MAX_REQUIREMENTS_PER_MILESTONE } from './program-authoring-graph-validation';

const persisted: MilestoneDocument = {
  id: 'document-1',
  milestoneId: 'milestone-1',
  name: '계획서',
  required: true,
  sortOrder: 1,
  hasTemplateFile: true,
  templateFileName: 'plan.pdf',
};

describe('local milestone document draft', () => {
  it('keeps persisted filename separate from a selected File and detects exact revert', () => {
    const initial = toLocalMilestoneDocuments([persisted]);
    const selected = new File(['replacement'], 'replacement.pdf', {
      type: 'application/pdf',
    });
    const changed = updateLocalMilestoneDocument(initial, 'document-1', {
      selectedFile: selected,
    });
    expect(changed.current[0]?.persistedTemplateFileName).toBe('plan.pdf');
    expect(changed.current[0]?.selectedFile).toBe(selected);
    expect(isLocalMilestoneDocumentsDirty(changed)).toBe(true);
    expect(
      isLocalMilestoneDocumentsDirty(
        updateLocalMilestoneDocument(changed, 'document-1', {
          selectedFile: null,
        }),
      ),
    ).toBe(false);
  });

  it('keeps local add/remove/reorder/name/required mutations in the draft only', () => {
    const initial = toLocalMilestoneDocuments([persisted]);
    const added = addLocalMilestoneDocument(initial, 'new-local');
    const changed = updateLocalMilestoneDocument(added, 'new-local', {
      name: '결과서',
      required: false,
    });
    const reordered = reorderLocalMilestoneDocuments(changed, [
      'new-local',
      'document-1',
    ]);
    expect(reordered.current.map((document) => document.sortOrder)).toEqual([
      1, 2,
    ]);
    expect(
      removeLocalMilestoneDocument(reordered, 'new-local').current,
    ).toEqual(initial.current);
  });

  it.each([
    ['duplicate', ['document-1', 'document-1']],
    ['missing', []],
    ['foreign', ['document-1', 'foreign-local']],
  ])(
    'does not lose or duplicate rows for a %s reorder permutation',
    (_, localIds) => {
      const documents = addLocalMilestoneDocument(
        toLocalMilestoneDocuments([persisted]),
        'new-local',
      );

      expect(reorderLocalMilestoneDocuments(documents, localIds)).toBe(
        documents,
      );
      expect(documents.current.map((document) => document.localId)).toEqual([
        'document-1',
        'new-local',
      ]);
    },
  );

  it('allows an empty draft only when its persisted baseline was empty', () => {
    expect(validateLocalMilestoneDocuments(toLocalMilestoneDocuments([]))).toBe(
      null,
    );
    expect(
      validateLocalMilestoneDocuments(
        removeLocalMilestoneDocument(
          toLocalMilestoneDocuments([persisted]),
          'document-1',
        ),
      ),
    ).toBe(
      '마일스톤에는 제출 항목이 하나 이상 필요합니다. 새 항목을 만든 뒤 기존 항목을 삭제해 주세요.',
    );
  });

  it('rejects more than the shared per-milestone document limit', () => {
    let documents = toLocalMilestoneDocuments([]);
    for (let index = 0; index <= MAX_REQUIREMENTS_PER_MILESTONE; index += 1) {
      const localId = `new-local-${index}`;
      documents = updateLocalMilestoneDocument(
        addLocalMilestoneDocument(documents, localId),
        localId,
        { name: `제출 항목 ${index}` },
      );
    }

    expect(validateLocalMilestoneDocuments(documents)).toBe(
      `제출 항목은 최대 ${MAX_REQUIREMENTS_PER_MILESTONE}개입니다.`,
    );
  });

  it('builds full aggregate input with persisted IDs, null new IDs, and upload tokens', () => {
    const initial = toLocalMilestoneDocuments([persisted]);
    const documents = updateLocalMilestoneDocument(
      addLocalMilestoneDocument(initial, 'new-local'),
      'new-local',
      { name: '결과서' },
    );
    expect(
      buildLocalMilestoneDocumentInputs(documents, [
        { localId: 'new-local', uploadId: 'upload-1' },
      ]),
    ).toEqual([
      { id: 'document-1', name: '계획서', required: true },
      {
        id: null,
        name: '결과서',
        required: true,
        templateUploadId: 'upload-1',
      },
    ]);
  });
});
