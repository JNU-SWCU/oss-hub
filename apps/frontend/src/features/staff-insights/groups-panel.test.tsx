import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STAFF_INSIGHTS_FIXTURE } from './fixtures';
import { GroupsTab } from './groups-panel';
import { DEPARTMENT_COHORTS, type StaffInsightsSummary } from './types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('GroupsTab', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(summary: StaffInsightsSummary): Promise<void> {
    await act(async () => root.render(<GroupsTab summary={summary} />));
  }

  function tableRows(): HTMLTableRowElement[] {
    return Array.from(
      container.querySelectorAll<HTMLTableRowElement>(
        '[aria-label="학과·전공 표"] tbody tr',
      ),
    );
  }

  function withDepartments(
    departments: StaffInsightsSummary['departments'],
  ): StaffInsightsSummary {
    return { ...STAFF_INSIGHTS_FIXTURE, departments };
  }

  it('ranks registered departments by per-student activity and keeps small samples visible', async () => {
    await render(STAFF_INSIGHTS_FIXTURE);

    const rows = tableRows();
    expect(rows.map((row) => row.cells[0].textContent)).toEqual([
      '소프트웨어공학과',
      '전자컴퓨터공학부(컴퓨터공학전공)',
      '인공지능학부',
      '컴퓨터정보통신공학과',
      '빅데이터융합학과',
      '문헌정보학과(문헌정보SW트랙)',
    ]);
    expect(rows[0].cells[0].getAttribute('scope')).toBe('row');
    expect(rows[1].cells[1].textContent).toContain('표본 적음');
    expect(
      container.querySelector('thead th[aria-sort="descending"]')?.textContent,
    ).toBe('1인당 활동 합계');
  });

  it('uses cohort student totals and counts a department with multiple majors once', async () => {
    const departments = STAFF_INSIGHTS_FIXTURE.departments;
    await render(
      withDepartments([
        ...departments,
        { ...departments[0], major: '합성 전공' },
      ]),
    );

    const tiles = Array.from(
      container.querySelectorAll('[aria-label="학과·전공 지표"] > *'),
      (tile) => tile.textContent,
    );
    expect(tiles).toEqual(['가입 학생63명', '활동 학생40명', '학과 수6개']);
    expect(tableRows()).toHaveLength(7);
  });

  it('renders nullable values as a dash without hiding observed zero activity', async () => {
    const [observed, unknown] = STAFF_INSIGHTS_FIXTURE.departments;
    await render(
      withDepartments([
        { ...observed, major: '합성 전공', recentPerStudent: 0 },
        unknown,
      ]),
    );

    const [observedRow, unknownRow] = tableRows();
    expect(Array.from(observedRow.cells, (cell) => cell.textContent)).toEqual([
      '소프트웨어공학과',
      '합성 전공',
      '20',
      '80%',
      '18.5',
      '0.0',
    ]);
    expect(unknownRow.cells[1].textContent).toBe('—');
    expect(unknownRow.cells[5].textContent).toBe('—');
  });

  it('does not divide by zero for an empty department row', async () => {
    await render(
      withDepartments([
        {
          ...STAFF_INSIGHTS_FIXTURE.departments[0],
          studentCount: 0,
          activeStudentCount: 0,
          participantCount: 0,
          activityPerStudent: 0,
          recentPerStudent: null,
        },
      ]),
    );

    const [row] = tableRows();
    expect(Array.from(row.cells, (cell) => cell.textContent).slice(2)).toEqual([
      '0',
      '—',
      '—',
      '—',
    ]);
  });

  it('shows the department empty state with no departments or only 미등록', async () => {
    await render(withDepartments([]));
    expect(container.textContent).toContain('학과별 학생이 없습니다');
    expect(container.querySelector('table')).toBeNull();

    await render(
      withDepartments(
        STAFF_INSIGHTS_FIXTURE.departments.filter(
          (row) => row.cohort === DEPARTMENT_COHORTS.UNREGISTERED,
        ),
      ),
    );
    expect(container.textContent).toContain('학과별 학생이 없습니다');
    expect(container.querySelector('table')).toBeNull();
  });
});
