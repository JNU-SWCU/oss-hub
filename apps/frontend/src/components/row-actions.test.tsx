import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RowActions } from "./row-actions";

describe("RowActions", () => {
  it("renders slotted button children", () => {
    const html = renderToStaticMarkup(
      <RowActions>
        <button type="button">승인</button>
        <button type="button">반려</button>
      </RowActions>,
    );

    expect(html).toContain("승인");
    expect(html).toContain("반려");
  });
});
