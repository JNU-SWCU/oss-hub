import { Button, NavBar, StatusBadge } from 'frontend';

export function Default() {
  return (
    <NavBar
      brand="OSS Hub"
      items={[
        { label: '홈', href: '/' },
        { label: '프로그램', href: '/programs' },
        { label: '아카이브', href: '/archive' },
      ]}
      actions={<Button size="sm">로그인</Button>}
    />
  );
}

export function ManyItems() {
  return (
    <NavBar
      brand="OSS Hub 관리 콘솔"
      items={[
        { label: '운영 대시보드', href: '/dashboard' },
        { label: '학생 활성', href: '/dashboard/insights' },
        { label: '가입 신청', href: '/dashboard/applicants' },
        { label: '사용자 목록', href: '/dashboard/users' },
        { label: '감사 로그', href: '/dashboard/audit-logs' },
        { label: '시스템 상태', href: '/dashboard/system-status' },
      ]}
      actions={<StatusBadge variant="approved">관리자</StatusBadge>}
    />
  );
}

export function NoBrand() {
  return (
    <NavBar
      items={[
        { label: '내 대시보드', href: '/dashboard' },
        { label: '내 저장소', href: '/my-repos' },
      ]}
      actions={
        <Button variant="outline" size="sm">
          로그아웃
        </Button>
      }
    />
  );
}
