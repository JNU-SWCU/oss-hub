import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Geist } from 'next/font/google';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { LoginButton } from '@/features/auth/components/login-button';
import { AppFrame } from './_shell/app-frame';
import { PUBLIC_MENU } from './_shell/public-menus';
import { SessionEntryNavLink } from './_shell/role-home-link';
import { SkipLink } from './_shell/skip-link';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'OSS Hub',
  description: '오픈소스 허브',
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko" className={cn('font-sans', geist.variable)}>
      <body className="relative">
        <SkipLink />
        {/* 랜딩은 상단 헤더, 그 외는 사이드바 + 상단바 — 분기는 AppFrame이 한다 */}
        {/*
          nav-config(#136)의 메뉴 목록은 `public-menus.ts`가 원본이다. 여기에 다시
          적으면 사이드바와 갈라진다(#513). `홈`은 목록에 없다 — 왼쪽 브랜드가
          이미 `/` 링크라 같은 바 안에 같은 목적지가 둘이 된다.
          로그인/프로필은 기존 login-button.tsx를 actions 슬롯에 배선만 한다.
          내부 로직은 #98 소관.
        */}
        <AppFrame
          brand={<Link href="/">OSS Hub</Link>}
          items={PUBLIC_MENU}
          actions={
            <>
              <SessionEntryNavLink />
              <LoginButton />
            </>
          }
        >
          {children}
        </AppFrame>
      </body>
    </html>
  );
}
