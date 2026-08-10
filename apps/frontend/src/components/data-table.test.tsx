// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataTable, type DataTableColumn } from './data-table';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

interface Applicant {
  id: string;
  name: string;
  status: string;
}

const columns: DataTableColumn<Applicant>[] = [
  { id: 'name', header: '이름', cell: (row) => row.name },
  { id: 'status', header: '상태', cell: (row) => row.status },
];

const rows: Applicant[] = [{ id: '1', name: '홍길동', status: '대기' }];

describe('DataTable', () => {
  it('renders injected columns and rows', () => {
    const html = renderToStaticMarkup(
      <DataTable columns={columns} data={rows} rowKey={(row) => row.id} />,
    );

    expect(html).toContain('이름');
    expect(html).toContain('홍길동');
    expect(html).toContain('대기');
  });

  it('renders the empty state slot when data is empty', () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={columns}
        data={[]}
        rowKey={(row) => row.id}
        emptyState="신청자가 없습니다."
      />,
    );

    expect(html).toContain('신청자가 없습니다.');
  });

  it('renders the loading slot when isLoading is true', () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(row) => row.id}
        isLoading
        loadingSlot="불러오는 중입니다."
      />,
    );

    expect(html).toContain('불러오는 중입니다.');
    expect(html).not.toContain('홍길동');
  });

  it('applies layout classes without turning rows into controls', () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(row) => row.id}
        className="[&_tbody_tr]:relative"
      />,
    );

    expect(html).toMatch(
      /<div[^>]*data-slot="data-table"[^>]*class="[^"]*min-w-0[^"]*\[&amp;_tbody_tr\]:relative[^"]*"/,
    );
    expect(html).not.toMatch(/<tr[^>]*class="[^"]*relative[^"]*"/);
    // 행·칸은 컨트롤이 아니다 — 초점을 받아서는 안 된다.
    //
    // 종전에는 문서 전체에 `tabindex` 가 하나도 없는지 봤는데, 그 단언이
    // **가로 스크롤 영역의 키보드 접근까지 막고 있었다**(QA14·QA15). 넘치는 표의
    // 스크롤 영역은 초점을 받아야 하고(WCAG 2.1.1) 그건 이 테스트가 막으려던 것이
    // 아니다. 검사 범위를 이 테스트가 실제로 말하는 대상(행·칸)으로 좁힌다.
    // 스크롤 영역 쪽 계약은 `table-scroll-region.test.tsx` 가 따로 고정한다.
    expect(html).not.toMatch(/<t[rd][^>]*tabindex=/i);
    expect(html).not.toContain('aria-label="홍길동 열기"');
  });

  it('onRowClick이 없으면 행에 cursor-pointer 클래스를 주지 않는다', () => {
    const html = renderToStaticMarkup(
      <DataTable columns={columns} data={rows} rowKey={(row) => row.id} />,
    );

    expect(html).not.toContain('cursor-pointer');
  });

  it('onRowClick이 있으면 행에 cursor-pointer/hover 클래스를 준다', () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(row) => row.id}
        onRowClick={() => undefined}
      />,
    );

    expect(html).toMatch(
      /<tr[^>]*class="[^"]*cursor-pointer[^"]*hover:bg-muted\/50[^"]*"/,
    );
  });

  it('headProps로 넘긴 aria-sort가 해당 컬럼의 th에 그대로 전달된다', () => {
    const sortableColumns: DataTableColumn<Applicant>[] = [
      {
        id: 'name',
        header: '이름',
        cell: (row) => row.name,
        headProps: { 'aria-sort': 'ascending' },
      },
      { id: 'status', header: '상태', cell: (row) => row.status },
    ];
    const html = renderToStaticMarkup(
      <DataTable
        columns={sortableColumns}
        data={rows}
        rowKey={(row) => row.id}
      />,
    );

    expect(html).toMatch(/<th[^>]*aria-sort="ascending"[^>]*>\s*이름/);
    expect(html).not.toMatch(/<th[^>]*aria-sort="ascending"[^>]*>\s*상태/);
  });
});

