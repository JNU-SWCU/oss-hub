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
  reorderMilestoneDocumentsMock,
  updateMilestoneDocumentMock,
  uploadMilestoneDocumentTemplateMock,
} = vi.hoisted(() => ({
  createMilestoneDocumentMock: vi.fn(),
  deleteMilestoneDocumentMock: vi.fn(),
  listMilestoneDocumentsMock: vi.fn(),
  reorderMilestoneDocumentsMock: vi.fn(),
  updateMilestoneDocumentMock: vi.fn(),
  uploadMilestoneDocumentTemplateMock: vi.fn(),
}));

vi.mock('./milestone-document-api', () => ({
  createMilestoneDocument: createMilestoneDocumentMock,
  deleteMilestoneDocument: deleteMilestoneDocumentMock,
  listMilestoneDocuments: listMilestoneDocumentsMock,
  reorderMilestoneDocuments: reorderMilestoneDocumentsMock,
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

/**
 * 제출 방식 `<select>`의 **여는 태그만** 잘라 낸다.
 *
 * ⚠ `html.includes('disabled')`로 보면 안 된다 — 이 select의 Tailwind 클래스 목록에
 * `disabled:cursor-not-allowed` 같은 이름이 들어 있어, 잠금을 통째로 지워도 그 단언은
 * 그대로 통과한다. 실제로 렌더된 boolean 속성(`disabled=""`)을 태그 안에서 찾는다.
 */
function submissionTypeSelectTag(html: string): string {
  // `Select` 래퍼가 data-slot·class를 먼저 붙이므로 id가 태그 첫 속성이 아니다.
  const idAt = html.indexOf(
    'id="milestone-milestone-1-document-submission-type"',
  );
  if (idAt < 0) throw new Error('제출 방식 select를 찾지 못했습니다.');
  const start = html.lastIndexOf('<select', idAt);
  return html.slice(start, html.indexOf('>', idAt) + 1);
}

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
        submissionTypeLocked: false,
      },
    });

    expect(html).toContain('서류 추가');
    expect(html).toContain('서류명 *');
    expect(html).toContain('필수 제출');
    expect(html).toContain('제출 방식');
    expect(html).toContain('for="milestone-milestone-1-document-name"');
    expect(html).toContain('서류명을 입력해 주세요.');
    // 제출이 없는 항목은 선택이 열려 있어야 한다 — 잠금이 기본이 되면 아무도 못 고친다.
    expect(html).not.toContain('제출 방식은 바꿀 수 없습니다');
    expect(submissionTypeSelectTag(html)).not.toContain('disabled=""');
  });

  // 백엔드가 409(MSD_016)로 막는 조건을 화면이 미리 알린다. 눌러 본 뒤 실패로 알게
  // 하면 「왜 안 되는지」가 남지 않는다.
  it('제출이 있는 항목의 수정 폼은 제출 방식 선택을 잠그고 이유를 적는다', () => {
    const html = renderBody({
      editor: {
        mode: 'edit',
        form: toMilestoneDocumentForm(planner),
        errors: {},
        submissionTypeLocked: true,
      },
    });

    expect(html).toContain(
      '이미 제출된 서류가 있어 제출 방식은 바꿀 수 없습니다',
    );
    expect(submissionTypeSelectTag(html)).toContain('disabled=""');
    // 이름·필수 여부는 제출이 있어도 고칠 수 있다(백엔드가 그 요청은 통과시킨다).
    expect(html).toContain('서류명 *');
    expect(html).toContain('필수 제출');
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

  /**
   * 계약 변경(2026-08). 예전에는 맞바꾼 두 항목을 각각 PATCH했는데, 한쪽만 성공하면
   * sortOrder가 같아져 그 뒤로 「위로」가 영영 먹지 않는 덫이 됐다. 이제 전체 순서를
   * 한 번에 보낸다 — 항목별 PATCH가 한 건이라도 나가면 그 회귀다.
   */
  it('「아래로」는 전체 순서를 한 번의 요청으로 보낸다 — 항목별 PATCH를 쓰지 않는다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue([planner, budget, pledge]);
    reorderMilestoneDocumentsMock.mockResolvedValue([
      { ...budget, sortOrder: 1 },
      { ...planner, sortOrder: 2 },
      { ...pledge, sortOrder: 3 },
    ]);

    await render(true);
    await click('계획서 아래로');

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
    listMilestoneDocumentsMock.mockResolvedValue([planner, budget]);
    reorderMilestoneDocumentsMock.mockResolvedValue([
      { ...budget, name: '예산서(서버 확정)', sortOrder: 1 },
      { ...planner, name: '계획서(서버 확정)', sortOrder: 2 },
    ]);

    await render(true);
    await click('계획서 아래로');

    expect(rowNames()).toEqual(['예산서(서버 확정)', '계획서(서버 확정)']);
  });

  /**
   * 옛 구현은 두 항목의 sortOrder가 같으면 아무것도 하지 않았다. 그 상태가 바로
   * 「한쪽 PATCH만 성공」이 남긴 자리라, 한 번 어긋나면 되돌릴 길이 없었다.
   */
  it('sortOrder가 겹쳐 굳은 목록도 순서를 바꿀 수 있다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue([
      documentFixture('a', 7, { name: '계획서' }),
      documentFixture('b', 7, { name: '예산서' }),
    ]);
    reorderMilestoneDocumentsMock.mockResolvedValue([
      documentFixture('b', 1, { name: '예산서' }),
      documentFixture('a', 2, { name: '계획서' }),
    ]);

    await render(true);
    await click('계획서 아래로');

    expect(reorderMilestoneDocumentsMock).toHaveBeenCalledWith('milestone-1', [
      'b',
      'a',
    ]);
    expect(rowNames()).toEqual(['예산서', '계획서']);
  });

  it('제출이 있는 항목을 수정하면 제출 방식 선택이 잠긴 채로 열린다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue([
      documentFixture('a', 1, {
        name: '계획서',
        teamSubmissionCount: { submitted: 3, total: 8 },
      }),
    ]);

    await render(true);
    await click('수정');

    const select = container.querySelector(
      '#milestone-milestone-1-document-submission-type',
    );
    expect(select).toBeInstanceOf(HTMLSelectElement);
    expect((select as HTMLSelectElement).disabled).toBe(true);
    expect(container.textContent).toContain(
      '이미 제출된 서류가 있어 제출 방식은 바꿀 수 없습니다',
    );
  });

  it('아직 아무도 안 낸 항목은 제출 방식을 바꿀 수 있다', async () => {
    listMilestoneDocumentsMock.mockResolvedValue([
      documentFixture('a', 1, {
        name: '계획서',
        teamSubmissionCount: { submitted: 0, total: 8 },
      }),
    ]);

    await render(true);
    await click('수정');

    const select = container.querySelector(
      '#milestone-milestone-1-document-submission-type',
    );
    expect((select as HTMLSelectElement).disabled).toBe(false);
    expect(container.textContent).not.toContain('제출 방식은 바꿀 수 없습니다');
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
