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
  const cookieStore = await cookies();
  const initialSidebarCollapsed = readStoredCollapsed(
    cookieStore.get(SIDEBAR_STORAGE_KEY)?.value ?? null,
  );

  return (
    <html lang="ko" className={cn('font-sans', pretendard.variable)}>
      <body className="relative">
        <SkipLink />

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
