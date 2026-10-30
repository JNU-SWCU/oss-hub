import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useSessionRole: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: mocks.usePathname,
}));
vi.mock('./use-session-role', () => ({
  useSessionRole: mocks.useSessionRole,
}));

import { AppFrame } from './app-frame';

describe('정책 문서 전용 표면', () => {
  it.each(['privacy', 'github-activity', 'org-repository-terms'])(
    '%s는 세션 조회와 앱 셸 없이 렌더한다',
    (document) => {
      mocks.usePathname.mockReturnValue(`/policies/${document}`);
      mocks.useSessionRole.mockClear();

      const html = renderToStaticMarkup(
        <AppFrame brand="OSS Hub">
          <main />
        </AppFrame>,
      );

      expect(html).toBe('<main></main>');
      expect(mocks.useSessionRole).not.toHaveBeenCalled();
    },
  );
});
