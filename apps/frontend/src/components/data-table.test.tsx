import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DataTable, type DataTableColumn } from './data-table';

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
});
