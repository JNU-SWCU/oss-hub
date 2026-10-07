import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DataTable, type DataTableColumn } from './data-table';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';

interface Row {
  readonly id: string;
  readonly name: string;
}

const columns: DataTableColumn<Row>[] = [
  { id: 'name', header: '이름', cell: (row) => row.name },
];
const rows: Row[] = [{ id: 'r1', name: '홍길동' }];

function container(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  const element = host.querySelector('[data-slot="table-container"]');
  if (element === null) throw new Error('table-container 를 찾지 못했다');
  return element;
}

describe('표 스크롤 영역', () => {
  it('이름을 주지 않아도 키보드 초점은 받는다', () => {
    const element = container(
      renderToStaticMarkup(
        <DataTable columns={columns} data={rows} rowKey={(row) => row.id} />,
      ),
    );

    expect(element.getAttribute('tabindex')).toBe('0');
  });

  it('이름을 주면 이름 있는 region 이 된다', () => {
    const element = container(
      renderToStaticMarkup(
        <DataTable
          columns={columns}
          data={rows}
          rowKey={(row) => row.id}
          scrollRegionLabel="감사 로그 표"
        />,
      ),
    );

    expect(element.getAttribute('role')).toBe('region');
    expect(element.getAttribute('aria-label')).toBe('감사 로그 표');
  });

  it('이름이 없으면 region 으로 만들지 않는다', () => {
    const element = container(
      renderToStaticMarkup(
        <DataTable columns={columns} data={rows} rowKey={(row) => row.id} />,
      ),
    );

    expect(element.getAttribute('role')).toBeNull();
  });

  it('스크롤 안내는 초점을 받는 요소에 붙는다', () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(row) => row.id}
        scrollRegionLabel="신청자 목록 표"
        aria-describedby="scroll-hint"
      />,
    );
    const host = document.createElement('div');
    host.innerHTML = html;

    const scrollRegion = host.querySelector('[data-slot="table-container"]');
    const outerWrapper = host.querySelector('[data-slot="data-table"]');

    expect(scrollRegion?.getAttribute('aria-describedby')).toBe('scroll-hint');

    expect(outerWrapper?.getAttribute('aria-describedby')).toBeNull();
  });

  it('행은 여전히 컨트롤이 아니다 — 초점은 스크롤 영역 하나만 받는다', () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(row) => row.id}
        scrollRegionLabel="표"
      />,
    );

    const host = document.createElement('div');
    host.innerHTML = html;
    const focusable = [...host.querySelectorAll('[tabindex]')].map((element) =>
      element.getAttribute('data-slot'),
    );

    expect(focusable).toEqual(['table-container']);
  });

  it('Table 을 직접 쓰는 화면에서도 같다', () => {
    const element = container(
      renderToStaticMarkup(
        <Table scrollRegionLabel="활동 추이 표">
          <TableBody>
            <TableRow>
              <TableCell>1</TableCell>
            </TableRow>
          </TableBody>
        </Table>,
      ),
    );

    expect(element.getAttribute('tabindex')).toBe('0');
    expect(element.getAttribute('aria-label')).toBe('활동 추이 표');
  });
});
