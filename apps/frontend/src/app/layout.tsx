import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Geist } from 'next/font/google';
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

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

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
    <html lang="ko" className={cn('font-sans', geist.variable)}>
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
