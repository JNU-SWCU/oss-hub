import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardProgramSections } from './components/dashboard-program-sections';
import {
  dashboardFeedback,
  dashboardItem,
  dashboardMilestone,
} from './fixtures';
import type { DashboardFeedbackItem, DashboardItem } from './types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.ComponentProps<'a'> & { readonly href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const active = (key: string, dueAt: string) =>
  dashboardItem(key, 'APPROVED', dashboardMilestone(dueAt));
const done = dashboardItem('done', 'APPROVED');
const fiveItems = [
  active('soon', '2026-07-25T23:59:59+09:00'),
  active('later', '2026-08-05T23:59:59+09:00'),
  done,
  dashboardItem('submitted', 'SUBMITTED'),
  dashboardItem('rejected', 'REJECTED'),
];

describe('DashboardProgramSections', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => {
      root.unmount();
      return Promise.resolve();
    });
    container.remove();
  });

  async function render(
    items: readonly DashboardItem[],
    feedback: readonly DashboardFeedbackItem[] = [],
  ) {
    await act(() => {
      root.render(
        <DashboardProgramSections
          items={items}
          now={new Date('2026-07-23T10:00:00+09:00')}
          feedback={feedback}
        />,
      );
      return Promise.resolve();
    });
  }

  async function click(element: HTMLElement | undefined) {
    if (element === undefined) throw new Error('누를 대상이 없습니다.');
    await act(() => {
      element.click();
      return Promise.resolve();
    });
  }

  const headings = () =>
    Array.from(container.querySelectorAll('h2'), (h2) => h2.textContent);
  const buttonNamed = (name: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === name,
    );
  const doneList = () => {
    const list = document.getElementById('dashboard-done-programs');
    if (list === null) throw new Error('마친 프로그램 목록이 없습니다.');
    return list;
  };

  it('칩 하나를 고르면 그 묶음만 남기고 마친 프로그램은 펼쳐서 보인다', async () => {
    await render(fiveItems);
    const group = container.querySelector('[role="group"]');

    expect(group?.getAttribute('aria-label')).toBe('프로그램 거르기');
    expect(headings()).toEqual(['진행 중', '마친 프로그램', '신청 상태']);

    await click(buttonNamed('진행 중 2'));
    expect(headings()).toEqual(['진행 중']);
    expect(buttonNamed('진행 중 2')?.getAttribute('aria-pressed')).toBe('true');
    expect(buttonNamed('전체 5')?.getAttribute('aria-pressed')).toBe('false');

    await click(buttonNamed('마친 프로그램 1'));
    expect(headings()).toEqual(['마친 프로그램']);
    expect(doneList().getAttribute('data-state')).toBe('open');
    expect(buttonNamed('펼치기')).toBeUndefined();
    expect(buttonNamed('접기')).toBeUndefined();

    await click(buttonNamed('신청 상태 2'));
    expect(headings()).toEqual(['신청 상태']);

    await click(buttonNamed('전체 5'));
    expect(headings()).toEqual(['진행 중', '마친 프로그램', '신청 상태']);
    expect(doneList().getAttribute('data-state')).toBe('closed');
  });

  it('진행 중이 있으면 마친 프로그램을 접어 두고 펼치기·접기로 연다', async () => {
    await render([active('soon', '2026-07-25T23:59:59+09:00'), done]);
    const trigger = buttonNamed('펼치기');

    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(trigger?.getAttribute('aria-controls')).toBe(doneList().id);
    expect(doneList().getAttribute('data-state')).toBe('closed');

    await click(trigger);
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    expect(trigger?.textContent).toBe('접기');
    expect(doneList().getAttribute('data-state')).toBe('open');
    expect(doneList().textContent).toContain(done.programName);

    await click(trigger);
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(doneList().getAttribute('data-state')).toBe('closed');
  });

  it('진행 중이 없으면 마친 프로그램을 펼친 채 두고 접기 버튼을 두지 않는다', async () => {
    await render([done, dashboardItem('submitted', 'SUBMITTED')]);

    expect(doneList().getAttribute('data-state')).toBe('open');
    expect(container.querySelector('[aria-controls]')).toBeNull();
  });
  it('피드백 더 보기는 그 자리에서 펼치고 접는 토글이고 초점은 버튼에 남는다', async () => {
    const program = active('soon', '2026-07-25T23:59:59+09:00');
    await render(
      [program],
      ['1', '2', '3', '4', '5'].map((key) => dashboardFeedback(program, key)),
    );
    const linkTexts = () =>
      Array.from(
        container.querySelectorAll('ul[aria-labelledby] a'),
        (link) => link.textContent,
      );
    const toggle = buttonNamed('피드백 2건 더 보기');
    const firstThree = [
      '중간 보고 · 합성 서류 1',
      '중간 보고 · 합성 서류 2',
      '중간 보고 · 합성 서류 3',
    ];

    expect(linkTexts()).toEqual(firstThree);
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(
      document.getElementById(toggle?.getAttribute('aria-controls') ?? '')
        ?.tagName,
    ).toBe('UL');

    toggle?.focus();
    await click(toggle);

    expect(linkTexts()).toEqual([
      ...firstThree,
      '중간 보고 · 합성 서류 4',
      '중간 보고 · 합성 서류 5',
    ]);
    expect(toggle?.textContent).toBe('피드백 접기');
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(toggle);

    await click(toggle);

    expect(linkTexts()).toEqual(firstThree);
    expect(toggle?.textContent).toBe('피드백 2건 더 보기');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });

  it('새 피드백 칩은 판정을 받은 진행 중 카드와 마친 프로그램 줄만 한 묶음으로 보인다', async () => {
    const [soon, later] = fiveItems;
    if (soon === undefined || later === undefined) {
      throw new Error('진행 중 프로그램 두 개가 필요합니다.');
    }
    await render(fiveItems, [
      dashboardFeedback(later, 'a'),
      dashboardFeedback(done, 'b', { decision: 'APPROVED' }),
    ]);

    await click(buttonNamed('새 피드백 있음 2'));

    expect(headings()).toEqual(['새 피드백이 있는 프로그램']);
    expect(
      Array.from(container.querySelectorAll('h3'), (h3) => h3.textContent),
    ).toEqual([later.programName, done.programName]);
    expect(container.textContent).not.toContain(soon.programName);
    expect(buttonNamed('새 피드백 있음 2')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});
