import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PrivacyPage from './privacy/page';
import GithubActivityPage from './github-activity/page';
import OrgRepositoryTermsPage from './org-repository-terms/page';
import PolicyLayout, { dynamic } from './layout';

const POLICIES_DIR = __dirname;

const DOCUMENTS = [
  ['privacy', PrivacyPage, 4],
  ['github-activity', GithubActivityPage, 6],
  ['org-repository-terms', OrgRepositoryTermsPage, 4],
] as const;

const stylesheet = readFileSync(
  path.join(POLICIES_DIR, 'policy-document.css'),
  'utf-8',
);

describe('약관 전문 문서 스타일', () => {
  it.each(DOCUMENTS)(
    '%s는 현재 문서와 공용 스타일을 렌더한다',
    (_, Page, sections) => {
      const document = createElement(Page);

      const html = renderToStaticMarkup(
        createElement(PolicyLayout, { children: document }),
      );

      expect(html.match(/<main class="policy-document">/g)).toHaveLength(1);
      expect(html.match(/<h1>/g)).toHaveLength(1);
      expect(html.match(/<h2>/g)).toHaveLength(sections);
      expect(html).toContain('정책 버전: 2026-11-01');
      expect(html).not.toContain('<style');
      expect(html).not.toMatch(/\sstyle="/);
    },
  );

  it('정책 문서는 요청별 세션 없이 정적으로 생성한다', () => {
    expect(dynamic).toBe('force-static');
  });

  it('문서 사이 링크는 현재 문서 주소를 가리킨다', () => {
    const privacy = renderToStaticMarkup(createElement(PrivacyPage));
    const activity = renderToStaticMarkup(createElement(GithubActivityPage));

    expect(privacy).toContain('href="/policies/github-activity"');
    expect(activity).toContain('href="/policies/privacy"');
  });

  it('바탕은 불투명한 어두운 면이다', () => {
    expect(stylesheet).toMatch(/--policy-surface:\s*#[\da-f]{6};/i);
    expect(stylesheet).toMatch(
      /html:has\(\.policy-document\)\s*\{[^}]*background:\s*var\(--policy-surface\)/,
    );
    expect(stylesheet).not.toMatch(/background:\s*(transparent|none)/);
  });
});
