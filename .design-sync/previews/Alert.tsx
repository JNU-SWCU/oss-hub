import { Alert, AlertDescription, AlertTitle, Button } from 'frontend';

export function Default() {
  return (
    <Alert>
      <AlertTitle>승인 후 교직원 기능을 사용할 수 있습니다</AlertTitle>
      <AlertDescription>
        요청을 제출하면 승인 상태를 확인할 수 있는 화면으로 이동합니다.
      </AlertDescription>
    </Alert>
  );
}

export function Destructive() {
  return (
    <Alert variant="destructive">
      <AlertTitle>역할을 저장하지 못했습니다</AlertTitle>
      <AlertDescription>잠시 후 다시 시도해 주세요.</AlertDescription>
    </Alert>
  );
}

export function WithRetryAction() {
  return (
    <Alert variant="destructive">
      <AlertDescription className="flex items-center justify-between gap-3">
        <span>사용자 목록을 불러오지 못했습니다.</span>
        <Button size="sm" variant="outline">
          다시 시도
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export function NoTitle() {
  return (
    <Alert>
      <AlertDescription>
        교직원 역할 요청을 승인했습니다. 대상자에게 알림이 전송됩니다.
      </AlertDescription>
    </Alert>
  );
}

export function LongText() {
  return (
    <Alert variant="destructive">
      <AlertTitle>신청 처리 중 오류가 발생했습니다</AlertTitle>
      <AlertDescription>
        일시적인 서버 오류로 신청 승인 처리를 완료하지 못했습니다. 네트워크
        상태를 확인한 뒤 다시 시도해 주세요. 문제가 반복되면 관리자 콘솔의 감사
        로그에서 처리 이력을 확인하고 담당 관리자에게 문의해 주세요.
      </AlertDescription>
    </Alert>
  );
}
