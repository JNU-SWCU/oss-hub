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
        >
          {children}
        </AppFrame>
      </body>
    </html>
  );
}
