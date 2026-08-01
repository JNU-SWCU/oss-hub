'use client';

import Link from 'next/link';
import type { KeyboardEvent, ReactElement } from 'react';
import { staffProgramHref } from './program-paths';

interface StaffDashboardEditLinkProps {
  readonly programId: string;
  readonly programName: string;
}

function StaffDashboardEditLink({
  programId,
  programName,
}: StaffDashboardEditLinkProps): ReactElement {
  const handleKeyDown = (event: KeyboardEvent<HTMLAnchorElement>): void => {
    if (event.key !== ' ') return;
    event.preventDefault();
    event.currentTarget.click();
  };

  return (
    <Link
      href={staffProgramHref(programId, '/edit')}
      aria-label={`${programName} 편집`}
      className="font-medium break-keep underline-offset-4 after:absolute after:inset-0 after:z-[1] hover:underline focus-visible:underline focus-visible:outline-none"
      onKeyDown={handleKeyDown}
    >
      {programName}
    </Link>
  );
}

export { StaffDashboardEditLink };
