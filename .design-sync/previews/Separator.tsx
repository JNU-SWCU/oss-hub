import { Separator } from 'frontend';

export function Horizontal() {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm">신청자 정보</span>
      <Separator />
      <span className="text-sm">팀 구성원 정보</span>
    </div>
  );
}

export function Vertical() {
  return (
    <div className="flex h-5 items-center gap-3">
      <span className="text-sm">상세 보기</span>
      <Separator orientation="vertical" />
      <span className="text-sm">신청 취소</span>
    </div>
  );
}

export function WithLabelOverlay() {
  return (
    <div className="relative -my-2 h-5 text-sm">
      <Separator className="absolute inset-0 top-1/2" />
      <span className="relative mx-auto block w-fit bg-background px-2 text-muted-foreground">
        또는
      </span>
    </div>
  );
}

export function NonDecorative() {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm">기본 정보</span>
      <Separator decorative={false} />
      <span className="text-sm">알림 수신 설정</span>
    </div>
  );
}
