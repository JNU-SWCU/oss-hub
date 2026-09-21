import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import localFont from 'next/font/local';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { AccountSlot } from './_shell/account-slot';
import { AppFrame } from './_shell/app-frame';
import {
  readStoredCollapsed,
  SIDEBAR_STORAGE_KEY,
} from './_shell/sidebar-collapsed';
import { PUBLIC_MENU } from './_shell/public-menus';
import { SessionEntryNavLink } from './_shell/role-home-link';
import { SkipLink } from './_shell/skip-link';

/*
 * 본문 폰트는 Pretendard 가변본 한 벌로 통일한다(R-39). 라틴·숫자도 같은 폰트가
 * 맡아 라틴 전용 폰트를 따로 두지 않는다 — Geist 는 한글 글리프가 없어 한글이
 * OS 기본 글꼴로 떨어지고 있었다.
 *
 * `src` 는 반드시 상대 경로다. next-font-loader 가 './' 를 강제로 붙여서
 * 'pretendard/…' 같은 패키지 이름은 src/app/ 밑에서 찾다가 실패한다.
 *
 * 2 MB 한 벌이라 `preload: false` + `display: 'swap'` 으로 첫 화면을 막지 않는다.
 * 글자는 시스템 한글 글꼴로 먼저 보이고 내려받는 대로 바뀐다.
 * `adjustFontFallback` 은 끈다 — 기본값의 Arial 메트릭 보정은 한글에 의미가 없고
 * 라틴 폴백만 비튼다.
 */
const pretendard = localFont({
  src: '../../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2',
  weight: '45 920',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  fallback: [
    'Apple SD Gothic Neo',
    'Noto Sans KR',
    'Malgun Gothic',
    'sans-serif',
  ],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'OSS Hub',
  description: '오픈소스 허브',
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  // 사이드바 접힘 쿠키 → 첫 페인트부터 올바른 폭 (F4). Root 는 cookies() 로 dynamic.
  const cookieStore = await cookies();
  const initialSidebarCollapsed = readStoredCollapsed(
    cookieStore.get(SIDEBAR_STORAGE_KEY)?.value ?? null,
  );

  return (
    <html lang="ko" className={cn('font-sans', pretendard.variable)}>
      <body className="relative">
        <SkipLink />
        {/*
          공통 상단 NavBar — 랜딩·업무 동일 컴포넌트, 메뉴 원본은 PUBLIC_MENU.
          가입 완료 시 왼쪽 “내 상황”은 AppFrame → ProductShell이 단다.
          AccountSlot이 가입 미완료 표식을 가린다.
        */}
        <AppFrame
          brand={<Link href="/">OSS Hub</Link>}
          items={PUBLIC_MENU}
          actions={
            <>
              <SessionEntryNavLink />
              <AccountSlot />
            </>
          }
          initialSidebarCollapsed={initialSidebarCollapsed}
        >
          {children}
        </AppFrame>
      </body>
    </html>
  );
}
