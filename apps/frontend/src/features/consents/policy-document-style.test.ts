// 약관 전문은 `sandbox=""` iframe 안의 별도 문서라 앱의 CSS를 물려받지 못한다.
// 스타일을 각 문서에 인라인으로 박으면 사업단이 본문을 갈아 끼울 때 함께 지워지므로,
// 세 문서가 공용 스타일 하나를 `<link>`로 참조하는 형태를 여기서 못 박는다(#517).
// vitest 설정이 `environment: 'node'`라 CSS를 평가하지 않으므로 파일을 글자로 읽어 본다.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const POLICIES_DIR = path.resolve(__dirname, '../../../public/policies');
const STYLESHEET_HREF = '/policies/policy-document.css';

const DOCUMENTS = [
  'privacy/2026-07-21.html',
  'github-activity/2026-07-21.html',
  'org-repository-terms/2026-07-21.html',
  // 2026-08-04: GitHub 활동 수집 범위 확장(#99 후속)에 맞춰 세 문서 모두 같은 버전으로
  // 재게시했다 — CONSENT_POLICY_VERSION이 세 항목 공용이라 하나만 있으면 나머지 두
  // 문서의 "전문 보기"가 404가 된다. privacy·org-repository-terms는 내용 변경 없이
  // 버전 표기 줄만 갱신했다.
  'privacy/2026-08-04.html',
  'github-activity/2026-08-04.html',
  'org-repository-terms/2026-08-04.html',
  // 2026-08-11: 공개 랭킹 노출 범위·대상 확정(가입자 전원·org 저장소 전체 가시성 무관
  // 집계)에 맞춰 세 문서 모두 같은 버전으로 재게시했다. org-repository-terms는 내용
  // 변경 없이 버전 표기 줄만 갱신했다.
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
    // 인라인 style 태그·속성이 생기면 공용 파일의 값이 조용히 덮인다.
    expect(html).not.toContain('<style');
    expect(html).not.toMatch(/\sstyle="/);
  });

  // 투명하게 두면 뒤의 별밭이 글자 사이로 비쳐, 검정 기준 10:1이던 본문이 별빛 픽셀
  // 위에서 1:1 대까지 떨어진다. 면은 반드시 불투명해야 한다.
  it('바탕은 불투명한 어두운 면이다', () => {
    expect(stylesheet).toContain('--policy-surface: #000d29');
    expect(stylesheet).toMatch(
      /html\s*\{[^}]*background:\s*var\(--policy-surface\)/,
    );
    expect(stylesheet).not.toMatch(/background:\s*(transparent|none)/);
  });
});
