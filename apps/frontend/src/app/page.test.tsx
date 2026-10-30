import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_MEMBER_ACCESS } from './_shell/member-access';
import { loadLandingData } from '@/features/landing/server/load-landing-data';
import HomePage from './page';

vi.mock('@/features/landing/server/load-landing-data', () => ({
  loadLandingData: vi.fn(),
}));
vi.mock('./_shell/use-session-role', () => ({
  useSessionRole: () => ({
    ...EMPTY_MEMBER_ACCESS,
    status: 'anonymous',
    isProfileComplete: false,
    retry: vi.fn(),
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe('server landing page', () => {
  it('includes recruiting links and poster labels when the loader returns programs', async () => {
    vi.mocked(loadLandingData).mockResolvedValue({
      recruiting: [
        {
          id: 'recruiting:program',
          name: 'Recruiting fixture',
          organizer: 'Public fixture',
          trackType: null,
          applicationEndAt: '2026-11-01T00:00:00.000Z',
        },
      ],
      starPrograms: [{ name: 'Constellation fixture', href: '/programs/p' }],
      stats: { items: [{ key: 'Count fixture', value: '17' }], note: null },
    });

    const html = renderToStaticMarkup(await HomePage());

    expect(html).toContain('href="/programs/recruiting%3Aprogram"');
    expect(html).toContain('>Constellation fixture</text>');
    expect(html).toContain('>Recruiting fixture</h3>');
    expect(html).toContain('>17</div>');
  });
});
