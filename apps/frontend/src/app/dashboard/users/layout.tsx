import type { ReactNode } from 'react';

type AdminAccessLayoutProps = {
  readonly children: ReactNode;
  readonly modal: ReactNode;
};

export default function AdminAccessLayout({
  children,
  modal,
}: AdminAccessLayoutProps) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
