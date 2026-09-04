// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { milestoneDocumentUploadPolicy } from '../../../test-support/milestone-document-upload-policy';
import type {
  MilestoneDocument,
  MilestoneDocumentList,
} from './milestone-document-api';
import {
  MilestoneDocumentEditorBody,
  MilestoneDocumentEditorSection,
} from './milestone-document-editor';
import { toMilestoneDocumentForm } from './milestone-document-editor-flow';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const {
  createMilestoneDocumentMock,
  deleteMilestoneDocumentMock,
  listMilestoneDocumentsMock,
  reorderMilestoneDocumentsMock,
  updateMilestoneDocumentMock,
  uploadMilestoneDocumentTemplateMock,
  milestoneDocumentTemplateHrefMock,
} = vi.hoisted(() => ({
  createMilestoneDocumentMock: vi.fn(),
  deleteMilestoneDocumentMock: vi.fn(),
  listMilestoneDocumentsMock: vi.fn(),
  reorderMilestoneDocumentsMock: vi.fn(),
  updateMilestoneDocumentMock: vi.fn(),
  uploadMilestoneDocumentTemplateMock: vi.fn(),
  milestoneDocumentTemplateHrefMock: (
    milestoneId: string,
    documentId: string,
  ) => `milestones/${milestoneId}/documents/${documentId}/template`,
}));

vi.mock('./milestone-document-api', () => ({
  createMilestoneDocument: createMilestoneDocumentMock,
  deleteMilestoneDocument: deleteMilestoneDocumentMock,
  listMilestoneDocuments: listMilestoneDocumentsMock,
  reorderMilestoneDocuments: reorderMilestoneDocumentsMock,
  updateMilestoneDocument: updateMilestoneDocumentMock,
  uploadMilestoneDocumentTemplate: uploadMilestoneDocumentTemplateMock,
  milestoneDocumentTemplateHref: milestoneDocumentTemplateHrefMock,
}));

/** 목록 응답 봉투 — 화면은 이 안의 `fileUpload`로 파일 입력을 그린다(#1107). */
function documentList(
  documents: readonly MilestoneDocument[],
): MilestoneDocumentList {
  return { documents, fileUpload: milestoneDocumentUploadPolicy() };
}

function documentFixture(
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
    hasTemplateFile: false,
    templateFileName: null,

    ...overrides,
  };
}

const planner = documentFixture('a', 1, {
  name: '계획서',
  hasTemplateFile: true,
  templateFileName: '운영 결과보고서 최종본 2026.docx',
});
const budget = documentFixture('b', 2, {
  name: '예산서',
  required: false,
});
const pledge = documentFixture('c', 3, {
  name: '서약서',
  hasTemplateFile: true,
  templateFileName: null,
});

const noOp = () => undefined;

/** 응답 도착 순서를 손으로 정하려고 promise를 밖에서 붙잡는다. */
function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderBody(
  overrides: Partial<Parameters<typeof MilestoneDocumentEditorBody>[0]> = {},
): string {
  return renderToStaticMarkup(
    <MilestoneDocumentEditorBody
      milestoneId="milestone-1"
      expanded
      state={{
        kind: 'ready',
        documents: [planner, budget, pledge],
        fileUpload: milestoneDocumentUploadPolicy(),
      }}
      editor={{ mode: 'closed' }}
      deleteTargetId={null}
      isBusy={false}
      rowError={null}
      onToggle={noOp}
      onRetry={noOp}
      onAdd={noOp}
      onEdit={noOp}
      onCancelEditor={noOp}
      onFieldChange={noOp}
      onSaveEditor={vi.fn()}
      onRequestDelete={noOp}
      onCancelDelete={noOp}
      onConfirmDelete={noOp}
      onReorder={async () => true}
      onTemplateFile={noOp}
      {...overrides}
    />,
  );
}

