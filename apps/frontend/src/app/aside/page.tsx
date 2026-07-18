import type { Metadata } from "next"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  FormSection,
  AppShell,
  NavBar,
  type NavItem,
  PageHeader,
  StatusMessagePage,
  DataTable,
  type DataTableColumn,
  RowActions,
  DetailPanelLayout,
  CardGrid,
  ProgramCard,
  StatusBadge,
  EmptyState,
} from "@/components"

// 시각 확인 전용 미리보기 페이지 — B-6 공통 컴포넌트를 섹션별로 모아 렌더한다.
// API 호출·role 분기 없음. 모든 데이터는 아래 인라인 상수의 명백한 샘플 값이다.

export const metadata: Metadata = {
  title: "B-6 공통 컴포넌트 미리보기",
  description: "AppShell·DataTable·CardGrid 등 B-6 공통 컴포넌트 시각 확인용 페이지",
  robots: { index: false, follow: false },
}

const NAV_ITEMS: NavItem[] = [
  { label: "홈", href: "/aside" },
  { label: "프로그램", href: "/aside#data-table" },
  { label: "팀", href: "/aside#detail-panel-layout" },
]

interface Applicant {
  id: string
  name: string
  team: string
  status: string
}

const APPLICANTS: Applicant[] = [
  { id: "1", name: "홍길동", team: "알파팀", status: "대기" },
  { id: "2", name: "김철수", team: "베타팀", status: "승인" },
  { id: "3", name: "이영희", team: "감마팀", status: "반려" },
]

const APPLICANT_COLUMNS: DataTableColumn<Applicant>[] = [
  { id: "name", header: "이름", cell: (row) => row.name },
  { id: "team", header: "팀", cell: (row) => row.team },
  { id: "status", header: "상태", cell: (row) => row.status },
  {
    id: "actions",
    header: "액션",
    headClassName: "text-right",
    cellClassName: "text-right",
    cell: () => (
      <RowActions>
        <Button size="sm" variant="outline">
          승인
        </Button>
        <Button size="sm" variant="ghost">
          반려
        </Button>
      </RowActions>
    ),
  },
]

function PreviewSection({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}) {
  return (
    <section id={id} className="flex flex-col gap-4 border-b border-border pb-10">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  )
}

// AppShell/StatusMessagePage는 전체 화면(h-dvh/min-h-dvh) 뼈대라 미리보기 페이지
// 안에서는 고정 높이 프레임에 넣어 축소 표시한다. className은 cn()으로 병합돼
// 프레임 안에서만 h-dvh/min-h-dvh가 h-full로 대체된다.
function FixedFrame({ children }: { children: ReactNode }) {
  return (
    <div className="h-[420px] w-full overflow-hidden rounded-lg border border-border">
      {children}
    </div>
  )
}

export default function AsidePreviewPage() {
  return (
    <main className={cn("mx-auto flex max-w-5xl flex-col gap-10 px-6 py-10")}>
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">B-6 공통 컴포넌트 미리보기</h1>
        <p className="text-sm text-muted-foreground">
          시각 확인 전용 페이지입니다. API를 호출하지 않고 페이지 안의 샘플 데이터만 사용합니다.
        </p>
      </div>

      <PreviewSection id="app-shell" title="AppShell / NavBar">
        <FixedFrame>
          <AppShell
            className="h-full"
            header={
              <NavBar
                brand={<span>OSS Hub</span>}
                items={NAV_ITEMS}
                actions={<Button size="sm">로그인</Button>}
              />
            }
          >
            <div className="p-4 text-sm text-muted-foreground">
              AppShell 본문(main) 영역 — 실제 화면에서는 라우트별 콘텐츠가 여기 렌더됩니다.
            </div>
          </AppShell>
        </FixedFrame>
      </PreviewSection>

      <PreviewSection id="page-header" title="PageHeader">
        <PageHeader
          title="프로그램 목록"
          description="현재 모집 중인 프로그램입니다."
          actions={<Button size="sm">새 프로그램</Button>}
        />
      </PreviewSection>

      <PreviewSection id="form-section" title="FormSection">
        <FormSection
          title="기본 정보"
          description="프로그램 신청에 필요한 기본 정보를 입력하세요."
        >
          <Field>
            <FieldLabel htmlFor="program-name">프로그램 이름</FieldLabel>
            <Input id="program-name" placeholder="예: OSS Hub 데모데이" />
          </Field>
          <Field>
            <FieldLabel htmlFor="program-capacity">모집 인원</FieldLabel>
            <Input id="program-capacity" placeholder="예: 5" />
          </Field>
        </FormSection>
      </PreviewSection>

      <PreviewSection id="data-table" title="DataTable">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">기본 상태</h3>
            <DataTable
              columns={APPLICANT_COLUMNS}
              data={APPLICANTS}
              rowKey={(row) => row.id}
            />
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">로딩 상태</h3>
            <DataTable
              columns={APPLICANT_COLUMNS}
              data={APPLICANTS}
              rowKey={(row) => row.id}
              isLoading
            />
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">빈 상태</h3>
            <DataTable columns={APPLICANT_COLUMNS} data={[]} rowKey={(row) => row.id} />
          </div>
        </div>
      </PreviewSection>

      <PreviewSection id="row-actions" title="RowActions">
        <RowActions>
          <Button size="sm" variant="outline">
            승인
          </Button>
          <Button size="sm" variant="ghost">
            반려
          </Button>
        </RowActions>
      </PreviewSection>

      <PreviewSection id="detail-panel-layout" title="DetailPanelLayout">
        <DetailPanelLayout
          primary={
            <div className="rounded-lg border border-border p-4 text-sm">
              <p className="font-medium">신청 상세</p>
              <p className="mt-2 text-muted-foreground">
                본문(주요 콘텐츠) 슬롯 예시입니다.
              </p>
            </div>
          }
          secondary={
            <div className="rounded-lg border border-border p-4 text-sm">
              <p className="font-medium">보조 정보</p>
              <p className="mt-2 text-muted-foreground">
                사이드바(보조 콘텐츠) 슬롯 예시입니다.
              </p>
            </div>
          }
        />
      </PreviewSection>

      <PreviewSection id="cards" title="CardGrid / ProgramCard / StatusBadge">
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
          <ProgramCard
            title="오픈소스 스터디"
            category="스터디"
            period="상시 모집"
            status={<StatusBadge variant="pending">심사중</StatusBadge>}
          />
          <ProgramCard
            title="졸업 프로젝트 지원"
            category="지원 프로그램"
            period="2026.02 - 2026.12"
            status={<StatusBadge variant="approved">승인</StatusBadge>}
          />
          <ProgramCard
            title="교내 세미나 발표"
            category="세미나"
            period="2026.04"
            status={<StatusBadge variant="rejected">반려</StatusBadge>}
          />
        </CardGrid>
      </PreviewSection>

      <PreviewSection id="empty-state" title="EmptyState">
        <EmptyState
          title="진행 중인 프로그램이 없습니다"
          description="새 프로그램이 열리면 여기에 표시됩니다."
          action={
            <Button size="sm" variant="outline">
              전체 보기
            </Button>
          }
        />
      </PreviewSection>

      <PreviewSection id="status-message-page" title="StatusMessagePage">
        <FixedFrame>
          <StatusMessagePage
            className="h-full min-h-0"
            title="승인 대기 중입니다"
            description="스태프 승인 후 이용할 수 있습니다."
            action={<Button size="sm">새로고침</Button>}
          />
        </FixedFrame>
      </PreviewSection>
    </main>
  )
}
