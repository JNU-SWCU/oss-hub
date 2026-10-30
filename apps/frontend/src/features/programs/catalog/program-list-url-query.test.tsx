import { act } from 'react';
import { notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../../../test-support/render-with-query';
import { ProgramListPage } from './program-list-page';
import { listPrograms } from './api';

const navigation = vi.hoisted(() => ({
  search: '',
  push: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
  usePathname: () => '/programs',
  useRouter: () => ({ push: navigation.push, replace: navigation.replace }),
}));
vi.mock('./api', () => ({
  listPrograms: vi.fn(),
  getProgramEndedYears: vi.fn().mockResolvedValue([]),
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: {
    readonly href: string;
    readonly children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));
let rendered: Awaited<ReturnType<typeof renderWithQuery>> | undefined;
const screen = <ProgramListPage viewerRole={null} canCreateProgram={false} />;

beforeEach(() => {
  navigation.search = '';
  vi.clearAllMocks();
  notifyManager.setScheduler(queueMicrotask);
  vi.mocked(listPrograms).mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 20,
    totalItems: 60,
    totalPages: 3,
  });
});
afterEach(async () => {
  if (rendered) await rendered.unmount();
  rendered = undefined;
  vi.useRealTimers();
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
});

describe('program list URL query', () => {
  it('debounces typing into one replacement and one final query', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    navigation.search = 'page=3';
    rendered = await renderWithQuery(screen);
    const input = rendered.container.querySelector<HTMLInputElement>(
      'input[aria-label="프로그램명 검색"]',
    );
    if (!input) throw new Error('Missing search');
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    );
    for (const value of ['x', 'xy', 'xyz']) {
      await act(async () => {
        descriptor?.set?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    expect(navigation.replace).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(navigation.replace).toHaveBeenCalledExactlyOnceWith(
      '/programs?search=xyz',
    );
    expect(listPrograms).toHaveBeenCalledTimes(1);
    navigation.search = 'search=xyz';
    await rendered.rerender(
      <ProgramListPage viewerRole={null} canCreateProgram={false} />,
    );
    expect(listPrograms).toHaveBeenCalledTimes(2);
    expect(listPrograms).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'xyz', page: 1 }),
    );
    navigation.replace.mockClear();
    navigation.search = 'page=3';
    await rendered.rerender(
      <ProgramListPage viewerRole={null} canCreateProgram={false} />,
    );
    expect(input.value).toBe('');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('a status change pushes a single reset-page URL and sends no stale-page request', async () => {
    navigation.search = 'search=x&page=3';
    rendered = await renderWithQuery(screen);
    const chip = [
      ...rendered.container.querySelectorAll(
        '[data-slot="program-list-status-chips"] button',
      ),
    ].find((button) => button.textContent === '모집중');
    if (!(chip instanceof HTMLButtonElement)) throw new Error('Missing status');
    await act(async () => chip.click());
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith(
      '/programs?status=recruiting&search=x',
    );
    navigation.search = 'status=recruiting&search=x';
    vi.mocked(listPrograms).mockClear();
    await rendered.rerender(
      <ProgramListPage viewerRole={null} canCreateProgram={false} />,
    );
    expect(listPrograms).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ page: 1, search: 'x', status: 'recruiting' }),
    );
  });

  it('restores page and search on the first request without a stale reset request', async () => {
    navigation.search = 'search=restored&page=3&sort=name';
    rendered = await renderWithQuery(screen);
    expect(listPrograms).toHaveBeenCalledTimes(1);
    expect(listPrograms).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'restored', page: 3, sort: 'name' }),
    );
  });

  it('sort replaces the address and resets the page while retaining search', async () => {
    navigation.search = 'search=restored&page=3';
    rendered = await renderWithQuery(screen);
    const select = rendered.container.querySelector<HTMLSelectElement>(
      'select[aria-label="프로그램 정렬 기준"]',
    );
    if (!select) throw new Error('Missing sort');
    await act(async () => {
      select.value = 'name';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(navigation.replace).toHaveBeenCalledWith(
      '/programs?sort=name&search=restored',
    );
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it('uses only the restored key when browser navigation changes page', async () => {
    navigation.search = 'search=first&page=3';
    rendered = await renderWithQuery(screen);
    vi.mocked(listPrograms).mockClear();
    navigation.search = 'search=second&page=2';
    await rendered.rerender(
      <ProgramListPage viewerRole={null} canCreateProgram={false} />,
    );
    expect(listPrograms).toHaveBeenCalledTimes(1);
    expect(listPrograms).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'second', page: 2 }),
    );
  });
});
