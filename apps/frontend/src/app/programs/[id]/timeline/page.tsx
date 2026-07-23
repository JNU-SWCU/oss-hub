import { RolePanelShell } from '../../../_shell/role-panel-shell';
import { STUDENT_MENU } from '../../../_shell/role-menus';
import {
  MilestoneTimelineScreen,
  type MilestoneTimelineFixture,
} from '@/features/milestone-timeline';

function fixtureMode(value: string | string[] | undefined) {
  if (value === 'empty' || value === 'error') return value;
  return null;
}

export default async function ProgramTimelinePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams: Promise<{
    readonly fixture?: string | string[];
  }>;
}) {
  const { id } = await params;
  const { fixture } = await searchParams;
  return (
    <RolePanelShell menu={STUDENT_MENU} allow={['STUDENT']}>
      <MilestoneTimelineScreen
        programId={decodeURIComponent(id)}
        fixture={fixtureMode(fixture) satisfies MilestoneTimelineFixture | null}
      />
    </RolePanelShell>
  );
}
