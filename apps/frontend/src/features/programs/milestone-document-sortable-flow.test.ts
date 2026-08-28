import { describe, expect, it } from 'vitest';
import type { MilestoneDocument } from './milestone-document-api';
import {
  milestoneDocumentPosition,
  orderMilestoneDocumentsByIds,
} from './milestone-document-sortable-flow';

function document(id: string): MilestoneDocument {
  return {
    id,
    milestoneId: 'milestone-1',
    name: `항목 ${id}`,
    required: true,
    sortOrder: 1,
    submissionType: 'FILE',
    hasTemplateFile: false,
    templateFileName: null,
  };
}

describe('orderMilestoneDocumentsByIds', () => {
  const documents = [document('a'), document('b'), document('c')];

  it('id 순서대로 항목을 다시 나열한다', () => {
    expect(
      orderMilestoneDocumentsByIds(documents, ['b', 'c', 'a']).map(
        (item) => item.id,
      ),
    ).toEqual(['b', 'c', 'a']);
  });

  it('빠진 id가 있으면 안전하게 원래 목록을 유지한다', () => {
    expect(orderMilestoneDocumentsByIds(documents, ['a', 'gone'])).toBe(
      documents,
    );
  });
});

describe('milestoneDocumentPosition', () => {
  it('항목 위치와 없는 항목의 -1을 돌려준다', () => {
    const documents = [document('a'), document('b')];

    expect(milestoneDocumentPosition(documents, 'b')).toBe(1);
    expect(milestoneDocumentPosition(documents, 'gone')).toBe(-1);
  });
});
