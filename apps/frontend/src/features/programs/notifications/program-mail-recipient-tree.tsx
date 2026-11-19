'use client';

import { useEffect, useRef } from 'react';
import { CircleCheck, CircleX, Clock3, type LucideIcon } from 'lucide-react';
import type {
  ProgramMailApplicationStatus,
  ProgramMailTeam,
} from './program-mail-dto';

const STATUS = {
  SUBMITTED: {
    label: '검토 대기',
    icon: Clock3,
    tone: 'text-status-pending-fg',
  },
  APPROVED: {
    label: '승인',
    icon: CircleCheck,
    tone: 'text-status-approved-fg',
  },
  REJECTED: {
    label: '반려',
    icon: CircleX,
    tone: 'text-status-rejected-fg',
  },
} as const satisfies Record<
  ProgramMailApplicationStatus,
  {
    readonly label: string;
    readonly icon: LucideIcon;
    readonly tone: string;
  }
>;

export function selectedTeamState(
  team: ProgramMailTeam,
  selectedIds: ReadonlySet<string>,
): boolean | 'mixed' {
  const availableIds = team.applicants
    .filter((applicant) => applicant.mailAvailable)
    .map((applicant) => applicant.id);
  const selectedCount = availableIds.filter((id) => selectedIds.has(id)).length;
  if (selectedCount === 0) return false;
  return selectedCount === availableIds.length ? true : 'mixed';
}

export function toggleTeamSelection(
  team: ProgramMailTeam,
  selectedIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const next = new Set(selectedIds);
  const availableIds = team.applicants
    .filter((applicant) => applicant.mailAvailable)
    .map((applicant) => applicant.id);
  const select = availableIds.some((id) => !next.has(id));
  for (const id of availableIds) {
    if (select) next.add(id);
    else next.delete(id);
  }
  return next;
}

function TeamCheckbox({
  checked,
  disabled,
  onChange,
}: {
  readonly checked: boolean | 'mixed';
  readonly disabled: boolean;
  readonly onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = checked === 'mixed';
  }, [checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked === true}
      aria-checked={checked === 'mixed' ? 'mixed' : checked}
      disabled={disabled}
      onChange={(event) => {
        event.currentTarget.indeterminate = checked === 'mixed';
        onChange();
      }}
    />
  );
}

export function ProgramMailRecipientTree({
  teams,
  selectedIds,
  recipientLimit,
  onSelectionChange,
}: {
  readonly teams: readonly ProgramMailTeam[];
  readonly selectedIds: ReadonlySet<string>;
  readonly recipientLimit: number;
  readonly onSelectionChange: (selectedIds: ReadonlySet<string>) => void;
}) {
  return (
    <div className="grid gap-4" aria-label="메일 수신자">
      {teams.map((team) => {
        const status = STATUS[team.status];
        const StatusIcon = status.icon;
        const state = selectedTeamState(team, selectedIds);
        const availableCount = team.applicants.filter(
          (applicant) => applicant.mailAvailable,
        ).length;
        const headingId = `mail-team-${team.id}`;
        return (
          <section
            key={team.id}
            className="grid gap-3 rounded-card border border-border p-4"
            aria-labelledby={headingId}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3">
                <TeamCheckbox
                  checked={state}
                  disabled={
                    availableCount === 0 ||
                    (state !== true && selectedIds.size >= recipientLimit)
                  }
                  onChange={() =>
                    onSelectionChange(toggleTeamSelection(team, selectedIds))
                  }
                />
                <span
                  id={headingId}
                  className="min-w-0 font-semibold break-words"
                >
                  {team.name}
                </span>
              </label>
              <span
                className={`flex items-center gap-1.5 text-small font-medium ${status.tone}`}
              >
                <StatusIcon aria-hidden="true" className="size-4" />
                {status.label}
              </span>
            </div>
            <div
              role="group"
              aria-labelledby={headingId}
              className="grid gap-1 pl-7"
            >
              {team.applicants.map((applicant) => (
                <label
                  key={applicant.id}
                  className="flex min-h-11 min-w-0 cursor-pointer items-center gap-3 rounded-control px-2 hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(applicant.id)}
                    disabled={
                      !applicant.mailAvailable ||
                      (!selectedIds.has(applicant.id) &&
                        selectedIds.size >= recipientLimit)
                    }
                    onChange={(event) => {
                      const next = new Set(selectedIds);
                      if (event.target.checked) next.add(applicant.id);
                      else next.delete(applicant.id);
                      onSelectionChange(next);
                    }}
                  />
                  <span className="min-w-0 flex-1 break-words">
                    {applicant.displayName}{' '}
                    <span className="text-small text-muted-foreground">
                      @{applicant.nickname}
                    </span>
                  </span>
                  {!applicant.mailAvailable ? (
                    <span className="text-small text-muted-foreground">
                      메일 수신 불가
                    </span>
                  ) : null}
                </label>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