describe('제출 항목 섹션의 렌더 계약', () => {
  it('제목·개수·항목 추가 버튼과 각 행의 조작을 그린다', () => {
    const html = renderBody();

    expect(html).toContain('제출 항목');
    expect(html).toContain('3개');
    expect(html).toContain('제출 항목 추가');
    expect(html).toContain('계획서');
    expect(html).toContain('양식 올리기');
    expect(html).toContain('양식 교체');
    expect(html).toContain('수정');
    expect(html).toContain('삭제');
    expect(html).toContain('손잡이를 끌어');
    expect(html).toContain('키보드는 손잡이에서 Enter');
  });

  it('양식 파일명과 인증된 다운로드 링크를 함께 보여 준다', () => {
    const html = renderBody();

    expect(html).toContain('운영 결과보고서 최종본 2026.docx');
    expect(html).toContain('milestones/milestone-1/documents/a/template');
    expect(html).toContain('title="운영 결과보고서 최종본 2026.docx"');
  });

  it('순서 바꾸기는 마우스·터치·키보드용 손잡이 하나로 제공한다', () => {
    const html = renderBody();

    expect(html).toContain('aria-label="계획서 순서 이동"');
    expect(html).toContain(
      'aria-describedby="milestone-milestone-1-document-reorder-instructions"',
    );
    expect(html).toContain('data-sortable-document-id="a"');
    expect(html).not.toContain('계획서 위로');
    expect(html).not.toContain('계획서 아래로');
  });

  it('항목 목록에 FILE/TEXT 제출 방식을 따로 표시하지 않는다', () => {
    const html = renderBody();

    expect(html).not.toContain('글로 작성');
    for (const rawEnum of ['>FILE<', '>TEXT<']) {
      expect(html).not.toContain(rawEnum);
    }
  });

  it('필수 항목에만 * 가 붙는다', () => {
    const html = renderBody({
      state: {
        kind: 'ready',
        documents: [planner],
        fileUpload: milestoneDocumentUploadPolicy(),
      },
    });
    const optionalHtml = renderBody({
      state: {
        kind: 'ready',
        documents: [budget],
        fileUpload: milestoneDocumentUploadPolicy(),
      },
    });

    expect(html).toContain('aria-label="필수"');
    expect(optionalHtml).not.toContain('aria-label="필수"');
  });

  it('항목이 0개면 안내와 추가 버튼만 남는다', () => {
    const html = renderBody({
      state: {
        kind: 'ready',
        documents: [],
        fileUpload: milestoneDocumentUploadPolicy(),
      },
    });

    expect(html).toContain('아직 제출 항목이 없습니다.');
    expect(html).toContain('학생이 제출할 수 있도록');
    expect(html).toContain('위의 ‘제출 항목 추가’');
    expect(html).toContain('제출 항목 추가');
    expect(html).toContain('0개');
  });

  it('불러오기 실패는 문구와 다시 시도 버튼을 준다', () => {
    const html = renderBody({ state: { kind: 'failed' } });

    expect(html).toContain('제출 항목을 불러오지 못했습니다.');
    expect(html).toContain('다시 시도');
    expect(html).not.toContain('제출 항목 추가');
  });

  it('접혀 있으면 목록을 그리지 않는다', () => {
    const html = renderBody({ expanded: false });

    expect(html).toContain('제출 항목');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('계획서');
  });

  it('삭제는 확인 단계를 거친다 — window.confirm이 아니라 화면 안의 행이다', () => {
    const html = renderBody({ deleteTargetId: 'a' });

    expect(html).toContain('되돌릴 수 없습니다');
    expect(html).toContain('삭제 확정');
    expect(html).toContain('취소');
  });

  it('행 오류는 해당 행 아래에 서버 문구를 보여 준다', () => {
    const html = renderBody({
      rowError: { documentId: 'a', message: '순서를 바꾸지 못했습니다.' },
    });

    expect(html).toContain('순서를 바꾸지 못했습니다.');
  });

  it('추가 폼은 제출 항목명·필수 여부를 묻고 글·파일 모두를 허용한다', () => {
    const html = renderBody({
      editor: {
        mode: 'create',
        form: toMilestoneDocumentForm(planner),
        errors: { name: '서류명을 입력해 주세요.' },
      },
    });

    expect(html).toContain('제출 항목 추가');
    expect(html).toContain('제출 항목 이름 *');
    expect(html).toContain('필수 제출로 지정합니다');
    expect(html).toContain('내용만, 파일만, 또는');
    expect(html).toContain('둘 다');
    expect(html).toContain('for="milestone-milestone-1-document-name"');
    expect(html).toContain('서류명을 입력해 주세요.');
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain('>FILE<');
    expect(html).not.toContain('>TEXT<');
  });

  it('기존 글 항목도 따로 구분하지 않고 같은 통합 안내를 보여 준다', () => {
    const html = renderBody({
      editor: {
        mode: 'edit',
        form: toMilestoneDocumentForm(budget),
        errors: {},
      },
    });

    expect(html).toContain('내용만, 파일만, 또는');
    expect(html).toContain('둘 다');
    expect(html).not.toContain('기존 글 제출 항목');
    expect(html).not.toContain('type="radio"');
    expect(html).toContain('제출 항목 이름 *');
    expect(html).toContain('필수 제출로 지정합니다');
  });
});

