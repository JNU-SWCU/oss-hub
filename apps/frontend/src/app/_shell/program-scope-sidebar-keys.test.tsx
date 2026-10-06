import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgramScopeSidebar } from './program-scope-sidebar';
import { programScopeSidebarGroups } from './sidebar-menu';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe('ProgramScopeSidebar key', () => {
  let container: HTMLElement;
  let root: Root;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();

    errorSpy.mockRestore();
  });

  it('학생 뷰에서 중복 key 경고가 나지 않는다', () => {
    const groups = programScopeSidebarGroups({
      programId: 'program-1',
      viewerRole: 'STUDENT',
      teamCount: 3,
      boardPostCount: 2,
      viewerDocuments: { completed: 1, total: 9 },
      milestoneDocuments: [
        { milestoneId: 'm1', title: '계획서', completed: 1, total: 3 },
        { milestoneId: 'm2', title: '중간 보고', completed: 0, total: 3 },
        { milestoneId: 'm3', title: '최종', completed: 0, total: 3 },
      ],
    });

    act(() => {
      root.render(
        <ProgramScopeSidebar
          groups={groups}
          programName="합성 프로그램"
          pathname="/programs/program-1/documents"
          search=""
          collapsed={false}
          onToggle={() => undefined}
          backHref="/programs"
        />,
      );
    });

    const duplicateKeyWarnings = errorSpy.mock.calls.filter((call) =>
      String(call[0] ?? '').includes('same key'),
    );
    expect(duplicateKeyWarnings).toEqual([]);
  });
});
