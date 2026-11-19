import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../test-support/render-with-query';
import { PaginationNav } from './pagination-nav';

let mounted: Awaited<ReturnType<typeof renderWithQuery>> | undefined;
afterEach(async () => {
  await mounted?.unmount();
});

async function render(page: number, totalPages: number, isLoading = false) {
  const onPageChange = vi.fn();
  mounted = await renderWithQuery(
    <PaginationNav
      page={page}
      totalPages={totalPages}
      onPageChange={onPageChange}
      ariaLabel="Results pagination"
      isLoading={isLoading}
    />,
  );
  const nav = document.querySelector('nav[aria-label="Results pagination"]');
  const [previous, next] = nav?.querySelectorAll('button') ?? [];
  return { nav, previous, next, onPageChange };
}

it.each([0, 1])(
  'hides the first page when there are %d pages',
  async (totalPages) => {
    expect((await render(1, totalPages)).nav).toBeNull();
  },
);

it('keeps the recovery control visible when the current page is out of range', async () => {
  const { previous, next, onPageChange } = await render(2, 1);
  expect(previous?.disabled).toBe(false);
  expect(next?.disabled).toBe(true);
  await act(async () => previous?.click());
  expect(onPageChange).toHaveBeenCalledExactlyOnceWith(1);
});

it('disables both controls while a page is loading', async () => {
  const { previous, next } = await render(2, 3, true);
  expect(previous?.disabled).toBe(true);
  expect(next?.disabled).toBe(true);
});

it('requests the adjacent page in either direction', async () => {
  const { previous, next, onPageChange } = await render(2, 3);
  await act(async () => {
    previous?.click();
    next?.click();
  });
  expect(onPageChange.mock.calls).toEqual([[1], [3]]);
});
