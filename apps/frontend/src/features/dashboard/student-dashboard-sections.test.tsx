import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardProgramSections } from './components/dashboard-program-sections';
import { dashboardItem, dashboardMilestone } from './fixtures';
import type { DashboardItem } from './types';

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

  async function render(items: readonly DashboardItem[]) {
    await act(() => {
      root.render(
        <DashboardProgramSections
          items={items}
          now={new Date('2026-07-23T10:00:00+09:00')}
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
    expect(container.querySelector('[role="group"]')).toBeNull();
  });
});
