import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ClosingCtaSection } from './components/closing-cta-section';
import { LandingFooter } from './components/landing-footer';
import { LandingHero } from './components/landing-hero';
import { ProgramFlowSection } from './components/program-flow-section';
import { ProgramTypeSection } from './components/program-type-section';
import { RolePathSection } from './components/role-path-section';

// 랜딩 페이지 주요 섹션 6개(히어로/프로그램 유형/프로그램 흐름/역할별 경로/
// 하단 CTA/푸터)가 실제로 render 가능함을 증명하는 최소 스모크 테스트.
describe('landing page sections', () => {
  it('renders the hero section with the GitHub login CTA', () => {
    const html = renderToStaticMarkup(
      <LandingHero primaryAction={<a href="/login">GitHub으로 로그인</a>} />,
    );

    expect(html).toContain('별처럼 이어지는 곳');
    expect(html).toContain('JNU OSS PLATFORM');
    expect(html).toContain('GitHub으로 로그인');
    expect(html).toContain('href="/login"');
  });

  it('renders the hero auth error alert when a message is passed', () => {
    const html = renderToStaticMarkup(
      <LandingHero
        authErrorMessage="로그인 요청을 완료하지 못했습니다. 다시 시도해 주세요."
        primaryAction={<span>GitHub 로그인 다시 시도</span>}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('로그인 요청을 완료하지 못했습니다');
  });

  it('renders the hero auth error alert with hero danger color, not the light-surface destructive variant', () => {
    const html = renderToStaticMarkup(
      <LandingHero
        authErrorMessage="로그인 요청을 완료하지 못했습니다. 다시 시도해 주세요."
        primaryAction={<span>GitHub 로그인 다시 시도</span>}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('text-hero-danger');
    expect(html).not.toContain('text-destructive');
  });

  it('renders the program type section with all program cards', () => {
    const html = renderToStaticMarkup(<ProgramTypeSection />);

    expect(html).toContain('함께 열 수 있는 프로그램 유형');
    expect(html).toContain('경진대회');
    expect(html).toContain('해커톤');
  });

  it('renders the program flow section with the step-by-step flow', () => {
    const html = renderToStaticMarkup(<ProgramFlowSection />);

    expect(html).toContain('신청부터 공개까지, 하나의 흐름');
    expect(html).toContain('STEP 1');
    expect(html).toContain('공개 아카이브');
  });

  it('renders the role path section for both student and staff columns', () => {
    const html = renderToStaticMarkup(<RolePathSection />);

    expect(html).toContain('학생');
    expect(html).toContain('교직원');
    expect(html).toContain('관심 있는 프로그램을 둘러보고 지원해요');
    expect(html).toContain('교직원 계정은 관리자 승인 후 사용할 수 있어요.');
  });

  it('renders the closing CTA section with the GitHub login link', () => {
    const html = renderToStaticMarkup(
      <ClosingCtaSection action={<a href="/login">GitHub으로 로그인</a>} />,
    );

    expect(html).toContain('지금 GitHub 계정으로 시작하세요');
    expect(html).toContain('href="/login"');
  });

  it('renders the footer with copyright and policy links', () => {
    const html = renderToStaticMarkup(<LandingFooter />);

    expect(html).toContain('전남대학교 SW중심대학사업단');
    expect(html).toContain('href="/consent"');
  });
});
