// Separator 프리뷰 — 이 repo에서 Separator의 유일한 실사용처는
// apps/frontend/src/components/ui/field.tsx의 FieldSeparator다(다른 화면에서
// 단독 구분선으로 쓰인 곳이 없다). orientation 축 전개는 .d.ts 기반으로 구성하고,
// 라벨 오버레이 케이스는 FieldSeparator의 실제 렌더 구조(absolute + span)를 그대로 옮긴다.
import { Separator } from 'frontend';

// FieldSet 안에서 필드 블록을 나누는 기본 가로 구분선.
export function Horizontal() {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm">신청자 정보</span>
      <Separator />
      <span className="text-sm">팀 구성원 정보</span>
    </div>
  );
}

// 툴바형 액션 사이의 세로 구분선.
export function Vertical() {
  return (
    <div className="flex h-5 items-center gap-3">
      <span className="text-sm">상세 보기</span>
      <Separator orientation="vertical" />
      <span className="text-sm">신청 취소</span>
    </div>
  );
}

// FieldSeparator(ui/field.tsx)의 실제 렌더 구조 — absolute 라인 위에 라벨을 올린다.
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

// decorative=false — 순수 장식이 아니라 의미 있는 구획일 때의 접근성 케이스.
export function NonDecorative() {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm">기본 정보</span>
      <Separator decorative={false} />
      <span className="text-sm">알림 수신 설정</span>
    </div>
  );
}
