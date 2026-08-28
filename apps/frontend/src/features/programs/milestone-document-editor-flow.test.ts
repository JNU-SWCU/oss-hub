import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import type { MilestoneDocument } from './milestone-document-api';
import {
  buildMilestoneDocumentInput,
  emptyMilestoneDocumentForm,
  mergeMilestoneDocument,
  mergeMilestoneDocumentList,
  milestoneDocumentErrorMessage,
  milestoneDocumentSaveSortOrder,
  nextMilestoneDocumentSortOrder,
  planMilestoneDocumentOrder,
  removeMilestoneDocumentFromList,
  sortMilestoneDocuments,
  toMilestoneDocumentForm,
  updateMilestoneDocumentEditor,
  upsertMilestoneDocumentInList,
  validateMilestoneDocumentForm,
  type MilestoneDocumentEditor,
} from './milestone-document-editor-flow';

function document(
  id: string,
  sortOrder: number,
  overrides: Partial<MilestoneDocument> = {},
): MilestoneDocument {
  return {
    id,
    milestoneId: 'milestone-1',
    name: `서류 ${id}`,
    required: true,
    sortOrder,
    submissionType: 'FILE',
    hasTemplateFile: false,
    templateFileName: null,

    ...overrides,
  };
}

const planner = document('a', 1, { name: '계획서' });
const budget = document('b', 2, { name: '예산서', submissionType: 'TEXT' });
const pledge = document('c', 3, {
  name: '서약서',
  submissionType: 'TEXT',
  required: false,
});

