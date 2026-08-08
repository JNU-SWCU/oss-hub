// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import type { MilestoneDocument } from './milestone-document-api';
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
  updateMilestoneDocumentMock,
  uploadMilestoneDocumentTemplateMock,
} = vi.hoisted(() => ({
  createMilestoneDocumentMock: vi.fn(),
  deleteMilestoneDocumentMock: vi.fn(),
  listMilestoneDocumentsMock: vi.fn(),
  updateMilestoneDocumentMock: vi.fn(),
  uploadMilestoneDocumentTemplateMock: vi.fn(),
}));

vi.mock('./milestone-document-api', () => ({
  createMilestoneDocument: createMilestoneDocumentMock,
  deleteMilestoneDocument: deleteMilestoneDocumentMock,
  listMilestoneDocuments: listMilestoneDocumentsMock,
  updateMilestoneDocument: updateMilestoneDocumentMock,
  uploadMilestoneDocumentTemplate: uploadMilestoneDocumentTemplateMock,
}));

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
    submissionType: 'FILE',
    hasTemplateFile: false,
    ...overrides,
  };
}

const planner = documentFixture('a', 1, { name: '계획서' });
const budget = documentFixture('b', 2, {
  name: '예산서',
  submissionType: 'TEXT',
  required: false,
});
const pledge = documentFixture('c', 3, {
  name: '서약서',
  submissionType: 'REPOSITORY_RELEASE',
  hasTemplateFile: true,
});

const noOp = () => undefined;

function renderBody(
  overrides: Partial<Parameters<typeof MilestoneDocumentEditorBody>[0]> = {},
): string {
  return renderToStaticMarkup(
    <MilestoneDocumentEditorBody
      milestoneId="milestone-1"
      expanded
      state={{ kind: 'ready', documents: [planner, budget, pledge] }}
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
      onMove={noOp}
      onTemplateFile={noOp}
      {...overrides}
    />,
  );
}

