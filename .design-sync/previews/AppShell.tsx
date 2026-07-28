// AppShell 프리뷰 — apps/frontend/src/components/layout.test.tsx의 3슬롯(header/body/
// footer) 스모크 조합을, 이 repo의 실제 화면 조각(app/layout.tsx의 NavBar 배선 +
// program-list-page.tsx / student-dashboard-view.tsx의 본문)으로 채운 것. AppShell은
// 아직 실제 라우트에 직접 붙어 있지 않은 레이아웃 뼈대이므로, 빈 본문으로 남기지 않고
// 이 repo에서 실제로 쓰이는 화면 콘텐츠를 그대로 조합해 넣는다.
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

// app/layout.tsx의 NAV_ITEMS(홈/프로그램/아카이브) + program-list-page.tsx의
// 프로그램 목록 본문 + 간단한 푸터. header/body/footer 세 슬롯을 모두 채운 기본형.
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

// footer 없이 header + body만(레이아웃.test.tsx의 optional-footer 회귀 케이스) —
// student-dashboard-view.tsx의 대시보드 카드 본문으로 채운다.
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

// 텍스트 과다 케이스 — 긴 한글 공고 제목 + 하단 안내 문구가 줄바꿈될 때를 본다.
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
