import type { ReactNode } from 'react';
import './policy-document.css';

export const dynamic = 'force-static';

export default function PolicyLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return children;
}
