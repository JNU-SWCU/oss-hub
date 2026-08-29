import { describe, expect, it } from 'vitest';
import {
  milestoneDocumentDropTarget,
  type MilestoneDocumentDropZone,
} from './milestone-document-pointer';

const zones: readonly MilestoneDocumentDropZone[] = [
  { documentId: 'a', top: 0, bottom: 100, left: 10, right: 310, centerY: 50 },
  {
    documentId: 'b',
    top: 110,
    bottom: 210,
    left: 10,
    right: 310,
    centerY: 160,
  },
  {
    documentId: 'c',
    top: 220,
    bottom: 320,
    left: 10,
    right: 310,
    centerY: 270,
  },
];

describe('milestoneDocumentDropTarget', () => {
  it('처음 측정한 행 중심과 가장 가까운 항목을 고른다', () => {
    expect(milestoneDocumentDropTarget(zones, { x: 100, y: 285 })).toBe('c');
    expect(milestoneDocumentDropTarget(zones, { x: 100, y: 140 })).toBe('b');
  });

  it('목록 밖에 놓으면 이동을 취소한다', () => {
    expect(milestoneDocumentDropTarget(zones, { x: 0, y: 160 })).toBeNull();
    expect(milestoneDocumentDropTarget(zones, { x: 100, y: 400 })).toBeNull();
  });
});
