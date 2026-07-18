import { test, expect } from "@playwright/test"

// /aside 미리보기 페이지 스모크 — 각 섹션 헤딩과 대표 컴포넌트가 보이는지만 확인한다.
// API 호출 없는 정적 페이지라 백엔드 기동은 필요 없다.
test("/aside — B-6 공통 컴포넌트 섹션이 모두 렌더된다", async ({ page }) => {
  await page.goto("/aside")

  await expect(
    page.getByRole("heading", { level: 1, name: "B-6 공통 컴포넌트 미리보기" })
  ).toBeVisible()

  const sections: Array<{ heading: string; check: () => Promise<void> }> = [
    {
      heading: "AppShell / NavBar",
      check: async () => {
        await expect(page.getByText("OSS Hub")).toBeVisible()
        await expect(page.getByRole("link", { name: "프로그램" })).toBeVisible()
      },
    },
    {
      heading: "PageHeader",
      check: async () => {
        await expect(page.getByRole("heading", { name: "프로그램 목록" })).toBeVisible()
      },
    },
    {
      heading: "FormSection",
      check: async () => {
        await expect(page.getByLabel("프로그램 이름")).toBeVisible()
      },
    },
    {
      heading: "DataTable",
      check: async () => {
        await expect(page.getByText("홍길동")).toBeVisible()
        await expect(page.getByText("불러오는 중…")).toBeVisible()
        await expect(page.getByText("표시할 데이터가 없습니다.")).toBeVisible()
      },
    },
    {
      heading: "RowActions",
      check: async () => {
        await expect(
          page.locator("#row-actions").getByRole("button", { name: "승인" })
        ).toBeVisible()
      },
    },
    {
      heading: "DetailPanelLayout",
      check: async () => {
        await expect(page.getByText("신청 상세")).toBeVisible()
        await expect(page.getByText("보조 정보")).toBeVisible()
      },
    },
    {
      heading: "CardGrid / ProgramCard / StatusBadge",
      check: async () => {
        await expect(page.getByText("캡스톤 디자인 경진대회")).toBeVisible()
        for (const variant of [
          "recruiting",
          "closed",
          "pending",
          "approved",
          "rejected",
        ]) {
          await expect(
            page.locator(`[data-slot="status-badge"][data-variant="${variant}"]`)
          ).toBeVisible()
        }
      },
    },
    {
      heading: "EmptyState",
      check: async () => {
        await expect(page.getByText("진행 중인 프로그램이 없습니다")).toBeVisible()
      },
    },
    {
      heading: "StatusMessagePage",
      check: async () => {
        await expect(page.getByText("승인 대기 중입니다")).toBeVisible()
      },
    },
  ]

  for (const section of sections) {
    await expect(
      page.getByRole("heading", { level: 2, name: section.heading })
    ).toBeVisible()
    await section.check()
  }
})
