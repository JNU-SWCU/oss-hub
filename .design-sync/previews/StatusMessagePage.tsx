// StatusMessagePage 프리뷰 — role-request-screen.tsx(RoleRequestStatusView, 상태별
// 아이콘·배지)와 role-selection-screen.tsx(action 슬롯에 전체 폼을 넣는 실제 사용법)를
// 그대로 옮긴 것.
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  StatusBadge,
  StatusMessagePage,
} from 'frontend';

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
      className="size-8"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// role-request-screen.tsx PENDING 상태 — icon + title + description + action(배지·버튼).
export function PendingApproval() {
  return (
    <StatusMessagePage
      icon={<ClockIcon />}
      title="교직원 승인을 기다리고 있습니다"
      description="승인이 완료되면 교직원 프로그램 관리 기능을 사용할 수 있습니다."
      action={
        <div className="flex w-full max-w-md flex-col items-center gap-3">
          <StatusBadge variant="pending">승인 대기</StatusBadge>
          <Button type="button" variant="outline">
            상태 새로고침
          </Button>
        </div>
      }
    />
  );
}

// role-selection-screen.tsx — action 슬롯에 전체 폼(역할 카드 선택)을 넣는 실제 사용법.
export function RoleSelection() {
  return (
    <StatusMessagePage
      title="역할을 선택해 주세요"
      description="선택한 역할에 맞는 화면과 기능을 안내합니다."
      action={
        <fieldset className="grid w-full max-w-2xl gap-3 sm:grid-cols-2">
          <legend className="sr-only">사용할 역할</legend>
          <label className="cursor-pointer rounded-xl outline-none focus-within:ring-3 focus-within:ring-ring/50">
            <input
              className="peer sr-only"
              type="radio"
              name="role"
              value="STUDENT"
              defaultChecked
            />
            <Card className="h-full transition-colors peer-checked:ring-2 peer-checked:ring-primary hover:bg-muted/40">
              <CardHeader>
                <CardTitle>학생</CardTitle>
                <CardDescription>
                  프로그램을 찾아보고 개인 또는 팀으로 지원합니다.
                </CardDescription>
              </CardHeader>
            </Card>
          </label>
          <label className="cursor-pointer rounded-xl outline-none focus-within:ring-3 focus-within:ring-ring/50">
            <input
              className="peer sr-only"
              type="radio"
              name="role"
              value="STAFF"
            />
            <Card className="h-full transition-colors peer-checked:ring-2 peer-checked:ring-primary hover:bg-muted/40">
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
          </label>
        </fieldset>
      }
    />
  );
}

// 텍스트 과다 케이스 — 중앙 정렬 설명이 길어질 때 줄바꿈과 액션 카드 폭을 본다.
export function LoadFailed() {
  return (
    <StatusMessagePage
      title="승인 상태를 불러오지 못했습니다"
      description="네트워크 연결을 확인한 뒤 다시 시도해 주세요. 문제가 반복되면 소프트웨어중심대학 행정실 또는 담당 조교에게 문의해 화면 캡처와 함께 접수해 주시기 바랍니다."
      action={
        <Alert variant="destructive" className="max-w-md text-left">
          <AlertTitle>요청을 처리하지 못했습니다</AlertTitle>
          <AlertDescription>일시적인 서버 오류일 수 있습니다.</AlertDescription>
        </Alert>
      }
    />
  );
}
