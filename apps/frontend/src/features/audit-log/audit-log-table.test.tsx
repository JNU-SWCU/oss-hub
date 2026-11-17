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
});
