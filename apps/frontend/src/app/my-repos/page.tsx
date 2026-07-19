import { RolePanelShell } from '../_shell/role-panel-shell';
import { STUDENT_MENU } from '../_shell/role-menus';
import { TicketStub } from '../_shell/ticket-stub';

// #122 "내 저장소"(URL: /my-repos) — 접근: 로그인 사용자(역할 제한 없음).
// #136이 학생 패널에 배치하므로 좌측 메뉴는 학생 메뉴를 쓰되, 게이트는
// #122 본문의 실제 접근 규칙(전 역할 허용)을 그대로 따른다.
export default function MyReposPage() {
  return (
    <RolePanelShell menu={STUDENT_MENU} allow={['STUDENT', 'STAFF', 'ADMIN']}>
      <TicketStub ticketNumber={122} title="내 저장소" />
    </RolePanelShell>
  );
}
