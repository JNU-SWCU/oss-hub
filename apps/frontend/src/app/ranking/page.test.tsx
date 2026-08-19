import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRoleResult } from '../_shell/use-session-role';

const sessionRole = vi.fn<() => SessionRoleResult>();

vi.mock('../_shell/use-session-role', () => ({
  useSessionRole: () => sessionRole(),
}));

vi.mock('@/features/ranking', () => ({
  RankingScreen: ({ viewerRole }: { viewerRole?: string | null }) => (
    <section data-testid="ranking-screen" data-viewer-role={viewerRole ?? ''}>
      실제 랭킹 화면
    </section>
  ),
}));

import RankingPage from './page';

const roleState = (
  overrides: Partial<SessionRoleResult> = {},
): SessionRoleResult => ({
  status: 'anonymous',
  role: null,
  roleRequestStatus: null,
  roleRequestRejectionReason: null,
  selectedRole: null,
  isProfileComplete: false,
  retry: () => undefined,
  ...overrides,
});

describe('RankingPage', () => {
  beforeEach(() => {
    sessionRole.mockReset();
  });

  it('로그인 없이 공개로 랭킹 화면을 렌더링한다', () => {
    sessionRole.mockReturnValue(roleState());

    const html = renderToStaticMarkup(<RankingPage />);

    expect(html).toContain('data-testid="ranking-screen"');
    expect(html).toContain('실제 랭킹 화면');
    // 비로그인에게는 역할이 없다 — 화면은 공개 열 구성으로 그린다.
    expect(html).toContain('data-viewer-role=""');
  });

  it('배정된 역할만 화면에 넘긴다 — 대기 중인 사람은 공개 구성이다', () => {
    sessionRole.mockReturnValue(
      roleState({ status: 'assigned', role: 'STAFF', isProfileComplete: true }),
    );
    expect(renderToStaticMarkup(<RankingPage />)).toContain(
      'data-viewer-role="STAFF"',
    );

    // 역할 요청이 아직 결재되지 않은 사람(`unassigned`)은 STAFF 가 아니다.
    sessionRole.mockReturnValue(
      roleState({ status: 'unassigned', role: null }),
    );
    expect(renderToStaticMarkup(<RankingPage />)).toContain(
      'data-viewer-role=""',
    );
  });
});
