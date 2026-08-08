import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import type { MilestoneDocument } from './milestone-document-api';
import {
  buildMilestoneDocumentInput,
  emptyMilestoneDocumentForm,
  milestoneDocumentErrorMessage,
  milestoneDocumentSaveSortOrder,
  nextMilestoneDocumentSortOrder,
  planMilestoneDocumentMove,
  removeMilestoneDocumentFromList,
  sortMilestoneDocuments,
  SUBMISSION_TYPE_CHOICES,
  submissionTypeLabel,
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
    ...overrides,
  };
}

const planner = document('a', 1, { name: '계획서' });
const budget = document('b', 2, { name: '예산서', submissionType: 'TEXT' });
const pledge = document('c', 3, {
  name: '서약서',
  submissionType: 'REPOSITORY_RELEASE',
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

describe('planMilestoneDocumentMove', () => {
  const documents = [planner, budget, pledge];

  it('아래로는 이웃과 sortOrder를 맞바꾸고 두 항목 모두 PATCH한다', () => {
    const plan = planMilestoneDocumentMove(documents, 'a', 'down');

    expect(plan).not.toBeNull();
    expect(plan?.requests).toHaveLength(2);
    expect(
      plan?.requests.map((request) => [
        request.documentId,
        request.input.sortOrder,
      ]),
    ).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
    expect(plan?.documents.map((item) => item.id)).toEqual(['b', 'a', 'c']);
  });

  it('위로도 같은 방식으로 두 건을 만든다', () => {
    const plan = planMilestoneDocumentMove(documents, 'c', 'up');

    expect(plan?.requests.map((request) => request.documentId)).toEqual([
      'c',
      'b',
    ]);
    expect(plan?.documents.map((item) => item.id)).toEqual(['a', 'c', 'b']);
  });

  it('PATCH 본문은 sortOrder만이 아니라 항목 전체를 담는다', () => {
    const plan = planMilestoneDocumentMove(documents, 'b', 'down');

    expect(plan?.requests[0]?.input).toEqual({
      name: '예산서',
      required: true,
      sortOrder: 3,
      submissionType: 'TEXT',
    });
    expect(plan?.requests[1]?.input).toEqual({
      name: '서약서',
      required: false,
      sortOrder: 2,
      submissionType: 'REPOSITORY_RELEASE',
    });
  });

  it('맨 위에서 위로, 맨 아래에서 아래로는 보낼 요청이 없다', () => {
    expect(planMilestoneDocumentMove(documents, 'a', 'up')).toBeNull();
    expect(planMilestoneDocumentMove(documents, 'c', 'down')).toBeNull();
  });

  it('모르는 id는 계획을 만들지 않는다', () => {
    expect(planMilestoneDocumentMove(documents, 'gone', 'up')).toBeNull();
  });

  it('sortOrder가 같아 맞바꿔도 순서가 그대로면 요청을 만들지 않는다', () => {
    expect(
      planMilestoneDocumentMove(
        [document('a', 7), document('b', 7)],
        'a',
        'down',
      ),
    ).toBeNull();
  });

  it('정렬되지 않은 입력에서도 화면에 보이는 이웃과 맞바꾼다', () => {
    const plan = planMilestoneDocumentMove(
      [pledge, planner, budget],
      'c',
      'up',
    );

    expect(plan?.requests.map((request) => request.documentId)).toEqual([
      'c',
      'b',
    ]);
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
      submissionType: 'TEXT',
    });
  });
});

describe('제출 방식 표기', () => {
  it('교직원 화면은 raw enum 대신 한국어 이름을 쓴다', () => {
    expect(submissionTypeLabel('FILE')).toBe('파일');
    expect(submissionTypeLabel('TEXT')).toBe('글로 작성');
    expect(submissionTypeLabel('REPOSITORY_RELEASE')).toBe('GitHub 릴리스');
  });

  it('선택지는 계약값 3개를 모두 담고 라벨에 enum을 남기지 않는다', () => {
    expect(SUBMISSION_TYPE_CHOICES.map((choice) => choice.value)).toEqual([
      'FILE',
      'TEXT',
      'REPOSITORY_RELEASE',
    ]);
    for (const choice of SUBMISSION_TYPE_CHOICES) {
      expect(choice.label).not.toContain('_');
      expect(choice.label).not.toBe(choice.value);
    }
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

  it('모르는 제출 방식 문자열은 기본값으로 떨어진다', () => {
    const next = updateMilestoneDocumentEditor(open, 'submissionType', 'PDF');

    expect(next.mode === 'closed' ? null : next.form.submissionType).toBe(
      'FILE',
    );
  });

  it('닫힌 편집기는 그대로 둔다', () => {
    const closed: MilestoneDocumentEditor = { mode: 'closed' };

    expect(updateMilestoneDocumentEditor(closed, 'name', '계획서')).toBe(
      closed,
    );
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
