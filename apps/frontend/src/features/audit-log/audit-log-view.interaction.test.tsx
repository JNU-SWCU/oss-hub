import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditLogView } from './audit-log-view';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('AuditLogView filter toggle', () => {
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

  it('opens and closes the collapsed filter form from the 필터 button', async () => {
    await act(async () => {
      root.render(
        <AuditLogView
          records={[]}
          counts={null}
          filters={{ q: '', action: '', from: '', to: '' }}
          activeFilterCount={1}
          category=""
          view="feed"
          page={1}
          limit={20}
          total={0}
          isLoading={false}
          errorMessage={null}
          now={new Date('2026-11-17T06:00:00.000Z')}
          onFilterChange={vi.fn()}
          onSearch={vi.fn()}
          onReset={vi.fn()}
          onCategoryChange={vi.fn()}
          onViewChange={vi.fn()}
          onPageChange={vi.fn()}
          onRetry={vi.fn()}
        />,
      );
    });
    const toggle = container.querySelector('[aria-controls="audit-filters"]');
    const form = container.querySelector('#audit-filters');
    if (!(toggle instanceof HTMLButtonElement) || form === null) {
      throw new Error('missing filter toggle or form');
    }
    expect(toggle.textContent).toBe('필터1');
    expect(form.classList.contains('hidden')).toBe(true);

    await act(async () => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(form.classList.contains('hidden')).toBe(false);

    await act(async () => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(form.classList.contains('hidden')).toBe(true);
  });
});