describe('제출 항목 섹션의 동작', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = window.document.createElement('div');
    window.document.body.append(container);
    root = createRoot(container);
    createMilestoneDocumentMock.mockReset();
    deleteMilestoneDocumentMock.mockReset();
    listMilestoneDocumentsMock.mockReset();
    reorderMilestoneDocumentsMock.mockReset();
    updateMilestoneDocumentMock.mockReset();
    uploadMilestoneDocumentTemplateMock.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function button(name: string): HTMLButtonElement {
    const found = Array.from(container.querySelectorAll('button')).find(
      (candidate) =>
        candidate.textContent?.trim() === name ||
        candidate.getAttribute('aria-label') === name,
    );
    if (!(found instanceof HTMLButtonElement)) {
      throw new TypeError(`Button not found: ${name}`);
    }
    return found;
  }

  function rowNames(): readonly string[] {
    return Array.from(
      container.querySelectorAll(
        '[data-testid="milestone-document-editor-row"]',
      ),
    ).map(
      (row) => row.querySelector('span')?.textContent?.replace('*', '') ?? '',
    );
  }

  async function render(defaultExpanded: boolean) {
    await act(async () => {
      root.render(
        <MilestoneDocumentEditorSection
          milestoneId="milestone-1"
          defaultExpanded={defaultExpanded}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  /** React가 듣는 것은 네이티브 input 이벤트라 setter를 직접 호출해 값을 넣는다. */
  async function type(selector: string, value: string) {
    const input = container.querySelector(selector);
    if (!(input instanceof HTMLInputElement)) {
      throw new TypeError(`입력란을 찾지 못했습니다: ${selector}`);
    }
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function click(name: string) {
    await act(async () => {
      button(name).click();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  async function press(buttonName: string, key: string) {
    await act(async () => {
      const target = button(buttonName);
      target.focus();
      target.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key }),
      );
    });
    await settle();
  }

  async function reorderByKeyboard(
    buttonName: string,
    direction: 'ArrowUp' | 'ArrowDown',
    distance = 1,
  ) {
    await press(buttonName, 'Enter');
    for (let step = 0; step < distance; step += 1) {
      await press(buttonName, direction);
    }
    await press(buttonName, 'Enter');
  }

  /**
   * 「제출 항목」 토글 — 펼쳐서 목록을 가진 동안에는 이름에 개수가 붙어(「제출 항목 2개」)
   * 이름으로는 못 찾는다. 이 화면에서 `aria-expanded`를 가진 버튼은 이것 하나다.
   */
  async function toggleDocuments() {
    const toggle = container.querySelector('button[aria-expanded]');
    if (!(toggle instanceof HTMLButtonElement)) {
      throw new TypeError('「제출 항목」 토글을 찾지 못했습니다.');
    }
    await act(async () => {
      toggle.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  /** 접었다 다시 펴 두 번째 조회를 띄운다 — 앞의 요청은 아직 답하지 않은 채다. */
  async function collapseAndExpand() {
    await toggleDocuments();
    await toggleDocuments();
  }

  async function settle() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  /** 행마다 같은 이름의 「수정」이 있어 순서로 고른다. */
  async function clickEditAt(index: number) {
    const found = Array.from(container.querySelectorAll('button')).filter(
      (candidate) => candidate.textContent?.trim() === '수정',
    )[index];
    if (!(found instanceof HTMLButtonElement)) {
      throw new TypeError(`${index}번째 「수정」 버튼이 없습니다.`);
    }
    await act(async () => {
      found.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('접힌 카드는 목록을 불러오지 않고, 펼칠 때 한 번 불러온다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue(documentList([planner]));

    await render(false);
    expect(listMilestoneDocumentsMock).not.toHaveBeenCalled();

    await click('제출 항목');
    expect(listMilestoneDocumentsMock).toHaveBeenCalledTimes(1);
    expect(listMilestoneDocumentsMock).toHaveBeenCalledWith('milestone-1');
  });

  it('저장 직후 펼쳐 달라고 하면 처음부터 펼쳐진 채로 뜬다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue(documentList([]));

    await render(true);

    expect(listMilestoneDocumentsMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('아직 제출 항목이 없습니다.');
  });

  it('목록은 응답 순서가 뒤섞여 있어도 sortOrder 오름차순으로 그린다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue(
      documentList([pledge, planner, budget]),
    );

    await render(true);

    expect(rowNames()).toEqual(['계획서', '예산서', '서약서']);
  });

  /**
   * 계약 변경(2026-08). 예전에는 맞바꾼 두 항목을 각각 PATCH했는데, 한쪽만 성공하면
   * sortOrder가 같아져 그 뒤로 「위로」가 영영 먹지 않는 덫이 됐다. 이제 전체 순서를
   * 한 번에 보낸다 — 항목별 PATCH가 한 건이라도 나가면 그 회귀다.
   */
  it('드롭은 전체 순서를 한 번의 요청으로 보낸다 — 항목별 PATCH를 쓰지 않는다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue(
      documentList([planner, budget, pledge]),
    );
    reorderMilestoneDocumentsMock.mockResolvedValue([
      { ...budget, sortOrder: 1 },
      { ...planner, sortOrder: 2 },
      { ...pledge, sortOrder: 3 },
    ]);

    await render(true);
    await reorderByKeyboard('계획서 순서 이동', 'ArrowDown');

    expect(reorderMilestoneDocumentsMock).toHaveBeenCalledTimes(1);
    expect(reorderMilestoneDocumentsMock).toHaveBeenCalledWith('milestone-1', [
      'b',
      'a',
      'c',
    ]);
    expect(updateMilestoneDocumentMock).not.toHaveBeenCalled();
    expect(rowNames()).toEqual(['예산서', '계획서', '서약서']);
  });

  /**
   * 서버가 sortOrder를 1부터 다시 매기므로 응답이 진실이다. 낙관적 갱신으로 되돌리면
   * 화면의 sortOrder가 서버와 조용히 어긋나고, 그 어긋남은 다음 이동에서야 드러난다.
   * 그래서 응답에만 있는 값(이름 변경)을 넣어 화면이 무엇을 그렸는지로 판정한다.
   */
  it('순서 바꾼 뒤 목록은 서버 응답 그대로다 — 낙관적 갱신이 아니다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue(
      documentList([planner, budget]),
    );
    reorderMilestoneDocumentsMock.mockResolvedValue([
      { ...budget, name: '예산서(서버 확정)', sortOrder: 1 },
      { ...planner, name: '계획서(서버 확정)', sortOrder: 2 },
    ]);

    await render(true);
    await reorderByKeyboard('계획서 순서 이동', 'ArrowDown');

    expect(rowNames()).toEqual(['예산서(서버 확정)', '계획서(서버 확정)']);
  });

  /**
   * 옛 구현은 두 항목의 sortOrder가 같으면 아무것도 하지 않았다. 그 상태가 바로
   * 「한쪽 PATCH만 성공」이 남긴 자리라, 한 번 어긋나면 되돌릴 길이 없었다.
   */
  it('sortOrder가 겹쳐 굳은 목록도 순서를 바꿀 수 있다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue(
      documentList([
        documentFixture('a', 7, { name: '계획서' }),
        documentFixture('b', 7, { name: '예산서' }),
      ]),
    );
    reorderMilestoneDocumentsMock.mockResolvedValue([
      documentFixture('b', 1, { name: '예산서' }),
      documentFixture('a', 2, { name: '계획서' }),
    ]);

    await render(true);
    await reorderByKeyboard('계획서 순서 이동', 'ArrowDown');

    expect(reorderMilestoneDocumentsMock).toHaveBeenCalledWith('milestone-1', [
      'b',
      'a',
    ]);
    expect(rowNames()).toEqual(['예산서', '계획서']);
  });

  it('제출이 있는 항목을 수정해도 제출 방식 선택은 나타나지 않는다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue(
      documentList([
        documentFixture('a', 1, {
          name: '계획서',
          teamSubmissionCount: { submitted: 3, total: 8 },
        }),
      ]),
    );

    await render(true);
    await click('수정');

    expect(container.querySelector('input[type="radio"]')).toBeNull();
    expect(container.textContent).toContain('내용만, 파일만, 또는 둘 다');
  });

  it('아직 아무도 안 낸 항목도 제출 방식 선택은 나타나지 않는다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue(
      documentList([
        documentFixture('a', 1, {
          name: '계획서',
          teamSubmissionCount: { submitted: 0, total: 8 },
        }),
      ]),
    );

    await render(true);
    await click('수정');

    expect(container.querySelector('input[type="radio"]')).toBeNull();
    expect(container.textContent).toContain('내용만, 파일만, 또는 둘 다');
  });

  /**
   * 수정(PATCH) 응답에는 `teamSubmissionCount`가 없다 — 그 값은 목록 조회에서만 채워진다.
   * 응답을 그대로 갈아 끼우던 시절에는 이름만 바꿔도 제출 수가 사라져, 다시 연 수정
   * 폼에서 제출 방식이 열려 있었다. 교직원이 바꿔 저장해야 그제서야 409가 떴다.
   */
  it('이름만 바꿔 저장한 뒤 다시 열어도 방식 선택은 없다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue(
      documentList([
        documentFixture('a', 1, {
          name: '계획서',
          teamSubmissionCount: { submitted: 3, total: 8 },
        }),
      ]),
    );
    updateMilestoneDocumentMock.mockResolvedValue(
      documentFixture('a', 1, { name: '계획서(수정)' }),
    );

    await render(true);
    await click('수정');
    await type('#milestone-milestone-1-document-name', '계획서(수정)');
    await click('저장');

    expect(updateMilestoneDocumentMock).toHaveBeenCalledTimes(1);
    expect(rowNames()).toEqual(['계획서(수정)']);

    await click('수정');

    expect(container.querySelector('input[type="radio"]')).toBeNull();
    expect(container.textContent).toContain('내용만, 파일만, 또는 둘 다');
  });

  it('순서를 바꾼 뒤에도 제출 방식 선택은 없다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue(
      documentList([
        documentFixture('a', 1, {
          name: '계획서',
          teamSubmissionCount: { submitted: 3, total: 8 },
        }),
        documentFixture('b', 2, {
          name: '예산서',
          teamSubmissionCount: { submitted: 0, total: 8 },
        }),
      ]),
    );
    // 재정렬 응답도 제출 수를 싣지 않는다 — 그대로 덮으면 모든 행의 잠금이 풀린다.
    reorderMilestoneDocumentsMock.mockResolvedValue([
      documentFixture('b', 1, { name: '예산서' }),
      documentFixture('a', 2, { name: '계획서' }),
    ]);

    await render(true);
    await reorderByKeyboard('계획서 순서 이동', 'ArrowDown');
    expect(rowNames()).toEqual(['예산서', '계획서']);

    // 두 번째 행(계획서)의 「수정」 — 첫 행은 제출이 없어 잠기지 않는 항목이다.
    await clickEditAt(1);

    expect(container.querySelector('input[type="radio"]')).toBeNull();
  });

  it('손잡이는 모든 항목에서 같은 44px 조작 영역을 제공한다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue(
      documentList([planner, budget]),
    );

    await render(true);

    const plannerHandle = button('계획서 순서 이동');
    const budgetHandle = button('예산서 순서 이동');
    expect(plannerHandle.disabled).toBe(false);
    expect(budgetHandle.disabled).toBe(false);
    expect(plannerHandle.className).toContain('touch-none');
    expect(plannerHandle.getAttribute('aria-describedby')).toBe(
      'milestone-milestone-1-document-reorder-instructions',
    );
  });

  it('키보드로 집은 뒤 Escape를 누르면 순서를 바꾸지 않는다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue(
      documentList([planner, budget]),
    );

    await render(true);
    await press('계획서 순서 이동', ' ');
    await press('계획서 순서 이동', 'ArrowDown');
    await press('계획서 순서 이동', 'Escape');

    expect(reorderMilestoneDocumentsMock).not.toHaveBeenCalled();
    expect(rowNames()).toEqual(['계획서', '예산서']);
    expect(container.textContent).toContain('순서 이동을 취소했습니다.');
  });

  it('순서 바꾸기가 실패하면 그 행에 서버 문구를 보여 준다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue(
      documentList([planner, budget]),
    );
    reorderMilestoneDocumentsMock.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        detail: '이미 다른 사람이 순서를 바꿨습니다.',
        instance: '/milestones/milestone-1/documents/order',
        code: 'MSD_019',
      }),
    );

    await render(true);
    await reorderByKeyboard('계획서 순서 이동', 'ArrowDown');

    expect(container.textContent).toContain(
      '이미 다른 사람이 순서를 바꿨습니다.',
    );
    expect(rowNames()).toEqual(['계획서', '예산서']);
  });

  it('새 항목은 기존 최대 sortOrder + 1로 만든다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue(
      documentList([planner, budget]),
    );
    createMilestoneDocumentMock.mockResolvedValue(
      documentFixture('d', 3, { name: '서약서' }),
    );

    await render(true);
    await click('제출 항목 추가');

    await type('#milestone-milestone-1-document-name', '서약서');
    await click('저장');

    expect(createMilestoneDocumentMock).toHaveBeenCalledWith('milestone-1', {
      name: '서약서',
      required: true,
      sortOrder: 3,
    });
    expect(rowNames()).toEqual(['계획서', '예산서', '서약서']);
  });

  it('서류명이 비면 저장하지 않고 폼에 이유를 남긴다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue(documentList([]));

    await render(true);
    await click('제출 항목 추가');
    await click('저장');

    expect(createMilestoneDocumentMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('서류명을 입력해 주세요.');
  });

  it('삭제는 확인을 거친 뒤에만 요청한다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue(
      documentList([planner, budget]),
    );
    deleteMilestoneDocumentMock.mockResolvedValue(undefined);

    await render(true);
    await click('삭제');
    expect(deleteMilestoneDocumentMock).not.toHaveBeenCalled();

    await click('삭제 확정');
    expect(deleteMilestoneDocumentMock).toHaveBeenCalledWith(
      'milestone-1',
      'a',
    );
    expect(rowNames()).toEqual(['예산서']);
  });

  it('마지막 제출 항목은 삭제하지 못하며 다음 행동을 안내한다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue(documentList([planner]));

    await render(true);

    expect(button('삭제').disabled).toBe(true);
    expect(container.textContent).toContain(
      '바꾸려면 새 항목을 먼저 추가하세요.',
    );
    expect(deleteMilestoneDocumentMock).not.toHaveBeenCalled();
  });

  it('불러오기 실패는 다시 시도로 회복한다', async () => {
    listMilestoneDocumentsMock.mockRejectedValueOnce(new TypeError('network'));
    listMilestoneDocumentsMock.mockResolvedValueOnce(documentList([planner]));

    await render(true);
    expect(container.textContent).toContain('제출 항목을 불러오지 못했습니다.');

    await click('다시 시도');
    expect(rowNames()).toEqual(['계획서']);
  });

  /**
   * 겹친 조회. 첫 요청이 끝나기 전에 패널을 접었다 다시 펴면 목록 조회가 둘 겹치고,
   * 응답이 보낸 순서대로 돌아온다는 보장은 없다. 늦게 도착한 옛 응답을 그대로 받으면
   * 화면에는 이미 사라진 행이 남고, 그 목록으로 순서를 바꾸면 전체 집합이 서버와 달라
   * 400(MSD_019)으로 떨어진다.
   */
  describe('겹친 목록 조회', () => {
    it('늦게 온 옛 성공 응답이 최신 목록을 덮지 않는다', async () => {
      const stale = deferred<MilestoneDocumentList>();
      const fresh = deferred<MilestoneDocumentList>();
      listMilestoneDocumentsMock.mockReturnValueOnce(stale.promise);
      listMilestoneDocumentsMock.mockReturnValueOnce(fresh.promise);

      await render(true);
      await collapseAndExpand();
      expect(listMilestoneDocumentsMock).toHaveBeenCalledTimes(2);

      // 최신 요청이 먼저 답하고, 옛 요청이 그 뒤에 답한다.
      await act(async () => fresh.resolve(documentList([budget])));
      await settle();
      expect(rowNames()).toEqual(['예산서']);

      await act(async () => stale.resolve(documentList([planner, pledge])));
      await settle();

      expect(rowNames()).toEqual(['예산서']);
    });

    /**
     * 실패도 같은 규칙을 받는다. 옛 요청의 실패가 늦게 도착해 그대로 반영되면, 멀쩡히
     * 서 있는 목록이 「불러오지 못했습니다」로 덮이고 「다시 시도」밖에 남지 않는다.
     */
    it('늦게 온 옛 실패가 최신 성공을 오류 화면으로 덮지 않는다', async () => {
      const stale = deferred<MilestoneDocumentList>();
      const fresh = deferred<MilestoneDocumentList>();
      listMilestoneDocumentsMock.mockReturnValueOnce(stale.promise);
      listMilestoneDocumentsMock.mockReturnValueOnce(fresh.promise);

      await render(true);
      await collapseAndExpand();

      await act(async () => fresh.resolve(documentList([planner])));
      await settle();
      expect(rowNames()).toEqual(['계획서']);

      await act(async () => stale.reject(new TypeError('network')));
      await settle();

      expect(rowNames()).toEqual(['계획서']);
      expect(container.textContent).not.toContain(
        '제출 항목을 불러오지 못했습니다.',
      );
    });
  });

  /**
   * 변경과 겹친 조회. 조회끼리만 막으면 저장·삭제·순서 바꾸기가 **진행 중일 때** 나간
   * 조회가 변경 이전 목록을 읽고, 늦게 도착해 「최신 요청」의 자격으로 방금의 변경을
   * 덮는다 — 방금 만든 항목이 다시 불러오기 전까지 사라진다. 변경이 끝나는 자리에서도
   * 요청 번호를 올려, 그때 날아가 있던 조회를 전부 낡은 것으로 만든다.
   */
  describe('변경과 겹친 목록 조회', () => {
    it('저장이 끝난 뒤 도착한 옛 조회가 방금 만든 항목을 지우지 않는다', async () => {
      const created = deferred<MilestoneDocument>();
      const stale = deferred<MilestoneDocumentList>();
      listMilestoneDocumentsMock.mockResolvedValueOnce(documentList([planner]));
      listMilestoneDocumentsMock.mockReturnValueOnce(stale.promise);
      createMilestoneDocumentMock.mockReturnValueOnce(created.promise);

      await render(true);
      await click('제출 항목 추가');
      await type('#milestone-milestone-1-document-name', '서약서');
      await click('저장');
      // 저장이 도는 사이에 접었다 편다 — 이 조회는 새 항목이 없던 목록을 읽는다.
      await collapseAndExpand();
      expect(listMilestoneDocumentsMock).toHaveBeenCalledTimes(2);

      await act(async () =>
        created.resolve(documentFixture('d', 2, { name: '서약서' })),
      );
      await settle();
      expect(rowNames()).toEqual(['계획서', '서약서']);

      await act(async () => stale.resolve(documentList([planner])));
      await settle();

      expect(rowNames()).toEqual(['계획서', '서약서']);
    });

    it('순서를 바꾼 뒤 도착한 옛 조회가 옛 순서로 되돌리지 않는다', async () => {
      const reordered = deferred<readonly MilestoneDocument[]>();
      const stale = deferred<MilestoneDocumentList>();
      listMilestoneDocumentsMock.mockResolvedValueOnce(
        documentList([planner, budget]),
      );
      listMilestoneDocumentsMock.mockReturnValueOnce(stale.promise);
      reorderMilestoneDocumentsMock.mockReturnValueOnce(reordered.promise);

      await render(true);
      await reorderByKeyboard('계획서 순서 이동', 'ArrowDown');
      await collapseAndExpand();

      await act(async () =>
        reordered.resolve([
          { ...budget, sortOrder: 1 },
          { ...planner, sortOrder: 2 },
        ]),
      );
      await settle();
      expect(rowNames()).toEqual(['예산서', '계획서']);

      await act(async () => stale.resolve(documentList([planner, budget])));
      await settle();

      expect(rowNames()).toEqual(['예산서', '계획서']);
    });

    /**
     * 실패도 같은 규칙을 받는다 — 변경이 끝나기 전에 나간 조회는 성공·실패 어느 쪽으로
     * 끝났든 「변경을 반영한 답인지 알 수 없는」 목록이다. 실패 뒤에 화면이 서 있어야 할
     * 자리는 변경 이전 목록 + 그 행의 실패 문구이고, 무효로 만든 조회가 켜 둔
     * 「불러오는 중…」에 멈춰서도 안 된다.
     */
    it('삭제가 실패한 뒤 도착한 옛 조회도 목록을 덮지 않는다', async () => {
      const deletion = deferred<void>();
      const stale = deferred<MilestoneDocumentList>();
      listMilestoneDocumentsMock.mockResolvedValueOnce(
        documentList([planner, budget]),
      );
      listMilestoneDocumentsMock.mockReturnValueOnce(stale.promise);
      deleteMilestoneDocumentMock.mockReturnValueOnce(deletion.promise);

      await render(true);
      await click('삭제');
      await click('삭제 확정');
      await collapseAndExpand();

      await act(async () =>
        deletion.reject(
          new ApiError({
            type: 'about:blank',
            title: 'Conflict',
            status: 409,
            detail: '이미 제출된 서류가 있어 삭제할 수 없습니다.',
            instance: '/milestones/milestone-1/documents/a',
            code: 'MSD_016',
          }),
        ),
      );
      await settle();
      expect(rowNames()).toEqual(['계획서', '예산서']);
      expect(container.textContent).toContain(
        '이미 제출된 서류가 있어 삭제할 수 없습니다.',
      );

      await act(async () => stale.resolve(documentList([pledge])));
      await settle();

      expect(rowNames()).toEqual(['계획서', '예산서']);
      expect(container.textContent).not.toContain('서약서');
    });
  });
});

