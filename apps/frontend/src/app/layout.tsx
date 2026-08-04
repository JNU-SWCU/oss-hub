import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Geist } from 'next/font/google';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { AccountSlot } from './_shell/account-slot';
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
          공통 셸 nav-config(#136) — 메뉴 목록의 원본은 `public-menus.ts`다(#513).
          로그인/프로필은 기존 login-button.tsx를 actions 슬롯에 배선만 한다(#98).
          그 배선을 `AccountSlot`이 감싼다 — 가입을 마치지 않은 사람에게는 가입 화면
          밖에서 계정 표식을 내지 않는다(`_shell/signup-completion.ts`).
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
        >
          {children}
        </AppFrame>
      </body>
    </html>
  );
}
