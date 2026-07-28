// NavBar 프리뷰 — app/layout.tsx(NAV_ITEMS: 홈/프로그램/아카이브)와
// _shell/role-menus.ts(역할별 메뉴)의 실제 nav-config를 그대로 옮긴 것.
//
// 주의: 이 컴포넌트는 Next 라우터 밖(디자인 시스템 번들)에서도 이식 가능하도록
// linkComponent가 미지정이면 순수 <a>로 폴백하는 것이 계약(nav-bar.tsx 주석
// 참고) — 이 프리뷰가 linkComponent를 넘기지 않는 것은 워크어라운드가 아니라
// 컴포넌트가 문서화한 정상 사용법이다. 실제 앱(app/layout.tsx)의 ShellNav만
// 세션·라우팅을 아는 호출부 책임으로 next/link의 Link를 주입한다.
import { Button, NavBar, StatusBadge } from 'frontend';

// app/layout.tsx NAV_ITEMS — 기본 상단 내비게이션.
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

// _shell/role-menus.ts ADMIN_MENU — 항목이 많을 때(overflow-x-clip 동작 확인).
export function ManyItems() {
  return (
    <NavBar
      brand="OSS Hub 관리 콘솔"
      items={[
        { label: '교직원 승인', href: '/admin/staff-requests' },
        { label: '관리 콘솔', href: '/admin/users' },
        { label: '감사 로그', href: '/admin/audit-log' },
        { label: '시스템 상태', href: '/admin/system-status' },
      ]}
      actions={<StatusBadge variant="approved">관리자</StatusBadge>}
    />
  );
}

// brand 없이 items만 — brand가 선택(optional) 슬롯임을 확인.
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
