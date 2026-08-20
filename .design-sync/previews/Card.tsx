// Card 프리뷰 — 파트 조합 3종을 이 repo의 실제 화면에서 그대로 옮겼다.
// ProgramStatusCard는 student-dashboard-view.tsx의 참여 현황 카드(Header+Title+
// Action+Content+Footer 전부 사용), RoleCard는 role-selection-screen.tsx의
// 역할 선택 카드(size="sm"으로 축 스윕), PublishBlockedCard는
// repository-publish-card.tsx의 "공개 불가 사유" 카드(텍스트 과다 케이스)다.
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  StatusBadge,
} from 'frontend';

export function ProgramStatusCard() {
  return (
    <Card className="min-h-72">
      <CardHeader>
        <CardTitle className="pr-20 text-lg">캡스톤 디자인 경진대회</CardTitle>
        <p className="text-sm text-muted-foreground">팀 · 3인 1팀 프로젝트</p>
        <CardAction>
          <StatusBadge variant="pending">승인 대기</StatusBadge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-center">
        <div className="flex items-start gap-3 border-l-2 border-status-pending-fg/40 pl-4">
          <div>
            <p className="font-medium">신청 검토 후 일정이 열립니다.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              승인되면 다음 마일스톤 일정이 표시됩니다.
            </p>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline">
          신청 상세
        </Button>
      </CardFooter>
    </Card>
  );
}

// role-selection-screen.tsx: 아이콘 + 제목 + 설명 카드, size="sm"으로 Card의
// size 축을 스윕한다(default 대비 카드 내부 여백이 줄어든다). 폭은 원본 화면과
// 동일하게 grid sm:grid-cols-2로 잡는다 — w-64 같은 임의 폭 클래스는 이 repo
// 소스에 없어 정적 Tailwind 빌드에 포함되지 않는다(NOTES.md 참고).
export function RoleCard() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Card size="sm">
        <CardHeader>
          <CardTitle>학생</CardTitle>
          <CardDescription>
            프로그램을 찾아보고 개인 또는 팀으로 지원합니다.
          </CardDescription>
        </CardHeader>
      </Card>
      <Card size="sm">
        <CardHeader>
          <CardTitle>교직원</CardTitle>
          <CardDescription>
            프로그램을 만들고 지원자와 제출물을 관리합니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs font-medium text-status-pending-fg">
            관리자 승인이 필요합니다
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// repository-publish-card.tsx: 공개 불가 사유 목록이 CardContent를 채우는
// 텍스트 과다 케이스 — 설명·목록 길이로 카드 하단이 늘어나는 걸 확인한다.
export function PublishBlockedCard() {
  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="flex flex-wrap items-center gap-2">
          저장소 공개
          <StatusBadge variant="pending">PRIVATE</StatusBadge>
        </CardTitle>
        <CardDescription>
          저장과 별도로 GitHub 저장소를 공개 전환합니다. 모든 필수 마일스톤이
          승인되어야 공개 버튼이 활성화됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Button variant="outline" className="w-fit">
          비공개 저장소 확인
        </Button>
        <ul className="grid gap-1 text-sm text-muted-foreground">
          <li>2차 마일스톤 제출물이 아직 검토되지 않았습니다.</li>
          <li>3차 마일스톤(최종 발표 자료)이 제출되지 않았습니다.</li>
        </ul>
        <Button type="button" className="w-fit" disabled>
          GitHub 저장소 공개 전환
        </Button>
      </CardContent>
    </Card>
  );
}
