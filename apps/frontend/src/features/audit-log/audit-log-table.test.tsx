import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditEvents } from './audit-log-fold';
import { AuditLogTable } from './audit-log-table';
import { AUDIT_LOG_PAGE_RESPONSE_FIXTURE } from './fixtures';
import { parseAuditLogPage } from './parser';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const records = parseAuditLogPage(AUDIT_LOG_PAGE_RESPONSE_FIXTURE).items;
const NOW = new Date('2026-11-17T06:00:00.000Z');

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

  async function render(rows = records) {
    const onSearchPerson = vi.fn();
    await act(async () =>
      root.render(
        <AuditLogTable
          events={auditEvents(rows)}
          now={NOW}
          onSearchPerson={onSearchPerson}
        />,
      ),
    );
    return onSearchPerson;
  }

  function rows(): HTMLTableRowElement[] {
    return Array.from(container.querySelectorAll('tbody tr'));
  }

  it('keeps the server order', async () => {
    await render();

    expect(
      Array.from(container.querySelectorAll('tbody time'), (time) =>
        time.getAttribute('datetime'),
      ),
    ).toEqual(records.map((record) => record.occurredAt));
  });

  it('searches the actor of a row', async () => {
    const onSearchPerson = await render();
    const index = records.findIndex((record) => record.actor?.login);
    const login = records[index].actor?.login;

    await act(async () =>
      rows()
        [index].querySelector<HTMLButtonElement>(
          'button[aria-label$="기록 검색"]',
        )
        ?.click(),
    );

    expect(onSearchPerson).toHaveBeenCalledWith(login);
  });

  it('preserves each same-ID row when server order changes', async () => {
    const first = records[0];
    const second = { ...records[1], id: first.id };
    await render([first, second]);
    const [firstRow, secondRow] = rows();

    await render([second, first]);

    expect(rows()[0]).toBe(secondRow);
    expect(rows()[1]).toBe(firstRow);
  });
});
