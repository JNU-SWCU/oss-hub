// DetailPanelLayout 프리뷰 — [RENDER_THIN]으로 플래그됨: 실제 자식 없이는 그리드
// 뼈대만 보이는 빈 카드가 된다. 조합은 archive-detail-view.tsx의 상세 화면
// (DetailContent)과 role-panel-shell.tsx의 좌측 역할 메뉴 재구성을 그대로 옮긴 것 —
// 모든 export가 primary/secondary에 실제 콘텐츠를 채운다.
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailPanelLayout,
  PageHeader,
} from 'frontend';

// archive-detail-view.tsx DetailContent — 프로젝트 정보/기여자 카드(primary) +
// 활동 요약 카드(secondary), 위에 PageHeader를 얹은 실제 상세 화면 조합.
export function Default() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <PageHeader
        title="캡스톤 디자인 경진대회 · 학생 팀 프로젝트"
        description="캡스톤/산학 · 최종 발표 완료"
        actions={<Button variant="outline">GitHub 열기</Button>}
      />
      <DetailPanelLayout
        primary={
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>프로젝트 정보</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 text-sm">
                <div className="grid gap-1">
                  <span className="text-muted-foreground">저장소</span>
                  <code className="break-all">
                    JNU-SWCU/oss-hub-capstone-2026
                  </code>
                </div>
                <div className="grid gap-1">
                  <span className="text-muted-foreground">공개일</span>
                  <time>2026.06.20</time>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>기여자</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-3 text-sm">
                  <li>gh-student-a</li>
                  <li>gh-student-b</li>
                  <li>gh-student-c</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        }
        secondary={
          <Card>
            <CardHeader>
              <CardTitle>활동 요약</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-1">
                <span className="text-sm text-muted-foreground">
                  승인된 마일스톤 제출
                </span>
                <strong className="text-2xl">6</strong>
              </div>
              <p className="text-sm text-muted-foreground">
                활동량 안내: 평가·점수·랭킹이 아닙니다
              </p>
            </CardContent>
          </Card>
        }
      />
    </div>
  );
}

// role-panel-shell.tsx — 좁은 메뉴(primary, 220px 고정 폭) + 넓은 본문(secondary).
// 실사용은 next/link의 Link를 쓰지만, 이 프리뷰는 라우터 밖에서 렌더되므로 순수
// <a>로 옮긴다(NavBar의 nav-config 원칙과 동일하게 라우팅은 호출부 책임).
export function RoleMenu() {
  return (
    <DetailPanelLayout
      className="gap-0 md:grid-cols-[220px_minmax(0,1fr)] md:items-stretch"
      primaryClassName="border-b border-border p-4 md:border-b-0 md:border-r md:p-6"
      secondaryClassName="min-w-0 p-6"
      primary={
        <nav aria-label="역할 메뉴" className="flex flex-col gap-1">
          <a
            href="/staff/dashboard"
            className="rounded-md bg-muted px-3 py-2 text-sm font-medium text-foreground"
          >
            운영 대시보드
          </a>
          <a
            href="/staff/programs/new"
            className="rounded-md px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
          >
            프로그램 등록
          </a>
        </nav>
      }
      secondary={
        <div className="grid gap-4">
          <h2 className="font-heading text-xl font-semibold">운영 대시보드</h2>
          <p className="text-sm text-muted-foreground">
            현재 모집 중인 프로그램과 검토 대기 신청서를 확인하세요.
          </p>
        </div>
      }
    />
  );
}

// 텍스트 과다 케이스 — 상세 본문에 긴 한글 설명이 들어갈 때 줄바꿈을 확인한다.
export function LongDescription() {
  return (
    <DetailPanelLayout
      primary={
        <Card>
          <CardHeader>
            <CardTitle>프로그램 소개</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-muted-foreground">
              2026학년도 2학기 소프트웨어중심대학 오픈소스 커뮤니티 기여
              프로그램은 학생이 실제 오픈소스 저장소에 기여하며 협업 경험을
              쌓도록 설계된 학점 연계 프로그램입니다. 참가자는 매주 수요일 오후
              6시 정기 모임에 참여하고, 격주로 마일스톤 제출물을 제출해야 하며,
              최종 발표에서 기여 내역과 배운 점을 공유합니다.
            </p>
          </CardContent>
        </Card>
      }
      secondary={
        <Card>
          <CardHeader>
            <CardTitle>참가 요건</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              소프트웨어중심대학 재학생, GitHub 계정 보유자
            </p>
          </CardContent>
        </Card>
      }
    />
  );
}
