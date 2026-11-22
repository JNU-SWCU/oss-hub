import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditEvents, auditLogRecordKey } from './audit-log-fold';
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

  async function render(selectedId: string | null, rows = records) {
    const onSelect = vi.fn();
    await act(async () =>
      root.render(
        <AuditLogTable
          events={auditEvents(rows)}
          now={NOW}
          selectedId={selectedId}
          onSelect={onSelect}
        />,
      ),
    );
    return onSelect;
  }

  function actionButtons(): HTMLButtonElement[] {
    return Array.from(container.querySelectorAll('tbody button'));
  }

  it('keeps the server order and reports the record whose action is pressed', async () => {
    const onSelect = await render(null);

    expect(
      Array.from(container.querySelectorAll('tbody time'), (time) =>
        time.getAttribute('datetime'),
      ),
    ).toEqual(records.map((record) => record.occurredAt));

    await act(async () => actionButtons()[1].click());

    expect(onSelect).toHaveBeenCalledWith(auditLogRecordKey(records[1]));
  });

  it('marks the selected record and clears it when pressed again', async () => {
    const onSelect = await render(auditLogRecordKey(records[0]));

    expect(
      actionButtons().map((button) => button.getAttribute('aria-pressed')),
    ).toEqual(records.map((_, index) => String(index === 0)));

    await act(async () => actionButtons()[0].click());

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('selects a record from a click anywhere on its row', async () => {
    const onSelect = await render(null);
    const cell = container.querySelector('tbody tr:nth-child(3) td');
    if (cell === null) throw new Error('missing third row');

    await act(async () => {
      cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSelect).toHaveBeenCalledWith(auditLogRecordKey(records[2]));
  });

  it('preserves each same-ID row when server order changes', async () => {
    const first = records[0];
    const second = { ...records[1], id: first.id };
    await render(null, [first, second]);
    const [firstButton, secondButton] = actionButtons();

    await render(null, [second, first]);

    expect(actionButtons()[0]).toBe(secondButton);
    expect(actionButtons()[1]).toBe(firstButton);
  });
});
