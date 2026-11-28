import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditLogView, type AuditLogViewProps } from './audit-log-view';
import { AUDIT_LOG_PAGE_RESPONSE_FIXTURE } from './fixtures';
import { parseAuditLogPage } from './parser';
import {
  AUDIT_LOG_ACTIONS,
  AUDIT_LOG_CATEGORIES,
  AUDIT_LOG_PERIODS,
  type AuditLogFilters,
  type AuditLogRecord,
} from './types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const fixture = parseAuditLogPage(AUDIT_LOG_PAGE_RESPONSE_FIXTURE);
const change = fixture.items[0];
const FILTERS: AuditLogFilters = {
  q: '',
  action: '',
  period: '30d',
  from: '',
  to: '',
};

function login(id: string, occurredAt: string): AuditLogRecord {
  return { ...change, id, occurredAt, action: 'LOGIN', category: 'LOGIN' };
}

const PROFILE: AuditLogRecord = {
  ...change,
  id: 'profile',
  action: 'USER_PROFILE_UPDATED',
  category: 'ACCOUNT',
  change: null,
  fieldChanges: [
    { field: 'name', before: null, after: '합성학생' },
    { field: 'studentId', before: null, after: '000001' },
    { field: 'department', before: '합성학과', after: '합성전공' },
  ],
};

const RUN = [
  login('login-b', '2026-11-17T05:30:00.000Z'),
  login('login-a', '2026-11-17T05:20:00.000Z'),
];

function baseProps(): AuditLogViewProps {
  return {
    records: fixture.items,
    counts: fixture.counts,
    filters: FILTERS,
    category: '',
    view: 'feed',
    page: 1,
    limit: 50,
    total: fixture.total,
    isLoading: false,
    errorMessage: null,
    now: new Date('2026-11-17T06:00:00.000Z'),
    foldLogins: true,
    onFilterChange: vi.fn(),
    onApply: vi.fn(),
    onCancel: vi.fn(),
    onCategoryChange: vi.fn(),
    onViewChange: vi.fn(),
    onPageChange: vi.fn(),
    onRetry: vi.fn(),
    onSearchPerson: vi.fn(),
  };
}

function element<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`missing ${selector}`);
  return found;
}

function timestamps(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll('time'), (time) => time.dateTime);
}

describe('AuditLogView', () => {
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

  async function render(overrides: Partial<AuditLogViewProps> = {}) {
    const props = { ...baseProps(), ...overrides };
    await act(async () => root.render(<AuditLogView {...props} />));
    return props;
  }

  it('marks the selected category tab and shows each response count', async () => {
    await render({ category: 'OPERATION' });

    const tabs = Array.from(
      element(container, '[role="group"][aria-label="분류"]').querySelectorAll(
        'button',
      ),
    );
    const all = AUDIT_LOG_CATEGORIES.reduce(
      (sum, category) => sum + fixture.counts[category],
      0,
    );

    expect(tabs.map((tab) => tab.getAttribute('aria-pressed'))).toEqual(
      ['', ...AUDIT_LOG_CATEGORIES].map((category) =>
        String(category === 'OPERATION'),
      ),
    );
    expect(tabs.map((tab) => tab.querySelector('span')?.textContent)).toEqual(
      [all, ...AUDIT_LOG_CATEGORIES.map((key) => fixture.counts[key])].map(
        String,
      ),
    );
  });

  it('offers every period and every audit action as a filter option', async () => {
    await render();

    const [period, action] = Array.from(
      element(container, 'form').querySelectorAll('select'),
      (select) => Array.from(select.options, (option) => option.value),
    );

    expect(period).toEqual([...AUDIT_LOG_PERIODS]);
    expect(action).toEqual(['', ...AUDIT_LOG_ACTIONS]);
  });

  it('folds a login run behind one row and shows its records when expanded', async () => {
    await render({ records: [...RUN, change] });

    const toggle = element<HTMLButtonElement>(container, '[aria-expanded]');
    const panel = element<HTMLUListElement>(
      container,
      `[id="${toggle.getAttribute('aria-controls')}"]`,
    );
    expect(container.querySelectorAll('[aria-expanded]')).toHaveLength(1);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hidden).toBe(true);
    expect(timestamps(container)).toEqual([change.occurredAt]);

    await act(async () => toggle.click());

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hidden).toBe(false);
    expect(timestamps(panel)).toEqual(RUN.map((record) => record.occurredAt));

    await act(async () => toggle.click());

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(timestamps(container)).toEqual([change.occurredAt]);
  });

  it('lists login records one by one when folding is off', async () => {
    await render({ records: [...RUN, change], foldLogins: false });

    expect(container.querySelectorAll('[aria-expanded]')).toHaveLength(0);
    expect(timestamps(container)).toEqual(
      [...RUN, change].map((record) => record.occurredAt),
    );
  });

  it('searches the actor from the row without showing the GitHub login', async () => {
    const props = await render({ records: [change] });

    const row = element(container, 'li');
    const actor = element<HTMLButtonElement>(
      row,
      'button[aria-label$="기록 검색"]',
    );
    expect(row.textContent).not.toContain('synthetic-admin');

    await act(async () => actor.click());

    expect(props.onSearchPerson).toHaveBeenCalledWith('synthetic-admin');
  });

  it('keeps a single change on one line without a disclosure', async () => {
    await render({ records: [change] });

    expect(container.querySelector('[aria-expanded]')).toBeNull();
    expect(container.querySelector('dl')).toBeNull();
  });

  it('shows the first field change in the row and the rest below it when expanded', async () => {
    await render({ records: [PROFILE] });

    const row = element(container, 'li');
    const toggle = element<HTMLButtonElement>(row, '[aria-expanded]');
    const details = element<HTMLElement>(
      container,
      `[id="${toggle.getAttribute('aria-controls')}"]`,
    );
    expect(toggle.getAttribute('aria-label')).toBe('프로필 수정 변경 내용');
    expect(row.firstElementChild?.textContent).toContain('이름합성학생');
    expect(row.firstElementChild?.textContent).toContain('+2');
    expect(details.hidden).toBe(true);

    await act(async () => toggle.click());

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(details.hidden).toBe(false);
    expect(
      Array.from(details.querySelectorAll('dt'), (term) => term.textContent),
    ).toEqual(['학번', '학과']);
    expect(details.textContent).toContain('합성학과→합성전공');
    expect(details.textContent).not.toContain('합성학생');
  });

  it('renders six columns and lists every field change in table view', async () => {
    await render({ view: 'table', records: [...fixture.items, PROFILE] });

    expect(container.querySelectorAll('thead th')).toHaveLength(6);
    expect(container.querySelector('tbody')?.textContent).toContain(
      '학과합성학과→합성전공',
    );
    expect(container.querySelectorAll('tbody tr')).toHaveLength(
      fixture.items.length + 1,
    );
  });

  it('applies a period choice at once and the search text on Enter', async () => {
    const draft = { ...FILTERS, q: 'synthetic' };
    const props = await render({ filters: draft });

    const form = element<HTMLFormElement>(container, 'form');
    const period = element<HTMLSelectElement>(form, 'select');
    period.value = '7d';
    await act(async () => {
      period.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      element(form, 'input[type="search"]').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });

    expect(props.onApply).toHaveBeenNthCalledWith(1, {
      ...draft,
      period: '7d',
    });
    expect(props.onApply).toHaveBeenNthCalledWith(2, draft);
  });

  it('retries from the failure alert', async () => {
    const props = await render({ errorMessage: 'synthetic failure' });

    await act(async () => {
      element<HTMLButtonElement>(container, '[role="alert"] button').click();
    });

    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });
});
