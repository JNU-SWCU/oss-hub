import type { ReactNode } from 'react';

type ApplicantQueueLayoutProps = {
  readonly children: ReactNode;
  readonly modal: ReactNode;
};

export default function ApplicantQueueLayout({
  children,
  modal,
}: ApplicantQueueLayoutProps) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
