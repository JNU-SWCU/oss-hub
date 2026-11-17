import type { ReactNode } from 'react';

type AdminAccessLayoutProps = {
  readonly children: ReactNode;
};

export default function AdminAccessLayout({
  children,
}: AdminAccessLayoutProps) {
  return <>{children}</>;
}
