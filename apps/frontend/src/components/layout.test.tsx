import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell";
import { NavBar } from "./nav-bar";
import { PageHeader } from "./page-header";
import { StatusMessagePage } from "./status-message-page";

// 레이아웃형 공용 컴포넌트 4종(AppShell/NavBar/PageHeader/StatusMessagePage)이
// 실제로 import·렌더 가능함을 증명하는 최소 스모크 테스트.
describe("layout components", () => {
  it("renders AppShell with header/body/footer slots", () => {
    const html = renderToStaticMarkup(
      <AppShell header={<span>헤더</span>} footer={<span>푸터</span>}>
        <p>본문</p>
      </AppShell>,
    );

    expect(html).toContain("헤더");
    expect(html).toContain("본문");
    expect(html).toContain("푸터");
  });

  it("renders NavBar from an injected nav-config, without a role prop", () => {
    const html = renderToStaticMarkup(
      <NavBar
        brand={<span>OSS Hub</span>}
        items={[
          { label: "홈", href: "/" },
          { label: "프로그램", href: "/programs" },
        ]}
        actions={<span>로그인</span>}
      />,
    );

    expect(html).toContain("OSS Hub");
    expect(html).toContain("홈");
    expect(html).toContain("프로그램");
    expect(html).toContain("로그인");
  });

  it("renders PageHeader with title/description/actions", () => {
    const html = renderToStaticMarkup(
      <PageHeader
        title="프로그램 목록"
        description="현재 모집 중인 프로그램입니다."
        actions={<button type="button">새 프로그램</button>}
      />,
    );

    expect(html).toContain("프로그램 목록");
    expect(html).toContain("현재 모집 중인 프로그램입니다.");
    expect(html).toContain("새 프로그램");
  });

  it("renders StatusMessagePage with title/description/action", () => {
    const html = renderToStaticMarkup(
      <StatusMessagePage
        title="승인 대기 중입니다"
        description="스태프 승인 후 이용할 수 있습니다."
        action={<button type="button">새로고침</button>}
      />,
    );

    expect(html).toContain("승인 대기 중입니다");
    expect(html).toContain("스태프 승인 후 이용할 수 있습니다.");
    expect(html).toContain("새로고침");
  });
});

// header/footer가 선택(optional)인 grid 레이아웃에서, DOM 순서 기반 auto-placement에
// 의존하지 않고 각 슬롯이 명시적 row-start로 고정 트랙에 배치되는지 회귀 방지.
describe("AppShell grid row placement with optional header/footer", () => {
  it("keeps body on row-start-2 when header is omitted", () => {
    const html = renderToStaticMarkup(
      <AppShell footer={<span>푸터</span>}>
        <p>본문</p>
      </AppShell>,
    );

    expect(html).not.toContain('data-slot="app-shell-header"');
    expect(html).toMatch(/data-slot="app-shell-body"[^>]*class="[^"]*\brow-start-2\b/);
    expect(html).toMatch(/data-slot="app-shell-footer"[^>]*class="[^"]*\brow-start-3\b/);
  });

  it("keeps body on row-start-2 when footer is omitted", () => {
    const html = renderToStaticMarkup(
      <AppShell header={<span>헤더</span>}>
        <p>본문</p>
      </AppShell>,
    );

    expect(html).toMatch(/data-slot="app-shell-header"[^>]*class="[^"]*\brow-start-1\b/);
    expect(html).toMatch(/data-slot="app-shell-body"[^>]*class="[^"]*\brow-start-2\b/);
    expect(html).not.toContain('data-slot="app-shell-footer"');
  });

  it("keeps body on row-start-2 when both header and footer are omitted", () => {
    const html = renderToStaticMarkup(
      <AppShell>
        <p>본문</p>
      </AppShell>,
    );

    expect(html).not.toContain('data-slot="app-shell-header"');
    expect(html).toMatch(/data-slot="app-shell-body"[^>]*class="[^"]*\brow-start-2\b/);
    expect(html).not.toContain('data-slot="app-shell-footer"');
  });
});

describe("StatusMessagePage grid row placement with optional header/footer", () => {
  it("keeps body on row-start-2 when header is omitted", () => {
    const html = renderToStaticMarkup(
      <StatusMessagePage title="제목" footer={<span>푸터</span>} />,
    );

    expect(html).not.toContain('data-slot="status-message-page-header"');
    expect(html).toMatch(
      /data-slot="status-message-page-body"[^>]*class="[^"]*\brow-start-2\b/,
    );
    expect(html).toMatch(
      /data-slot="status-message-page-footer"[^>]*class="[^"]*\brow-start-3\b/,
    );
  });

  it("keeps body on row-start-2 when footer is omitted", () => {
    const html = renderToStaticMarkup(
      <StatusMessagePage title="제목" header={<span>헤더</span>} />,
    );

    expect(html).toMatch(
      /data-slot="status-message-page-header"[^>]*class="[^"]*\brow-start-1\b/,
    );
    expect(html).toMatch(
      /data-slot="status-message-page-body"[^>]*class="[^"]*\brow-start-2\b/,
    );
    expect(html).not.toContain('data-slot="status-message-page-footer"');
  });

  it("keeps body on row-start-2 when both header and footer are omitted", () => {
    const html = renderToStaticMarkup(<StatusMessagePage title="제목" />);

    expect(html).not.toContain('data-slot="status-message-page-header"');
    expect(html).toMatch(
      /data-slot="status-message-page-body"[^>]*class="[^"]*\brow-start-2\b/,
    );
    expect(html).not.toContain('data-slot="status-message-page-footer"');
  });
});
