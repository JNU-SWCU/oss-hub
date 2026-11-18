import Link from 'next/link';

import { programOverviewHref } from '@/lib/program-route';
import type { UserParticipation } from '@/lib/user-participation';

interface UserParticipationListProps {
  readonly participations: readonly UserParticipation[];
}

function UserParticipationList({ participations }: UserParticipationListProps) {
  if (participations.length === 0) {
    return <p className="text-muted-foreground">참여 프로그램이 없습니다.</p>;
  }

  return (
    <ul
      data-slot="user-participation-list"
      className="divide-y divide-border/50"
    >
      {participations.map((participation) => (
        <li
          key={participation.programId}
          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2"
        >
          <Link
            href={programOverviewHref(participation.programId)}
            className="min-w-0 font-medium break-words underline underline-offset-2 hover:text-primary"
          >
            {participation.programName}
          </Link>
          <span className="min-w-0 text-small break-words text-muted-foreground">
            {participation.isLeader
              ? `${participation.teamName} · 팀장`
              : participation.teamName}
          </span>
        </li>
      ))}
    </ul>
  );
}

export { UserParticipationList };
