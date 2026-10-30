import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LandingJourney } from './components/landing-journey';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe('server supplied landing props', () => {
  it('renders program labels and statistics when passed from the server', () => {
    const programs = [{ name: 'Server program', href: '/programs/p1' }];
    const stats = { items: [{ key: 'programs', value: '12' }], note: null };

    const html = renderToStaticMarkup(
      <LandingJourney
        primaryAction={null}
        starPrograms={programs}
        stats={stats}
      />,
    );

    expect(html).toContain('data-cosmos-poster');
    expect(html).toContain('>Server program</text>');
    expect(html).toContain('>12</div>');
  });
  it('omits the statistics row when the server supplies no statistics', () => {
    const stats = { items: [], note: null };

    const html = renderToStaticMarkup(
      <LandingJourney primaryAction={null} starPrograms={[]} stats={stats} />,
    );

    expect(html).not.toContain('<ul');
  });
});
