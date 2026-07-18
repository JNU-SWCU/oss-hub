import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CardGrid } from "./card-grid";
import { ProgramCard } from "./program-card";
import { StatusBadge } from "./status-badge";
import { EmptyState } from "./empty-state";

// B-6 카드형 공통 컴포넌트 4종(CardGrid/ProgramCard/StatusBadge/EmptyState)이
// 실제로 import·렌더 가능함을 증명하는 최소 스모크 테스트.
describe("card components", () => {
  it("renders CardGrid with repeated ProgramCard + StatusBadge children", () => {
    const html = renderToStaticMarkup(
      <CardGrid>
        <ProgramCard
          title="캡스톤 디자인 경진대회"
          category="캡스톤/산학"
          period="2026.03 - 2026.06"
          status={<StatusBadge variant="recruiting">모집중</StatusBadge>}
        />
        <ProgramCard
          title="SW 해커톤"
          category="경진대회/해커톤"
          period="2026.05"
          status={<StatusBadge variant="closed">마감</StatusBadge>}
        />
      </CardGrid>,
    );

    expect(html).toContain("card-grid");
    expect(html).toContain("캡스톤 디자인 경진대회");
    expect(html).toContain("모집중");
    expect(html).toContain("마감");
  });

  it("renders all StatusBadge variants without throwing", () => {
    const html = renderToStaticMarkup(
      <>
        <StatusBadge variant="recruiting">모집중</StatusBadge>
        <StatusBadge variant="closed">마감</StatusBadge>
        <StatusBadge variant="pending">대기</StatusBadge>
        <StatusBadge variant="approved">승인</StatusBadge>
        <StatusBadge variant="rejected">반려</StatusBadge>
      </>,
    );

    expect(html).toContain("대기");
    expect(html).toContain("승인");
    expect(html).toContain("반려");
  });

  it("renders EmptyState with icon, description, and action slot", () => {
    const html = renderToStaticMarkup(
      <EmptyState
        icon={<span data-testid="icon">□</span>}
        title="진행 중인 프로그램이 없습니다"
        description="새 프로그램이 열리면 여기에 표시됩니다."
        action={<button type="button">전체 보기</button>}
      />,
    );

    expect(html).toContain("진행 중인 프로그램이 없습니다");
    expect(html).toContain("새 프로그램이 열리면 여기에 표시됩니다.");
    expect(html).toContain("전체 보기");
  });
});
