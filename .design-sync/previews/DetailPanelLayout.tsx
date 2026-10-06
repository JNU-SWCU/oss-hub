import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailPanelLayout,
  PageHeader,
} from 'frontend';

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

export function RoleMenu() {
  return (
    <DetailPanelLayout
      className="gap-0 md:grid-cols-[220px_minmax(0,1fr)] md:items-stretch"
      primaryClassName="border-b border-border p-4 md:border-b-0 md:border-r md:p-6"
      secondaryClassName="min-w-0 p-6"
      primary={
        <nav aria-label="역할 메뉴" className="flex flex-col gap-1">
          <a
            href="/dashboard"
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
