// CardGrid 프리뷰 — Card 파트 조합과는 다른 실제 그리드 화면 2개를 옮겼다.
// SystemStatusGrid는 system-status-view.tsx의 관리자 시스템 상태 요약(3장),
// ProgramDashboardGrid는 student-dashboard-view.tsx의 학생 대시보드 참여 현황
// 카드 그리드(3장, 상태별로 내용이 달라진다)다. 두 화면 다 lucide-react 아이콘을
// 쓰지만 이미 승인된 프리뷰(Button.tsx)가 아이콘 라이브러리 대신 인라인 svg를
// 쓰는 관례를 따라 여기서도 아이콘은 생략했다 — learnings에 기록.
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardGrid,
  CardHeader,
  CardTitle,
  StatusBadge,
} from 'frontend';

export function SystemStatusGrid() {
  return (
    <CardGrid>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            수집 상태
            <StatusBadge variant="approved">정상</StatusBadge>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          데이터 수집이 정상적으로 운영되고 있습니다.
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            현재 작업
            <StatusBadge variant="recruiting">수집 중</StatusBadge>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          현재 수집 작업의 실행 상태입니다.
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>데이터 최신성</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">마지막 완료</dt>
              <dd className="mt-1 font-medium">2026.07.28 03:00</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">데이터 기준 시각</dt>
              <dd className="mt-1 font-medium">2026.07.28 02:55</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </CardGrid>
  );
}

export function ProgramDashboardGrid() {
  return (
    <CardGrid>
      <Card className="min-h-72">
        <CardHeader>
          <CardTitle className="pr-20 text-lg">
            캡스톤 디자인 경진대회
          </CardTitle>
          <p className="text-sm text-muted-foreground">팀 · 3인 1팀 프로젝트</p>
          <CardAction>
            <StatusBadge variant="pending">승인 대기</StatusBadge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col justify-center">
          <p className="font-medium">신청 검토 후 일정이 열립니다.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            승인되면 다음 일정이 표시됩니다.
          </p>
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline">
            신청 상세
          </Button>
        </CardFooter>
      </Card>
      <Card className="min-h-72">
        <CardHeader>
          <CardTitle className="pr-20 text-lg">SW 해커톤</CardTitle>
          <p className="text-sm text-muted-foreground">개인 · 홍길동</p>
          <CardAction>
            <StatusBadge variant="approved">참여 중</StatusBadge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col justify-center">
          <p className="text-xs font-medium text-muted-foreground">
            다음 마일스톤
          </p>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-heading text-base font-semibold">중간 발표</p>
            <span className="font-heading text-lg font-bold text-primary">
              D-3
            </span>
          </div>
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline">
            프로그램 상세
          </Button>
          <Button size="sm">제출 체크리스트</Button>
        </CardFooter>
      </Card>
      <Card className="min-h-72">
        <CardHeader>
          <CardTitle className="pr-20 text-lg">교외 연합 해커톤</CardTitle>
          <p className="text-sm text-muted-foreground">개인 · 홍길동</p>
          <CardAction>
            <StatusBadge variant="rejected">신청 반려</StatusBadge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col justify-center">
          <p className="font-medium">신청이 반려되었습니다.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            프로그램 상세에서 신청 상태를 확인해 주세요.
          </p>
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline">
            신청 상세
          </Button>
        </CardFooter>
      </Card>
    </CardGrid>
  );
}
