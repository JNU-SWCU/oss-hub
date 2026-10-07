import {
  AppShell,
  Button,
  Card,
  CardContent,
  CardGrid,
  CardHeader,
  CardTitle,
  NavBar,
  PageHeader,
  ProgramCard,
  StatusBadge,
} from 'frontend';

export function Default() {
  return (
    <AppShell
      header={
        <NavBar
          brand="OSS Hub"
          items={[
            { label: '홈', href: '/' },
            { label: '프로그램', href: '/programs' },
            { label: '아카이브', href: '/archive' },
          ]}
          actions={<Button size="sm">로그인</Button>}
        />
      }
      footer={
        <div className="border-t border-border px-4 py-3 text-center text-xs text-muted-foreground">
          © 2026 전남대학교 소프트웨어중심대학
        </div>
      }
    >
      <section className="mx-auto grid w-full max-w-6xl gap-6 p-5 sm:p-8">
        <PageHeader
          title="프로그램"
          description="참여할 프로그램을 찾아보세요."
        />
        <CardGrid>
          <ProgramCard
            title="캡스톤 디자인 경진대회"
            category="캡스톤/산학"
            period="2026.03 - 2026.06"
            status={<StatusBadge variant="recruiting">모집중</StatusBadge>}
            footer={
              <Button variant="outline" size="sm">
                더 보기
              </Button>
            }
          />
          <ProgramCard
            title="오픈소스 컨트리뷰션 아카데미"
            category="교육/멘토링"
            period="2026.07 - 2026.08"
            status={<StatusBadge variant="pending">모집 예정</StatusBadge>}
            footer={
              <Button variant="outline" size="sm">
                더 보기
              </Button>
            }
          />
        </CardGrid>
      </section>
    </AppShell>
  );
}

export function WithoutFooter() {
  return (
    <AppShell
      header={
        <NavBar
          brand="OSS Hub"
          items={[
            { label: '내 대시보드', href: '/dashboard' },
            { label: '내 저장소', href: '/my-repos' },
          ]}
          actions={<StatusBadge variant="approved">학생</StatusBadge>}
        />
      }
    >
      <section className="mx-auto grid w-full max-w-6xl gap-6 p-5 sm:p-8">
        <PageHeader
          title="내 대시보드"
          description="참여 중인 프로그램과 다가오는 마일스톤을 확인하세요."
        />
        <CardGrid>
          <Card className="min-h-48">
            <CardHeader>
              <CardTitle className="text-lg">캡스톤 디자인 경진대회</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-medium">다음 마일스톤: 중간 발표</p>
              <p className="mt-1 text-sm text-muted-foreground">
                제출 마감 2026.09.15까지 3일 남았습니다.
              </p>
            </CardContent>
          </Card>
        </CardGrid>
      </section>
    </AppShell>
  );
}

export function LongNotice() {
  return (
    <AppShell
      header={<NavBar brand="OSS Hub" items={[{ label: '홈', href: '/' }]} />}
      footer={
        <div className="border-t border-border px-4 py-3 text-center text-xs text-muted-foreground">
          본 서비스는 전남대학교 소프트웨어중심대학 오픈소스 프로그램 운영을
          위한 교육용 플랫폼이며, 여기에 표시되는 활동량 수치는 평가·점수·랭킹
          목적이 아닌 참고 정보로만 제공됩니다.
        </div>
      }
    >
      <section className="mx-auto grid w-full max-w-3xl gap-4 p-5 sm:p-8">
        <PageHeader
          title="2026학년도 2학기 소프트웨어중심대학 오픈소스 커뮤니티 기여 프로그램 참가자 모집"
          description="교육/멘토링 · 오픈소스 기여 · 학점 연계 — 신청 기간: 2026.09.01 - 2026.12.19"
        />
      </section>
    </AppShell>
  );
}
