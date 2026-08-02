import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SkipLink } from './skip-link';

describe('SkipLink', () => {
  it('moves keyboard users to the shared main-content target', () => {
    const html = renderToStaticMarkup(<SkipLink />);

    expect(html).toContain('href="#main-content"');
    expect(html).toContain('본문으로 건너뛰기');
    expect(html).toContain('focus:not-sr-only');
  });
});
