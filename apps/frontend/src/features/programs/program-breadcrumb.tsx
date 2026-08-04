/**
 * 프로그램 상세 본문 상단 브레드크럼 — program-detail.md §1 그대로 텍스트만,
 * 클릭 불가(다른 화면 브레드크럼과 달리 버튼이 아니다). 항상 "프로그램"으로 시작하고,
 * 프로그램명이 이어지며, 하위 화면(예: 참여 팀)에서만 `section`이 세 번째 조각으로 붙는다.
 */
export interface ProgramBreadcrumbProps {
  readonly programName: string;
  /** 프로그램 개요 화면 자체에는 없음 — 하위 화면(예: "참여 팀")에서만 채운다. */
  readonly section?: string;
}

export function ProgramBreadcrumb({
  programName,
  section,
}: ProgramBreadcrumbProps) {
  const text = section
    ? `프로그램 › ${programName} › ${section}`
    : `프로그램 › ${programName}`;

  return (
    <p data-slot="program-breadcrumb" className="text-xs text-muted-foreground">
      {text}
    </p>
  );
}
