import { LogoutCompleteScreen } from './logout-complete-screen';

// 로그아웃 완료(URL: /logout) — 게이트를 두지 않는다. 정의상 세션이 없는 사람이
// 서는 화면이라 로그인 여부를 묻는 게이트를 걸면 자기 자신에게 튕겨 나간다.
export default function LogoutPage() {
  return <LogoutCompleteScreen />;
}
