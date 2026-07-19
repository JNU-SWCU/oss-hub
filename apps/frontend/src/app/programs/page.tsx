import { TicketStub } from '../_shell/ticket-stub';

// 공개 라우트 — 게이트 없음. #102 "공통: 프로그램 목록"(URL: /programs) 스텁.
export default function ProgramsPage() {
  return <TicketStub ticketNumber={102} title="프로그램 목록" />;
}
