import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { AccountSlot } from './_shell/account-slot';
import { AppFrame } from './_shell/app-frame';
import {
  readStoredCollapsed,
  SIDEBAR_STORAGE_KEY,
} from './_shell/sidebar-collapsed';
import { SessionEntryNavLink } from './_shell/role-home-link';
import { NavigationNoticeProvider } from '@/lib/navigation-notices';
import { QueryProvider } from './_shell/query-provider';

export const metadata: Metadata = {
  title: 'OSS Hub',
  description: '오픈소스 허브',
};

export const viewport: Viewport = {
  viewportFit: 'cover',
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const cookieStore = await cookies();
  const initialSidebarCollapsed = readStoredCollapsed(
    cookieStore.get(SIDEBAR_STORAGE_KEY)?.value ?? null,
  );

  return (
    <html lang="ko" className="font-sans">
      <body className="relative">
        <QueryProvider>
          <NavigationNoticeProvider>
            <AppFrame
              brand={<Link href="/">OSS Hub</Link>}
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
          </NavigationNoticeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
