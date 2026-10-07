import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const POLICIES_DIR = path.resolve(__dirname, '../../../public/policies');
const STYLESHEET_HREF = '/policies/policy-document.css';

const DOCUMENTS = [
  'privacy/2026-07-21.html',
  'github-activity/2026-07-21.html',
  'org-repository-terms/2026-07-21.html',

  'privacy/2026-08-04.html',
  'github-activity/2026-08-04.html',
  'org-repository-terms/2026-08-04.html',

  'privacy/2026-08-11.html',
  'github-activity/2026-08-11.html',
  'org-repository-terms/2026-08-11.html',
];

const stylesheet = readFileSync(
  path.join(POLICIES_DIR, 'policy-document.css'),
  'utf-8',
);

describe('약관 전문 문서 스타일', () => {
  it.each(DOCUMENTS)('%s는 공용 스타일을 link로 참조한다', (file) => {
    const html = readFileSync(path.join(POLICIES_DIR, file), 'utf-8');

    expect(html).toContain(`href="${STYLESHEET_HREF}"`);

    expect(html).not.toContain('<style');
    expect(html).not.toMatch(/\sstyle="/);
  });

  it('바탕은 불투명한 어두운 면이다', () => {
    expect(stylesheet).toContain('--policy-surface: #000d29');
    expect(stylesheet).toMatch(
      /html\s*\{[^}]*background:\s*var\(--policy-surface\)/,
    );
    expect(stylesheet).not.toMatch(/background:\s*(transparent|none)/);
  });
});
