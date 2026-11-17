import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuditLogTable } from './audit-log-table';
import { parseAuditLogPage } from './parser';
import { AUDIT_LOG_PAGE_RESPONSE_FIXTURE } from './fixtures';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const records = parseAuditLogPage(AUDIT_LOG_PAGE_RESPONSE_FIXTURE).items;

describe('AuditLogTable', () => {
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

  function actorColumn() {
    return Array.from(container.querySelectorAll('tbody tr')).map(
      (row) =>
        row.querySelectorAll('td')[1]?.querySelector(':scope > div > span')
          ?.textContent ?? '',
    );
  }

  function header(label: string) {
    const button = Array.from(container.querySelectorAll('th button')).find(
      (candidate) => candidate.textContent === label,
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`missing sort header ${label}`);
    }
    return button;
  }

  function rowIds() {
    return Array.from(container.querySelectorAll('tbody tr')).map((row) => {
      const occurredAt = row.querySelector('time')?.getAttribute('datetime');
      return records.find((record) => record.occurredAt === occurredAt)?.id;
    });
  }

  function sortControl() {
    const control = container.querySelector('[data-slot="audit-sort"]');
    const select = control?.querySelector('select');
    const direction = control?.querySelector('button');
    if (
      !(select instanceof HTMLSelectElement) ||
      !(direction instanceof HTMLButtonElement)
    ) {
      throw new Error('missing compact sort control');
    }
    return { select, direction };
  }

  async function chooseSort(key: string) {
    const { select } = sortControl();
    await act(async () => {
      select.value = key;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  it('sorts rows client-side by the chosen column and toggles direction', async () => {
    await act(async () => {
      root.render(<AuditLogTable records={records} />);
    });
    expect(actorColumn()[0]).toBe('김예시');

    await act(async () => header('행위자').click());
    expect(actorColumn()).toEqual([
      '김예시',
      '시스템',
      '알 수 없음@synthetic-nameless',
      '이예제',
      '최운영',
    ]);
    expect(header('행위자').closest('th')?.getAttribute('aria-sort')).toBe(
      'ascending',
    );

    await act(async () => header('행위자').click());
    expect(actorColumn()[0]).toBe('최운영');
    expect(header('행위자').closest('th')?.getAttribute('aria-sort')).toBe(
      'descending',
    );
  });

  it('sorts by each of the five columns from the compact sort control and shares its state with the headers', async () => {
    await act(async () => {
      root.render(<AuditLogTable records={records} />);
    });
    expect(
      Array.from(sortControl().select.options, (option) => option.value),
    ).toEqual(['occurredAt', 'actor', 'role', 'action', 'target']);
    expect(sortControl().select.value).toBe('occurredAt');

    await chooseSort('actor');
    expect(rowIds()).toEqual([
      'audit-role-change',
      'audit-system',
      'audit-unknown-actor',
      'audit-submission',
      'audit-application-approved',
    ]);

    await chooseSort('role');
    expect(rowIds()).toEqual([
      'audit-system',
      'audit-role-change',
      'audit-application-approved',
      'audit-unknown-actor',
      'audit-submission',
    ]);

    await chooseSort('action');
    expect(rowIds()).toEqual([
      'audit-system',
      'audit-unknown-actor',
      'audit-submission',
      'audit-application-approved',
      'audit-role-change',
    ]);

    await chooseSort('target');
    expect(rowIds()).toEqual([
      'audit-unknown-actor',
      'audit-role-change',
      'audit-system',
      'audit-submission',
      'audit-application-approved',
    ]);
    expect(header('대상').closest('th')?.getAttribute('aria-sort')).toBe(
      'ascending',
    );

    await act(async () => sortControl().direction.click());
    expect(rowIds()).toEqual([
      'audit-application-approved',
      'audit-submission',
      'audit-system',
      'audit-role-change',
      'audit-unknown-actor',
    ]);
    expect(header('대상').closest('th')?.getAttribute('aria-sort')).toBe(
      'descending',
    );

    await chooseSort('occurredAt');
    expect(rowIds()).toEqual([
      'audit-role-change',
      'audit-application-approved',
      'audit-submission',
      'audit-system',
      'audit-unknown-actor',
    ]);

    await act(async () => header('행위자').click());
    expect(sortControl().select.value).toBe('actor');
  });
});
