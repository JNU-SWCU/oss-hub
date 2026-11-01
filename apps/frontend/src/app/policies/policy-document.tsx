import type { ReactNode } from 'react';

export function PolicyDocument({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <main className="policy-document">
      <h1>{title}</h1>
      <p>정책 버전: 2026-11-01</p>
      {children}
    </main>
  );
}
