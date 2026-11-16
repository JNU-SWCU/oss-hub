import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STAFF_INSIGHTS_FIXTURE } from './fixtures';
import { ProgramsTab } from './program-scorecard';
import type { StaffInsightsSummary } from './types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('ProgramsTab scorecard', () => {
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

  async function render(
    summary: StaffInsightsSummary = STAFF_INSIGHTS_FIXTURE,
  ): Promise<void> {
    await act(async () => root.render(<ProgramsTab summary={summary} />));
  }

  function programOrder(): string[] {
    return Array.from(
      container.querySelectorAll('[data-slot="program-name"]'),
    ).map((cell) => cell.textContent ?? '');
  }

  function rowFor(name: string): HTMLTableRowElement {
    const row = Array.from(container.querySelectorAll('tbody tr')).find(
      (candidate) => candidate.textContent?.includes(name),
    );
    if (!(row instanceof HTMLTableRowElement)) {
      throw new Error(`missing row ${name}`);
    }
    return row;
  }

  function columnHead(title: string): HTMLTableCellElement {
    const head = Array.from(container.querySelectorAll('thead th')).find(
      (candidate) => candidate.firstElementChild?.textContent === title,
    );
    if (!(head instanceof HTMLTableCellElement)) {
      throw new Error(`missing column ${title}`);
    }
    return head;
  }

  async function sortBy(label: string): Promise<void> {
    const button = Array.from(container.querySelectorAll('thead button')).find(
      (candidate) => candidate.textContent === label,
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`missing sort button ${label}`);
    }
    await act(async () => button.click());
  }

  it('shows the four program KPI tiles', async () => {
    await render();

    const kpis = container.querySelector('[aria-label="프로그램 지표"]');
    const text = kpis?.textContent ?? '';
    expect(text).toContain('운영 프로그램4모집 중 1개');
    expect(text).toContain('승인 참여 학생48중복 제외 41명');
    expect(text).toContain('평균 경쟁률1.6:1신청 ÷ 승인');
    expect(text).toContain('재참여 학생15%2개 이상 프로그램 참여 6명');
  });

  it('renders null KPI and row metrics as a dash with an explanation', async () => {
    await render({
      ...STAFF_INSIGHTS_FIXTURE,
      programSummary: {
        ...STAFF_INSIGHTS_FIXTURE.programSummary,
        competitionRatio: null,
        repeatParticipantRate: null,
      },
    });

    const kpis = container.querySelector('[aria-label="프로그램 지표"]');
    expect(kpis?.textContent).toContain('평균 경쟁률—');
    expect(kpis?.textContent).toContain('재참여 학생—');
    const cells = Array.from(
      rowFor('합성 기업인턴십 모집').querySelectorAll('td'),
    ).map((cell) => cell.textContent);
    expect(cells).toEqual([
      '신청 5건 → 승인 0건 · —',
      '—',
      '—마감된 마일스톤 없음',
      '—연결된 저장소 없음',
    ]);
    expect(rowFor('합성 기업인턴십 모집').textContent).toContain('모집 중');
    expect(rowFor('합성 캡스톤 2026').textContent).toContain(
      '연결된 저장소 없음',
    );
  });

  it('sorts by approved participants first and keeps nulls last in both directions', async () => {
    await render();

    expect(programOrder()).toEqual([
      '합성 기초 오픈소스 스터디',
      '합성 캡스톤 2026',
      '합성 OSS 경진대회',
      '합성 기업인턴십 모집',
    ]);

    await sortBy('완주율');
    const descending = programOrder();
    expect(descending.slice(0, 2)).toEqual([
      '합성 기초 오픈소스 스터디',
      '합성 캡스톤 2026',
    ]);
    expect(descending.slice(2).sort()).toEqual(
      ['합성 OSS 경진대회', '합성 기업인턴십 모집'].sort(),
    );

    await sortBy('완주율');
    const ascending = programOrder();
    expect(ascending.slice(0, 2)).toEqual([
      '합성 캡스톤 2026',
      '합성 기초 오픈소스 스터디',
    ]);
    expect(ascending.slice(2).sort()).toEqual(
      ['합성 OSS 경진대회', '합성 기업인턴십 모집'].sort(),
    );
  });

  it('marks only the active column with aria-sort', async () => {
    await render();

    expect(columnHead('구성').getAttribute('aria-sort')).toBe('descending');
    expect(columnHead('완주').hasAttribute('aria-sort')).toBe(false);

    await sortBy('경쟁률');
    expect(columnHead('모집').getAttribute('aria-sort')).toBe('descending');
    expect(columnHead('구성').hasAttribute('aria-sort')).toBe(false);
    expect(programOrder()[0]).toBe('합성 캡스톤 2026');
    expect(programOrder().at(-1)).toBe('합성 기업인턴십 모집');

    await sortBy('경쟁률');
    expect(columnHead('모집').getAttribute('aria-sort')).toBe('ascending');
  });

  it.each([
    [
      '비SW 비율',
      ['합성 기초 오픈소스 스터디', '합성 캡스톤 2026', '합성 OSS 경진대회'],
      ['합성 캡스톤 2026', '합성 OSS 경진대회', '합성 기초 오픈소스 스터디'],
      ['합성 기업인턴십 모집'],
    ],
    [
      '성과',
      ['합성 기초 오픈소스 스터디', '합성 OSS 경진대회'],
      ['합성 OSS 경진대회', '합성 기초 오픈소스 스터디'],
      ['합성 캡스톤 2026', '합성 기업인턴십 모집'],
    ],
  ])(
    'sorts %s numerically with missing values last',
    async (label, desc, asc, missing) => {
      await render();

      await sortBy(label);
      expect(programOrder().slice(0, desc.length)).toEqual(desc);
      expect(programOrder().slice(desc.length).sort()).toEqual(
        [...missing].sort(),
      );
      await sortBy(label);
      expect(programOrder().slice(0, asc.length)).toEqual(asc);
      expect(programOrder().slice(asc.length).sort()).toEqual(
        [...missing].sort(),
      );
    },
  );

  it.each([
    [59, 'text-status-pending-fg'],
    [60, 'text-foreground'],
    [79, 'text-foreground'],
    [80, 'text-status-approved-fg'],
  ])(
    'uses the completion threshold tone for %i percent',
    async (rate, tone) => {
      await render({
        ...STAFF_INSIGHTS_FIXTURE,
        programs: [
          { ...STAFF_INSIGHTS_FIXTURE.programs[0], completionRate: rate },
        ],
      });

      const value = rowFor('합성 기초 오픈소스 스터디').querySelector(
        'td:nth-child(4) span',
      );
      expect(value?.textContent).toBe(`${rate}%`);
      expect(value?.classList.contains(tone)).toBe(true);
    },
  );

  it('counts applications in 건 and never writes a number followed by 팀', async () => {
    await render();

    const text = container.textContent ?? '';
    expect(text).toContain('신청 14건 → 승인 10건 · 1.4:1');
    expect(text).toContain('1인당 팀 저장소 기여 · 활동 팀 8/9');
    expect(text).toContain('마일스톤 제출 30/36');
    expect(text).not.toMatch(/\d\s*팀/);
  });

  it('keeps the empty state when no program is published', async () => {
    await render({ ...STAFF_INSIGHTS_FIXTURE, programs: [] });

    expect(container.textContent).toContain('운영 중인 프로그램이 없습니다');
    expect(container.querySelector('table')).toBeNull();
  });
});
