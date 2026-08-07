// @vitest-environment happy-dom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DataTable, type DataTableColumn } from './data-table';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';

/**
 * 가로로 넘치는 표의 스크롤 영역이 **키보드로 도달 가능**한지 검사한다(WCAG 2.1.1).
 *
 * 종전에는 `data-slot="table-container"` 에 `tabIndex` 가 없어 마우스·터치로만 숨은
 * 열을 볼 수 있었다(QA14 감사 로그 · QA15 신청자 표). 더 나빴던 것은 화면들이
 * 「표를 좌우로 스크롤할 수 있습니다」 안내를 `aria-describedby` 로 붙여 놓고 **그
 * 안내가 초점을 못 받는 바깥 래퍼에 실려 있었다**는 점이다 — 스크린리더 사용자에게
 * 안내는 하는데 그렇게 할 방법이 없었다.
 *
 * jsdom 은 레이아웃을 계산하지 않아 «실제로 넘치는가» 는 여기서 못 본다. 그건 눈으로
 * 확인한다. 이 파일이 고정하는 것은 **초점·이름·안내가 어느 요소에 붙는가** 다.
 */

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
    // 이름이 있을 때만 초점을 주면, 이름을 빠뜨린 새 표가 조용히 접근 불가로
    // 돌아간다 — 원래 결함이 정확히 그렇게 생겼다.
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
    // 이름 없는 region 은 화면 읽기 도구에 "영역" 이라고만 들려 없느니만 못하다.
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
    // 바깥 래퍼는 초점을 못 받으므로 안내가 거기 남아 있으면 안 된다.
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
