import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Geist } from 'next/font/google';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { NavBar, type NavItem } from '@/components';
import { LoginButton } from '@/features/auth/components/login-button';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'OSS Hub',
  description: '오픈소스 허브',
};

// 공통 셸 nav-config(#136) — 로그인/프로필은 기존 login-button.tsx를
// actions 슬롯에 배선만 한다. 내부 로직은 #98 소관.
const NAV_ITEMS: NavItem[] = [
  { label: '홈', href: '/' },
  { label: '프로그램', href: '/programs' },
];

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko" className={cn('font-sans', geist.variable)}>
      <body>
        <NavBar
          brand={<Link href="/">OSS Hub</Link>}
          items={NAV_ITEMS}
          actions={<LoginButton />}
        />
        {children}
      </body>
    </html>
  );
}