describe('받을 서류 섹션의 렌더 계약', () => {
  it('제목·개수·항목 추가 버튼과 각 행의 조작을 그린다', () => {
    const html = renderBody();

    expect(html).toContain('받을 서류');
    expect(html).toContain('3개');
    expect(html).toContain('항목 추가');
    expect(html).toContain('계획서');
    expect(html).toContain('양식 올리기');
    expect(html).toContain('양식 교체');
    expect(html).toContain('수정');
    expect(html).toContain('삭제');
    expect(html).toContain('위로');
    expect(html).toContain('아래로');
  });

  // 드래그 손잡이는 키보드·화면 읽기 도구로 쓸 수 없어 버튼 두 개로 대체했다.
  it('순서 바꾸기는 드래그가 아니라 이름표가 붙은 버튼이다', () => {
    const html = renderBody();

    expect(html).toContain('aria-label="계획서 위로"');
    expect(html).toContain('aria-label="계획서 아래로"');
    expect(html).not.toContain('draggable');
  });

  it('제출 방식은 raw enum 대신 한국어로 보인다', () => {
    const html = renderBody();

    expect(html).toContain('파일');
    expect(html).toContain('글로 작성');
    expect(html).toContain('GitHub 릴리스');
    for (const rawEnum of ['>FILE<', '>TEXT<', '>REPOSITORY_RELEASE<']) {
      expect(html).not.toContain(rawEnum);
    }
  });

  it('필수 항목에만 * 가 붙는다', () => {
    const html = renderBody({
      state: { kind: 'ready', documents: [planner] },
    });
    const optionalHtml = renderBody({
      state: { kind: 'ready', documents: [budget] },
    });

    expect(html).toContain('aria-label="필수"');
    expect(optionalHtml).not.toContain('aria-label="필수"');
  });

  it('항목이 0개면 안내와 추가 버튼만 남는다', () => {
    const html = renderBody({ state: { kind: 'ready', documents: [] } });

    expect(html).toContain('아직 등록한 서류가 없습니다.');
    expect(html).toContain('항목 추가');
    expect(html).toContain('0개');
  });

  it('불러오기 실패는 문구와 다시 시도 버튼을 준다', () => {
    const html = renderBody({ state: { kind: 'failed' } });

    expect(html).toContain('제출 서류를 불러오지 못했습니다.');
    expect(html).toContain('다시 시도');
    expect(html).not.toContain('항목 추가');
  });

  it('접혀 있으면 목록을 그리지 않는다', () => {
    const html = renderBody({ expanded: false });

    expect(html).toContain('받을 서류');
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

  it('추가 폼은 서류명·필수 여부·제출 방식을 이름표와 함께 묻는다', () => {
    const html = renderBody({
      editor: {
        mode: 'create',
        form: toMilestoneDocumentForm(planner),
        errors: { name: '서류명을 입력해 주세요.' },
      },
    });

    expect(html).toContain('서류 추가');
    expect(html).toContain('서류명 *');
    expect(html).toContain('필수 제출');
    expect(html).toContain('제출 방식');
    expect(html).toContain('for="milestone-milestone-1-document-name"');
    expect(html).toContain('서류명을 입력해 주세요.');
  });
});

describe('받을 서류 섹션의 동작', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = window.document.createElement('div');
    window.document.body.append(container);
    root = createRoot(container);
    createMilestoneDocumentMock.mockReset();
    deleteMilestoneDocumentMock.mockReset();
    listMilestoneDocumentsMock.mockReset();
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

  it('접힌 카드는 목록을 불러오지 않고, 펼칠 때 한 번 불러온다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue([planner]);

    await render(false);
    expect(listMilestoneDocumentsMock).not.toHaveBeenCalled();

    await click('받을 서류');
    expect(listMilestoneDocumentsMock).toHaveBeenCalledTimes(1);
    expect(listMilestoneDocumentsMock).toHaveBeenCalledWith('milestone-1');
  });

  it('저장 직후 펼쳐 달라고 하면 처음부터 펼쳐진 채로 뜬다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue([]);

    await render(true);

    expect(listMilestoneDocumentsMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('아직 등록한 서류가 없습니다.');
  });

  it('목록은 응답 순서가 뒤섞여 있어도 sortOrder 오름차순으로 그린다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue([pledge, planner, budget]);

    await render(true);

    expect(rowNames()).toEqual(['계획서', '예산서', '서약서']);
  });

  it('「아래로」는 맞바꾼 두 항목을 모두 PATCH하고 순서를 바꾼다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue([planner, budget, pledge]);
    updateMilestoneDocumentMock.mockImplementation(
      (_milestoneId: string, documentId: string, input: unknown) => ({
        ...documentFixture(documentId, 0),
        ...(input as object),
        id: documentId,
      }),
    );

    await render(true);
    await click('계획서 아래로');

    expect(updateMilestoneDocumentMock).toHaveBeenCalledTimes(2);
    expect(
      updateMilestoneDocumentMock.mock.calls.map((call) => call[1]),
    ).toEqual(['a', 'b']);
    expect(
      updateMilestoneDocumentMock.mock.calls.map(
        (call) => (call[2] as { sortOrder: number }).sortOrder,
      ),
    ).toEqual([2, 1]);
    expect(rowNames()).toEqual(['예산서', '계획서', '서약서']);
  });

  it('첫 항목의 「위로」와 마지막 항목의 「아래로」는 잠겨 있다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue([planner, budget]);

    await render(true);

    expect(button('계획서 위로').disabled).toBe(true);
    expect(button('예산서 아래로').disabled).toBe(true);
    expect(button('계획서 아래로').disabled).toBe(false);
  });

  it('순서 바꾸기가 실패하면 그 행에 서버 문구를 보여 준다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue([planner, budget]);
    updateMilestoneDocumentMock.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: '이미 다른 사람이 순서를 바꿨습니다.',
        instance: '/milestones/milestone-1/documents/a',
        code: 'MSD_020',
      }),
    );

    await render(true);
    await click('계획서 아래로');

    expect(container.textContent).toContain(
      '이미 다른 사람이 순서를 바꿨습니다.',
    );
  });

  it('새 항목은 기존 최대 sortOrder + 1로 만든다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue([planner, budget]);
    createMilestoneDocumentMock.mockResolvedValue(
      documentFixture('d', 3, { name: '서약서' }),
    );

    await render(true);
    await click('항목 추가');

    await type('#milestone-milestone-1-document-name', '서약서');
    await click('저장');

    expect(createMilestoneDocumentMock).toHaveBeenCalledWith('milestone-1', {
      name: '서약서',
      required: true,
      sortOrder: 3,
      submissionType: 'FILE',
    });
    expect(rowNames()).toEqual(['계획서', '예산서', '서약서']);
  });

  it('서류명이 비면 저장하지 않고 폼에 이유를 남긴다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue([]);

    await render(true);
    await click('항목 추가');
    await click('저장');

    expect(createMilestoneDocumentMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('서류명을 입력해 주세요.');
  });

  it('삭제는 확인을 거친 뒤에만 요청한다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue([planner, budget]);
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

  it('불러오기 실패는 다시 시도로 회복한다', async () => {
    listMilestoneDocumentsMock.mockRejectedValueOnce(new TypeError('network'));
    listMilestoneDocumentsMock.mockResolvedValueOnce([planner]);

    await render(true);
    expect(container.textContent).toContain('제출 서류를 불러오지 못했습니다.');

    await click('다시 시도');
    expect(rowNames()).toEqual(['계획서']);
  });
});
