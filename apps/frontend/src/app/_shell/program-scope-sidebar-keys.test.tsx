// @vitest-environment happy-dom

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

/**
 * 프로그램 스코프 사이드바가 중복 key 로 렌더되지 않는지 검사한다.
 *
 * 과거에는 여러 마일스톤 자식이 같은 제출 화면을 가리켜 `key={item.href}`에서 중복
 * 경고가 났다(QA21). 이제 자식 href에 milestoneId가 있지만, 제목 중복과 향후 URL
 * 변경에도 안정적인 현재 key 계약을 클라이언트 렌더로 계속 검증한다.
 *
 * ⚠ 이 검사는 **클라이언트 렌더**여야 한다. `renderToStaticMarkup` 은 key 검증을 하지
 * 않아 SSR 문자열 테스트로는 이 경고가 절대 안 잡힌다 — 이 결함이 살아남은 이유이기도
 * 하다(이 영역 테스트가 전부 SSR 문자열이다).
 */
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
    // spy 해제는 afterEach 로 한다 — 본문 끝에 두면 단언이 실패했을 때 해제가
    // 실행되지 않아 spy 가 뒤따르는 모든 테스트로 샌다.
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