/*
 * #1107 — 마일스톤 편집의 「양식 올리기」도 accept도 사전 검사도 없었다. 학생 제출·교직원
 * 양식 올리기와 같은 기준을 따라야 한다.
 */
describe('마일스톤 편집 양식 올리기의 사전 검사', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = window.document.createElement('div');
    window.document.body.append(container);
    root = createRoot(container);
    uploadMilestoneDocumentTemplateMock.mockReset();
    listMilestoneDocumentsMock.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderRow(onTemplateFile = vi.fn()) {
    listMilestoneDocumentsMock.mockResolvedValue(documentList([planner]));
    await act(async () => {
      root.render(
        <MilestoneDocumentEditorBody
          milestoneId="milestone-1"
          expanded
          state={{
            kind: 'ready',
            documents: [planner],
            fileUpload: milestoneDocumentUploadPolicy(),
          }}
          editor={{ mode: 'closed' }}
          deleteTargetId={null}
          isBusy={false}
          rowError={null}
          onToggle={noOp}
          onRetry={noOp}
          onAdd={noOp}
          onEdit={noOp}
          onCancelEditor={noOp}
          onFieldChange={noOp}
          onSaveEditor={vi.fn()}
          onRequestDelete={noOp}
          onCancelDelete={noOp}
          onConfirmDelete={noOp}
          onReorder={async () => true}
          onTemplateFile={onTemplateFile}
        />,
      );
    });
    return onTemplateFile;
  }

  function fileInput(): HTMLInputElement {
    const element = container.querySelector('input[type="file"]');
    if (!(element instanceof HTMLInputElement))
      throw new TypeError('Missing file input.');
    return element;
  }

  async function select(name: string, size: number) {
    const input = fileInput();
    const candidate = new File(['synthetic'], name);
    Object.defineProperty(candidate, 'size', {
      configurable: true,
      value: size,
    });
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [candidate],
    });
    await act(async () =>
      input.dispatchEvent(new Event('change', { bubbles: true })),
    );
  }

  it('고르기 전에 다른 두 화면과 같은 안내를 보여 주고 형식을 제한한다', async () => {
    await renderRow();

    expect(container.textContent).toContain(
      'PDF, HWP, JPG, PNG, ZIP · 최대 5 MB',
    );
    expect(fileInput().getAttribute('accept')).toBe(
      '.pdf,.hwp,.jpg,.jpeg,.png,.zip',
    );
  });

  it('상한을 넘은 파일은 업로드를 시작하지도 않는다', async () => {
    const onTemplateFile = await renderRow();

    await select('양식.pdf', 5 * 1024 * 1024 + 1);

    expect(onTemplateFile).not.toHaveBeenCalled();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('파일은 5 MB 이하여야 합니다.');
    expect(alert?.textContent).not.toContain('ProblemDetail');
  });

  it('허용 형식 밖의 파일도 업로드 전에 걸러진다', async () => {
    const onTemplateFile = await renderRow();

    await select('설치.exe', 10);

    expect(onTemplateFile).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'PDF, HWP, JPG, PNG, ZIP 파일만 선택할 수 있습니다.',
    );
  });

  it('제대로 된 파일은 그대로 올린다', async () => {
    const onTemplateFile = await renderRow();

    await select('양식.pdf', 1024);

    expect(onTemplateFile).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
