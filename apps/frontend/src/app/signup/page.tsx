import { SignupEntryScreen } from './signup-entry-screen';

// 가입·로그인 진입(URL: /signup) — 게이트를 두지 않는다. 비로그인 방문자가
// 봐야 하는 유일한 화면이고, 이미 로그인한 사용자는 화면 안에서 멈춘 자리로
// 되돌린다(signup-entry.ts).
export default function SignupPage() {
  return <SignupEntryScreen />;
}
