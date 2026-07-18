import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DetailPanelLayout } from "./detail-panel-layout";

describe("DetailPanelLayout", () => {
  it("renders both the primary and secondary slots", () => {
    const html = renderToStaticMarkup(
      <DetailPanelLayout
        primary={<article>프로그램 상세 본문</article>}
        secondary={<aside>활동그래프 패널</aside>}
      />,
    );

    expect(html).toContain("프로그램 상세 본문");
    expect(html).toContain("활동그래프 패널");
  });
});
