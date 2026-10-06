import { Button, EmptyState } from 'frontend';

function UsersIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
      className="size-8"
    >
      <path
        d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="9" cy="7" r="4" />
      <path
        d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function NoResults() {
  return (
    <EmptyState
      title="조건에 맞는 프로그램이 없습니다"
      description="검색어나 모집 상태를 바꿔 다시 찾아보세요."
    />
  );
}

export function NotFound() {
  return (
    <EmptyState
      icon={<UsersIcon />}
      title="공개 프로젝트를 찾을 수 없습니다"
      description="비공개 처리되었거나 존재하지 않는 프로젝트입니다."
      action={<Button variant="outline">목록으로 돌아가기</Button>}
    />
  );
}

export function TicketStub() {
  return (
    <EmptyState
      title="마감 임박 알림"
      description="이 화면은 #142에서 구현됩니다."
      action={
        <a
          href="https://github.com/JNU-SWCU/oss-hub/issues/142"
          className="text-sm font-medium text-primary underline underline-offset-4"
        >
          #142 티켓 보기
        </a>
      }
    />
  );
}

export function LongDescription() {
  return (
    <EmptyState
      title="등록된 프로그램이 없습니다"
      description="새 프로그램이 등록되면 이곳에서 확인할 수 있습니다. 프로그램 등록 권한이 있는 교직원 계정으로 로그인한 경우 아래 버튼으로 새 프로그램을 바로 만들 수 있습니다."
      action={<Button>프로그램 만들기</Button>}
    />
  );
}
