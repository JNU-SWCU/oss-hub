// RowActions 프리뷰 — apps/frontend/src/components/row-actions.tsx는 드롭다운
// 메뉴가 아니라 우측 정렬 flex 슬롯이다(children으로 버튼을 받을 뿐, 메뉴를
// 스스로 열고 닫지 않는다). 그래서 "메뉴 열림" 상태 자체가 존재하지 않는다 —
// 대신 staff-requests-view.tsx가 신청 상태별로 슬롯 내용을 바꿔 끼우는 두 경우를 옮긴다.
import { Button, RowActions } from 'frontend';

// PENDING 상태 행의 액션 — 승인/반려 버튼 조합.
export function PendingActions() {
  return (
    <RowActions>
      <Button size="sm">승인</Button>
      <Button size="sm" variant="destructive">
        반려
      </Button>
    </RowActions>
  );
}

// APPROVED 상태 행의 액션 — 회수 버튼 하나만 남는다.
export function RevokeAction() {
  return (
    <RowActions>
      <Button size="sm" variant="destructive">
        회수
      </Button>
    </RowActions>
  );
}
