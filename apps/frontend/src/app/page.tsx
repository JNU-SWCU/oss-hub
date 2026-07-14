import { LoginButton } from "@/features/auth/components/login-button";

export default function HomePage() {
  return (
    <main>
      <h1>OSS Hub</h1>
      <p>오픈소스 활동을 함께 관리하는 공간입니다.</p>
      <LoginButton />
    </main>
  );
}
