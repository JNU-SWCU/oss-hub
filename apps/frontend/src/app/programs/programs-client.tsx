'use client';

import { useDeferredValue } from 'react';
import { ProgramListPage } from '@/features/programs/catalog/program-list-page';
import { useSession } from '@/features/auth/use-session';
import { hasStaffAudience } from '../_shell/member-access';
import { SectionFacetChips } from '../_shell/section-facet-chips';
import { useSessionRole } from '../_shell/use-session-role';

export function ProgramsClient({
  publicSnapshotTime,
}: {
  readonly publicSnapshotTime?: number;
}) {
  const auth = useSession();
  const session = useSessionRole();
  const publicCatalog =
    publicSnapshotTime !== undefined &&
    (auth.status === 'loading' || auth.status === 'anonymous');
  const audience = publicCatalog ? 'public' : 'viewer';
  const identity =
    publicSnapshotTime !== undefined && auth.status === 'authenticated'
      ? `viewer:${auth.user?.nickname ?? ''}`
      : audience;
  const settledIdentity = useDeferredValue(identity);
  const canCreateProgram =
    session.status === 'assigned' &&
    session.isProfileComplete &&
    hasStaffAudience(session);
  const viewerRole =
    session.status !== 'assigned'
      ? null
      : hasStaffAudience(session)
        ? 'STAFF'
        : session.memberKind === 'STUDENT'
          ? 'STUDENT'
          : null;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <ProgramListPage
        canCreateProgram={canCreateProgram}
        viewerRole={viewerRole}
        audience={audience}
        queryEnabled={identity === settledIdentity}
        initialNow={publicCatalog ? publicSnapshotTime : undefined}
        filters={<SectionFacetChips />}
      />
    </main>
  );
}
