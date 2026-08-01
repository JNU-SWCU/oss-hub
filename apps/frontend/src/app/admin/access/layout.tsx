import type { ReactNode } from 'react';

type AdminAccessLayoutProps = {
  readonly children: ReactNode;
  readonly modal: ReactNode;
};

// `/admin/access` 하위 전체(목록·표준 상세)가 공유하는 최소 레이아웃(PR04F) —
// `@modal` 병렬 라우트 슬롯을 배선하는 목적 하나뿐이다. 목록·상세 각 page.tsx가
// 이미 각자 RolePanelShell로 ADMIN 게이트를 감싸므로, 이 레이아웃은 그 위에
// 어떤 추가 chrome도 씌우지 않는다 — 그래서 04C~04E의 렌더 결과는 그대로다.
export default function AdminAccessLayout({
  children,
  modal,
}: AdminAccessLayoutProps) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
