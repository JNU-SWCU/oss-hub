import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClosingCtaSection } from "./components/closing-cta-section";
import { LandingHero } from "./components/landing-hero";
import { ProgramTypeSection } from "./components/program-type-section";
import { RolePathSection } from "./components/role-path-section";

// 랜딩 페이지 주요 섹션 4개(히어로/프로그램 유형/역할별 경로/하단 CTA)가
// 실제로 render 가능함을 증명하는 최소 스모크 테스트.
describe("landing page sections", () => {
  it("renders the hero section with the GitHub login CTA", () => {
    const html = renderToStaticMarkup(<LandingHero />);

    expect(html).toContain("오픈소스 프로그램을 한 곳에서");
    expect(html).toContain("GitHub으로 로그인");
    expect(html).toContain("/api/v1/auth/github");
  });

  it("renders the hero auth error alert when a message is passed", () => {
    const html = renderToStaticMarkup(
      <LandingHero authErrorMessage="로그인 요청을 완료하지 못했습니다. 다시 시도해 주세요." />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("로그인 요청을 완료하지 못했습니다");
  });

  it("renders the program type section with all program cards", () => {
    const html = renderToStaticMarkup(<ProgramTypeSection />);

    expect(html).toContain("함께 열 수 있는 프로그램 유형");
    expect(html).toContain("경진대회");
    expect(html).toContain("해커톤");
  });

  it("renders the role path section for both student and staff columns", () => {
    const html = renderToStaticMarkup(<RolePathSection />);

    expect(html).toContain("학생");
    expect(html).toContain("교직원");
  });

  it("renders the closing CTA section with the GitHub login link", () => {
    const html = renderToStaticMarkup(<ClosingCtaSection />);

    expect(html).toContain("지금 GitHub 계정으로 시작하세요");
    expect(html).toContain("/api/v1/auth/github");
  });
});
