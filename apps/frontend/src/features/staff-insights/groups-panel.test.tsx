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

  function tableDepartments(): string[] {
    return Array.from(
      container.querySelectorAll('.sr-only tbody tr td:nth-child(2)'),
    ).map((cell) => cell.textContent ?? '');
  }

  async function chooseSort(label: string): Promise<void> {
    const group = container.querySelector('[aria-label="학과 순위 기준"]');
    const chip = Array.from(group?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent === label,
    );
    expect(chip).toBeDefined();
    await act(async () => chip?.click());
  }

  function withDepartments(
    departments: StaffInsightsSummary['departments'],
  ): StaffInsightsSummary {
    return { ...STAFF_INSIGHTS_FIXTURE, departments };
  }

  it('ranks departments by student count by default and never charts 미등록', async () => {
    await render(STAFF_INSIGHTS_FIXTURE);

    const pressed = container.querySelector(
      '[aria-label="학과 순위 기준"] [aria-pressed="true"]',
    );
    expect(pressed?.textContent).toBe('가입 학생 수');
    expect(tableDepartments()).toEqual([
      '소프트웨어공학과',
      '인공지능학부',
      '빅데이터융합학과',
      '문헌정보학과(문헌정보SW트랙)',
      '컴퓨터정보통신공학과',
      '전자컴퓨터공학부(컴퓨터공학전공)',
    ]);
    expect(
      container.querySelector('.sr-only table')?.textContent,
    ).not.toContain('미등록');
    expect(container.textContent).not.toContain('표본 적음');
  });

  it('reorders by activity per student and moves small samples to the 표본 적음 line', async () => {
    await render(STAFF_INSIGHTS_FIXTURE);
    await chooseSort('1인당 활동량');

    expect(tableDepartments()).toEqual([
      '소프트웨어공학과',
      '인공지능학부',
      '컴퓨터정보통신공학과',
      '빅데이터융합학과',
      '문헌정보학과(문헌정보SW트랙)',
    ]);
    expect(
      container.querySelector('[data-slot="department-small-samples"]')
        ?.textContent,
    ).toBe('표본 적음 (가입 3명 미만): 전자컴퓨터공학부(컴퓨터공학전공)');
    expect(
      container.querySelector('.sr-only table')?.textContent,
    ).not.toContain('미등록');
  });

  it('shows cohort KPI tiles with ratio chips and the unregistered count', async () => {
    await render(STAFF_INSIGHTS_FIXTURE);
    const kpis = container.querySelector('[aria-label="전공별 지표"]');
    const text = kpis?.textContent ?? '';

    expect(text).toContain('SW전공 가입 학생42명');
    expect(text).toContain('SW전공 활동률74%31/42');
    expect(text).toContain('SW전공 프로그램 참여율67%28/42');
    expect(text).toContain('비SW전공 활동률50%9/18');
    expect(text).toContain('비SW전공 프로그램 참여율61%11/18');
    expect(text).toContain('학과 미등록3명');
  });

  it('marks participation-rate tiles as current approved state, not period-scoped', async () => {
    await render(STAFF_INSIGHTS_FIXTURE);
    const tiles = Array.from(
      container.querySelectorAll('[aria-label="전공별 지표"] > *'),
    ).map((tile) => tile.textContent ?? '');
    const withNote = tiles.filter((text) =>
      text.includes('현재 승인 기준 · 기간 미적용'),
    );

    expect(withNote).toHaveLength(2);
    expect(withNote.every((text) => text.includes('프로그램 참여율'))).toBe(
      true,
    );
  });

  it('marks registered-student and unregistered tiles as current sign-up state, not period-scoped', async () => {
    await render(STAFF_INSIGHTS_FIXTURE);
    const tiles = Array.from(
      container.querySelectorAll('[aria-label="전공별 지표"] > *'),
    ).map((tile) => tile.textContent ?? '');
    const withNote = tiles.filter((text) =>
      text.includes('현재 가입 기준 · 기간 미적용'),
    );

    expect(withNote).toEqual([
      'SW전공 가입 학생42명현재 가입 기준 · 기간 미적용',
      '비SW전공 가입 학생18명현재 가입 기준 · 기간 미적용',
      '학과 미등록3명현재 가입 기준 · 기간 미적용',
    ]);
    expect(
      tiles
        .filter((text) => text.includes('활동률'))
        .some((text) => text.includes('기간 미적용')),
    ).toBe(false);
  });

  it('renders 계산 불가 when a cohort has no registered students', async () => {
    await render({
      ...STAFF_INSIGHTS_FIXTURE,
      cohorts: STAFF_INSIGHTS_FIXTURE.cohorts.filter(
        (row) => row.cohort !== DEPARTMENT_COHORTS.NON_SW,
      ),
    });
    const text =
      container.querySelector('[aria-label="전공별 지표"]')?.textContent ?? '';

    expect(text).toContain('비SW전공 가입 학생0명');
    expect(text).toContain('비SW전공 활동률계산 불가');
    expect(text).toContain('비SW전공 프로그램 참여율계산 불가');
  });

  it('shows the per-student empty state when every department is a small sample', async () => {
    await render(
      withDepartments(
        STAFF_INSIGHTS_FIXTURE.departments.map((row) => ({
          ...row,
          studentCount: row.cohort === DEPARTMENT_COHORTS.UNREGISTERED ? 3 : 2,
          sampleTooSmall: row.cohort !== DEPARTMENT_COHORTS.UNREGISTERED,
        })),
      ),
    );
    await chooseSort('1인당 활동량');

    expect(container.textContent).toContain('1인당 순위를 낼 학과가 없습니다');
    expect(container.querySelector('.sr-only table')).toBeNull();
    expect(container.textContent).toContain('표본 적음 (가입 3명 미만): ');
  });

  it('shows the department empty state with no departments or only 미등록', async () => {
    await render(withDepartments([]));
    expect(container.textContent).toContain('학과별 학생이 없습니다');
    expect(container.querySelector('[aria-label="학과 순위 기준"]')).toBeNull();

    await render(
      withDepartments(
        STAFF_INSIGHTS_FIXTURE.departments.filter(
          (row) => row.cohort === DEPARTMENT_COHORTS.UNREGISTERED,
        ),
      ),
    );
    expect(container.textContent).toContain('학과별 학생이 없습니다');
  });

  it('keeps zero-student departments in the count ranking without breaking', async () => {
    await render(
      withDepartments(
        STAFF_INSIGHTS_FIXTURE.departments.map((row) =>
          row.department === '인공지능학부'
            ? { ...row, studentCount: 0, activityPerStudent: 0 }
            : row,
        ),
      ),
    );

    expect(tableDepartments().at(-1)).toBe('인공지능학부');
  });
});