// pageSize는 opt-in이다 — 기존 호출부 9곳처럼 주지 않으면 지금 그대로 전량
// 렌더해야 하고, 준 화면(수집 대상 상세)만 페이지가 나뉘어야 한다. 클릭
// 상호작용을 확인해야 하므로 정적 마크업이 아니라 createRoot/act로 그린다.
describe('DataTable pagination', () => {
  const manyRows: Applicant[] = Array.from({ length: 25 }, (_, i) => ({
    id: `${i + 1}`,
    name: `신청자${i + 1}`,
    status: '대기',
  }));

  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function bodyRowNames(): string[] {
    return [...container.querySelectorAll('tbody tr td:first-child')].map(
      (cell) => cell.textContent ?? '',
    );
  }

  function paginationNav(): HTMLElement | null {
    return container.querySelector('nav');
  }

  function findButton(label: string): HTMLButtonElement {
    const button = [...container.querySelectorAll('button')].find(
      (el) => el.textContent === label,
    );
    if (!button) throw new Error(`「${label}」 버튼을 찾지 못했다`);
    return button as HTMLButtonElement;
  }

  it('pageSize를 주지 않으면 25행이 전부 렌더되고 pagination nav도 없다', async () => {
    await act(async () => {
      root.render(
        <DataTable
          columns={columns}
          data={manyRows}
          rowKey={(row) => row.id}
        />,
      );
    });

    expect(bodyRowNames()).toHaveLength(25);
    expect(paginationNav()).toBeNull();
  });

  it('pageSize를 주면 첫 페이지만큼만 렌더하고 페이지 라벨을 보여준다', async () => {
    await act(async () => {
      root.render(
        <DataTable
          columns={columns}
          data={manyRows}
          rowKey={(row) => row.id}
          pageSize={10}
          paginationLabel="테스트 표 페이지"
        />,
      );
    });

    expect(bodyRowNames()).toEqual(
      manyRows.slice(0, 10).map((row) => row.name),
    );
    expect(paginationNav()?.getAttribute('aria-label')).toBe(
      '테스트 표 페이지',
    );
    expect(container.textContent).toContain('1 / 3');
  });

  it('다음/이전 버튼으로 페이지를 옮기고 경계에서 버튼이 비활성화된다', async () => {
    await act(async () => {
      root.render(
        <DataTable
          columns={columns}
          data={manyRows}
          rowKey={(row) => row.id}
          pageSize={10}
          paginationLabel="테스트 표 페이지"
        />,
      );
    });

    expect(findButton('이전').disabled).toBe(true);
    expect(findButton('다음').disabled).toBe(false);

    await act(async () => {
      findButton('다음').click();
    });
    expect(container.textContent).toContain('2 / 3');
    expect(bodyRowNames()).toEqual(
      manyRows.slice(10, 20).map((row) => row.name),
    );
    expect(findButton('이전').disabled).toBe(false);

    await act(async () => {
      findButton('다음').click();
    });
    expect(container.textContent).toContain('3 / 3');
    // 25행을 10개씩 나누면 마지막 페이지는 5행만 남는다.
    expect(bodyRowNames()).toEqual(
      manyRows.slice(20, 25).map((row) => row.name),
    );
    expect(findButton('다음').disabled).toBe(true);

    await act(async () => {
      findButton('이전').click();
    });
    expect(container.textContent).toContain('2 / 3');
  });

  it('전체 행 수가 pageSize 이하면 pagination nav를 그리지 않는다', async () => {
    await act(async () => {
      root.render(
        <DataTable
          columns={columns}
          data={rows}
          rowKey={(row) => row.id}
          pageSize={10}
        />,
      );
    });

    expect(paginationNav()).toBeNull();
  });

  // QA61 — 데이터가 줄어 페이지 state를 렌더 시점에 눌러 담은 뒤 데이터가 다시
  // 늘어나면(regrow), 눌러 담기 전 페이지 state가 그대로 남아 있어 엉뚱한
  // 페이지로 튀었다. state 자체가 축소 시점에 눌린 페이지를 따라가야 한다.
  it('데이터가 줄었다 다시 늘어나도 축소 시점에 눌린 페이지를 유지한다(페이지가 튀지 않는다)', async () => {
    const shrunkRows = manyRows.slice(0, 15); // pageSize 10 → 2페이지

    await act(async () => {
      root.render(
        <DataTable
          columns={columns}
          data={manyRows}
          rowKey={(row) => row.id}
          pageSize={10}
          paginationLabel="테스트 표 페이지"
        />,
      );
    });

    await act(async () => {
      findButton('다음').click();
    });
    await act(async () => {
      findButton('다음').click();
    });
    expect(container.textContent).toContain('3 / 3');

    // 데이터가 2페이지 분량으로 줄어든다 — 렌더 시점 클램프로 2페이지에 눌린다.
    await act(async () => {
      root.render(
        <DataTable
          columns={columns}
          data={shrunkRows}
          rowKey={(row) => row.id}
          pageSize={10}
          paginationLabel="테스트 표 페이지"
        />,
      );
    });
    expect(container.textContent).toContain('2 / 2');

    // 데이터가 원래대로(3페이지) 다시 늘어난다 — state가 3페이지였던 걸
    // 기억하고 있으면 "3 / 3"으로 튀어야 하지만, 축소 시점에 state 자체가
    // 2로 눌렸으므로 "2 / 3"이어야 한다.
    await act(async () => {
      root.render(
        <DataTable
          columns={columns}
          data={manyRows}
          rowKey={(row) => row.id}
          pageSize={10}
          paginationLabel="테스트 표 페이지"
        />,
      );
    });
    expect(container.textContent).toContain('2 / 3');
    expect(container.textContent).not.toContain('3 / 3');
    expect(bodyRowNames()).toEqual(
      manyRows.slice(10, 20).map((row) => row.name),
    );
  });
});
