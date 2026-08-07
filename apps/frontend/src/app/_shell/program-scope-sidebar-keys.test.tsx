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
 * 학생 뷰의 「내 제출물」은 부모와 마일스톤 자식들이 **전부 같은 `/mydocs`** 를 가리킨다
 * (교직원 뷰만 `?milestoneId=` 로 갈린다). 그런데 렌더가 `key={item.href}` 를 쓰고 있어
 * React 가 "Encountered two children with the same key" 를 냈다 — 항목이 빠지거나
 * 중복될 수 있다는 경고다(QA21). 프로그램 상세·지원·게시판·내 문서 등 이 사이드바가
 * 붙는 화면 전부에서 났다.
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
      // 마일스톤 자식 셋 — 학생 뷰에서는 셋 다 부모와 같은 `/mydocs` 를 가리킨다.
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
          pathname="/programs/program-1/mydocs"
          collapsed={false}
          onToggle={() => undefined}
        />,
      );
    });

    const duplicateKeyWarnings = errorSpy.mock.calls.filter((call) =>
      String(call[0] ?? '').includes('same key'),
    );
    expect(duplicateKeyWarnings).toEqual([]);
  });
});