describe('sortMilestoneDocuments', () => {
  it('sortOrder 오름차순으로 그린다', () => {
    const sorted = sortMilestoneDocuments([pledge, planner, budget]);

    expect(sorted.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(sorted.map((item) => item.sortOrder)).toEqual([1, 2, 3]);
  });

  it('sortOrder가 같으면 id로 안정 정렬한다', () => {
    const sorted = sortMilestoneDocuments([
      document('z', 5),
      document('k', 5),
      document('a', 5),
    ]);

    expect(sorted.map((item) => item.id)).toEqual(['a', 'k', 'z']);
  });

  it('원본 배열을 바꾸지 않는다', () => {
    const input = [pledge, planner];
    sortMilestoneDocuments(input);

    expect(input.map((item) => item.id)).toEqual(['c', 'a']);
  });
});

describe('nextMilestoneDocumentSortOrder', () => {
  it('새 항목은 기존 최대 sortOrder + 1이다', () => {
    expect(nextMilestoneDocumentSortOrder([planner, pledge, budget])).toBe(4);
  });

  it('항목이 없으면 1부터 시작한다', () => {
    expect(nextMilestoneDocumentSortOrder([])).toBe(1);
  });

  it('0 이하 값만 있어도 1 아래로 내려가지 않는다', () => {
    expect(nextMilestoneDocumentSortOrder([document('a', -5)])).toBe(1);
  });
});

describe('milestoneDocumentSaveSortOrder', () => {
  it('새 항목은 맨 뒤 자리를 받는다', () => {
    expect(milestoneDocumentSaveSortOrder([planner, budget], null)).toBe(3);
  });

  it('수정은 원래 자리를 지킨다 — 전체 교체 PATCH라 빠뜨리면 순서가 흐트러진다', () => {
    expect(milestoneDocumentSaveSortOrder([planner, budget], 'a')).toBe(1);
  });

  it('목록에 없는 id는 맨 뒤로 떨어진다', () => {
    expect(milestoneDocumentSaveSortOrder([planner, budget], 'gone')).toBe(3);
  });
});

// 계약 변경(2026-08): 드래그로 순서를 바꾼 뒤 두 항목을 각각 PATCH하는 대신 전체 순서를
// 한 번에 보낸다. 그래서 이 함수가 돌려주는 것도 「PATCH 본문 두 개」가 아니라
// **마일스톤 제출 항목 전체를 드롭 결과대로 나열한 id 배열**이다.
describe('planMilestoneDocumentOrder', () => {
  const documents = [planner, budget, pledge];

  it('드롭한 위치까지 항목을 옮긴 전체 순서를 만든다', () => {
    expect(planMilestoneDocumentOrder(documents, 'a', 'c')).toEqual([
      'b',
      'c',
      'a',
    ]);
  });

  it('위쪽으로 드롭해도 같은 방식이다', () => {
    expect(planMilestoneDocumentOrder(documents, 'c', 'a')).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  // 부분 목록을 보내면 서버가 400(MSD_019)으로 거절한다 — 움직인 두 항목만 담아
  // 보내는 옛 방식으로 되돌아가지 않도록 길이를 못 박는다.
  it('움직인 두 항목만이 아니라 마일스톤 서류 전체를 담는다', () => {
    const documentIds = planMilestoneDocumentOrder(documents, 'a', 'c');

    expect(documentIds).toHaveLength(documents.length);
    expect([...(documentIds ?? [])].sort()).toEqual(['a', 'b', 'c']);
  });

  it('같은 자리에 놓으면 보낼 요청이 없다', () => {
    expect(planMilestoneDocumentOrder(documents, 'a', 'a')).toBeNull();
  });

  it('집은 항목이나 놓을 항목을 찾을 수 없으면 계획을 만들지 않는다', () => {
    expect(planMilestoneDocumentOrder(documents, 'gone', 'a')).toBeNull();
    expect(planMilestoneDocumentOrder(documents, 'a', 'gone')).toBeNull();
  });

  /**
   * 계약 변경 전에는 여기서 `null`을 돌려줬다. sortOrder가 겹친 목록은 두 항목을 각각
   * PATCH하다 한쪽만 성공했을 때 생기는 바로 그 상태였고, 그때 아무 일도 하지 않으면
   * 「위로」가 영영 먹지 않는 덫이 된다. 이제는 순서를 통째로 보내 서버가 1부터 다시
   * 매기므로, 같은 값이야말로 빠져나올 수 있어야 한다.
   */
  it('sortOrder가 같아 굳어 버린 목록에서도 자리를 바꾼다', () => {
    expect(
      planMilestoneDocumentOrder(
        [document('a', 7), document('b', 7)],
        'a',
        'b',
      ),
    ).toEqual(['b', 'a']);
  });

  it('정렬되지 않은 입력에서도 화면에 보이는 위치로 옮긴다', () => {
    expect(
      planMilestoneDocumentOrder([pledge, planner, budget], 'c', 'a'),
    ).toEqual(['c', 'a', 'b']);
  });
});

describe('validateMilestoneDocumentForm', () => {
  it('서류명은 필수다', () => {
    expect(
      validateMilestoneDocumentForm({
        ...emptyMilestoneDocumentForm(),
        name: '   ',
      }),
    ).toEqual({ name: '서류명을 입력해 주세요.' });
  });

  it('이름이 있으면 오류가 없다', () => {
    expect(
      validateMilestoneDocumentForm({
        ...emptyMilestoneDocumentForm(),
        name: '계획서',
      }),
    ).toEqual({});
  });
});

describe('buildMilestoneDocumentInput', () => {
  it('이름의 앞뒤 공백을 떼고 sortOrder를 그대로 싣는다', () => {
    expect(
      buildMilestoneDocumentInput(
        {
          id: null,
          name: '  계획서  ',
          required: false,
          submissionType: 'TEXT',
        },
        4,
      ),
    ).toEqual({
      name: '계획서',
      required: false,
      sortOrder: 4,
    });
  });
});

describe('updateMilestoneDocumentEditor', () => {
  const open: MilestoneDocumentEditor = {
    mode: 'edit',
    form: toMilestoneDocumentForm(planner),
    errors: { name: '서류명을 입력해 주세요.' },
  };

  it('입력이 바뀌면 이전 오류를 지운다', () => {
    const next = updateMilestoneDocumentEditor(open, 'name', '예산서');

    expect(next).toMatchObject({ errors: {} });
    expect(next.mode === 'closed' ? null : next.form.name).toBe('예산서');
  });

  it('필수 여부는 boolean으로만 바뀐다', () => {
    const next = updateMilestoneDocumentEditor(open, 'required', false);

    expect(next.mode === 'closed' ? null : next.form.required).toBe(false);
  });

  it('닫힌 편집기는 그대로 둔다', () => {
    const closed: MilestoneDocumentEditor = { mode: 'closed' };

    expect(updateMilestoneDocumentEditor(closed, 'name', '계획서')).toBe(
      closed,
    );
  });

  describe('제출이 있는 항목의 편집', () => {
    const locked: MilestoneDocumentEditor = {
      mode: 'edit',
      form: toMilestoneDocumentForm(planner),
      errors: {},
    };

    it('제출 이력이 있어도 이름과 필수 여부는 고칠 수 있다', () => {
      const renamed = updateMilestoneDocumentEditor(locked, 'name', '수정본');

      expect(renamed.mode === 'closed' ? null : renamed.form.name).toBe(
        '수정본',
      );
      expect(
        updateMilestoneDocumentEditor(locked, 'required', false),
      ).toMatchObject({ form: { required: false } });
    });
  });
});

describe('목록 갱신', () => {
  it('새로 만든 항목은 정렬된 자리에 끼워 넣는다', () => {
    const added = upsertMilestoneDocumentInList(
      [budget, planner],
      document('d', 0, { name: '동의서' }),
    );

    expect(added.map((item) => item.id)).toEqual(['d', 'a', 'b']);
  });

  it('같은 id는 새 값으로 갈아 끼운다', () => {
    const updated = upsertMilestoneDocumentInList([planner, budget], {
      ...planner,
      name: '수정된 계획서',
    });

    expect(updated).toHaveLength(2);
    expect(updated[0]?.name).toBe('수정된 계획서');
  });

  /**
   * 수정(PATCH)·재정렬 응답에는 `teamSubmissionCount`가 없다 — 그 값은 목록 조회에서만
   * 채워진다. 응답으로 통째로 갈아 끼우면 화면에 보이던 제출 수가 사라진다.
   */
  it('수정 응답이 제출 수를 안 실어 와도 손에 있던 값을 지킨다', () => {
    const withCount = document('a', 1, {
      name: '계획서',
      teamSubmissionCount: { submitted: 3, total: 8 },
    });
    const patched = document('a', 1, { name: '이름만 바꾼 계획서' });

    const updated = upsertMilestoneDocumentInList([withCount, budget], patched);
    const merged = updated[0] as MilestoneDocument;

    expect(merged.name).toBe('이름만 바꾼 계획서');
    expect(merged.teamSubmissionCount).toEqual({ submitted: 3, total: 8 });
  });

  it('응답이 제출 수를 실어 오면 서버 값이 이긴다', () => {
    const withCount = document('a', 1, {
      teamSubmissionCount: { submitted: 3, total: 8 },
    });
    const patched = document('a', 1, {
      teamSubmissionCount: { submitted: 5, total: 8 },
    });

    expect(
      upsertMilestoneDocumentInList([withCount], patched)[0]
        ?.teamSubmissionCount,
    ).toEqual({ submitted: 5, total: 8 });
  });

  it('새로 만든 항목에는 지킬 제출 수가 없다', () => {
    expect(mergeMilestoneDocument(undefined, planner)).toBe(planner);
  });

  it('재정렬 응답은 순서를 그대로 받되 모든 행의 제출 수를 지킨다', () => {
    const previous = [
      document('a', 1, {
        name: '계획서',
        teamSubmissionCount: { submitted: 3, total: 8 },
      }),
      document('b', 2, {
        name: '예산서',
        teamSubmissionCount: { submitted: 1, total: 8 },
      }),
    ];
    // 서버가 sortOrder를 1부터 다시 매겨 돌려주는 응답 — 제출 수는 실리지 않는다.
    const reordered = [
      document('b', 1, { name: '예산서' }),
      document('a', 2, { name: '계획서' }),
    ];

    const merged = mergeMilestoneDocumentList(previous, reordered);

    expect(merged.map((item) => item.id)).toEqual(['b', 'a']);
    expect(merged.map((item) => item.sortOrder)).toEqual([1, 2]);
    expect(merged.map((item) => item.teamSubmissionCount?.submitted)).toEqual([
      1, 3,
    ]);
  });

  it('삭제는 해당 id만 빼낸다', () => {
    expect(
      removeMilestoneDocumentFromList([planner, budget, pledge], 'b').map(
        (item) => item.id,
      ),
    ).toEqual(['a', 'c']);
  });
});

describe('milestoneDocumentErrorMessage', () => {
  it('서버가 준 detail을 그대로 보여 준다', () => {
    const error = new ApiError({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: '이미 제출물이 있어 삭제할 수 없습니다.',
      instance: '/milestones/milestone-1/documents/a',
      code: 'MSD_010',
    });

    expect(milestoneDocumentErrorMessage(error, '기본 문구')).toBe(
      '이미 제출물이 있어 삭제할 수 없습니다.',
    );
  });

  it('ApiError가 아니면 화면 기본 문구로 떨어진다', () => {
    expect(
      milestoneDocumentErrorMessage(new TypeError('network'), '기본 문구'),
    ).toBe('기본 문구');
  });
});
