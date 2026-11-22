import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditLogRecordKey } from './audit-log-fold';
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
    fetchedAt: new Date('2026-11-17T06:00:00.000Z'),
    foldLogins: true,
    selectedId: null,
    onFilterChange: vi.fn(),
    onApply: vi.fn(),
    onCancel: vi.fn(),
    onCategoryChange: vi.fn(),
    onViewChange: vi.fn(),
    onPageChange: vi.fn(),
    onRetry: vi.fn(),
    onSelect: vi.fn(),
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

  it('reports the pressed record and hides its GitHub login in the row', async () => {
    const props = await render({ records: [change] });

    const row = element<HTMLButtonElement>(container, 'li > button');
    expect(row.textContent).not.toContain('synthetic-admin');
    await act(async () => row.click());

    expect(props.onSelect).toHaveBeenCalledWith(auditLogRecordKey(change));
  });

  it('shows the selected record in a detail panel that searches its actor and closes', async () => {
    const props = await render({
      records: [change],
      selectedId: auditLogRecordKey(change),
    });

    const panel = element(container, 'aside');
    const [close, actor] = Array.from(panel.querySelectorAll('button'));
    expect(element(container, 'li > button').getAttribute('aria-pressed')).toBe(
      'true',
    );

    await act(async () => actor.click());
    await act(async () => close.click());

    expect(props.onSearchPerson).toHaveBeenCalledWith('synthetic-admin');
    expect(props.onSelect).toHaveBeenCalledWith(null);
  });

  it.each(['feed', 'table'] as const)(
    'opens the details for either record with the same ID in %s view',
    async (view) => {
      const records = RUN.map((record) => ({ ...record, id: 'same-login' }));
      const props = { ...baseProps(), records, view };

      function SelectableView() {
        const [selectedId, onSelect] = useState<string | null>(null);
        return (
          <AuditLogView
            {...props}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        );
      }

      await act(async () => root.render(<SelectableView />));
      if (view === 'feed') {
        const toggle = element<HTMLButtonElement>(container, '[aria-expanded]');
        await act(async () => toggle.click());
      }
      const buttons = Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          view === 'table' ? 'tbody button' : 'li > button[aria-pressed]',
        ),
      );
      expect(buttons).toHaveLength(2);

      for (const [index, record] of records.entries()) {
        await act(async () => buttons[index].click());
        expect(timestamps(element(container, 'aside'))).toEqual([
          record.occurredAt,
        ]);
        expect(
          buttons.map((button) => button.getAttribute('aria-pressed')),
        ).toEqual(records.map((_, row) => String(row === index)));
      }
    },
  );

  it('renders five columns and one row per record in table view', async () => {
    await render({ view: 'table' });

    expect(container.querySelectorAll('thead th')).toHaveLength(5);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(
      fixture.items.length,
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
