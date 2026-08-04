import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionRole = vi.hoisted<{
  current: {
    status: string;
    role: string | null;
  };
}>(() => ({
  current: {
    status: 'loading',
    role: null,
  },
}));

vi.mock('../_shell/use-session-role', () => ({
  useSessionRole: () => sessionRole.current,
}));

vi.mock('@/features/programs/program-list-page', () => ({
  ProgramListPage: ({ includeViewer }: { readonly includeViewer: boolean }) => (
    <div data-include-viewer={String(includeViewer)}>프로그램 목록</div>
  ),
}));

import ProgramsPage from './page';

describe('ProgramsPage', () => {
  beforeEach(() => {
    sessionRole.current = { status: 'loading', role: null };
  });

  it('세션이 확정되기 전에는 공개 프로그램 목록 요청 컴포넌트를 렌더링하지 않는다', () => {
    // Given / When
    const html = renderToStaticMarkup(<ProgramsPage />);

    // Then
    expect(html).toContain('프로그램 목록을 불러오는 중');
    expect(html).not.toContain('data-include-viewer');
  });

  it('학생 세션이 확정되면 viewer 목록만 렌더링한다', () => {
    // Given
    sessionRole.current = { status: 'assigned', role: 'STUDENT' };

    // When
    const html = renderToStaticMarkup(<ProgramsPage />);

    // Then
    expect(html).toContain('data-include-viewer="true"');
  });
});
