import * as React from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { programOverviewHref } from '@/lib/program-route';
import type { UserParticipation } from '@/lib/user-participation';
import { cn } from '@/lib/utils';

interface UserProfileCardProps {
  profile: {
    readonly name: string | null;
    readonly githubLogin: string;
    readonly memberKind: 'STUDENT' | 'STAFF' | null;
    readonly studentId: string | null;
    readonly staffNumber: string | null;
    readonly department: string | null;
    readonly participations: readonly UserParticipation[] | null;
  };

  headingTag?: 'h2' | 'h3';

  badges?: React.ReactNode;
}

const sectionClassName = 'border-t border-border pt-(--card-spacing)';

function ProfileField({
  label,
  value,
  numeric = false,
}: {
  label: string;
  value: string | null;
  numeric?: boolean;
}) {
  return (
    <div className="grid min-w-0 content-start gap-0.5">
      <dt className="text-small text-muted-foreground">{label}</dt>
      <dd className={cn('font-medium break-words', numeric && 'tabular-nums')}>
        {value?.trim() ? value : '미등록'}
      </dd>
    </div>
  );
}

function UserProfileCard({
  profile,
  headingTag: HeadingTag = 'h2',
  badges,
}: UserProfileCardProps) {
  const name = profile.name?.trim() ? profile.name : null;
  const SubheadingTag = HeadingTag === 'h2' ? 'h3' : 'h4';
  const participations =
    profile.memberKind === 'STUDENT' ? profile.participations : null;

  return (
    <section data-slot="user-profile-card" aria-label="프로필">
      <Card className="@container">
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <span
            aria-hidden="true"
            className={cn(
              'grid size-12 shrink-0 place-items-center rounded-full text-lg font-bold',
              'bg-status-recruiting-bg text-status-recruiting-fg',
            )}
          >
            {Array.from(name ?? profile.githubLogin)[0]?.toUpperCase()}
          </span>
          <div className="grid min-w-40 flex-1 gap-0.5">
            <HeadingTag className="font-heading text-lg leading-snug font-bold tracking-tight break-words">
              {name ?? '이름 미등록'}
            </HeadingTag>
            <a
              href={`https://github.com/${profile.githubLogin}`}
              target="_blank"
              rel="noreferrer"
              aria-label={`${profile.githubLogin}의 GitHub 프로필 (새 탭에서 열림)`}
              className={cn(
                'flex w-fit max-w-full items-center gap-1.5 text-muted-foreground',
                'hover:text-foreground hover:underline',
              )}
            >
              <span className="min-w-0 break-all">@{profile.githubLogin}</span>
              <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
            </a>
          </div>
          {badges ? <div className="flex flex-wrap gap-2">{badges}</div> : null}
        </CardContent>
        <CardContent className={sectionClassName}>
          {profile.memberKind === null ? (
            <p className="text-muted-foreground">가입 유형 미선택</p>
          ) : (
            <dl className="grid gap-4 @md:grid-cols-2">
              {profile.memberKind === 'STUDENT' ? (
                <>
                  <ProfileField
                    label="학번"
                    value={profile.studentId}
                    numeric
                  />
                  <ProfileField label="학과" value={profile.department} />
                </>
              ) : (
                <>
                  <ProfileField
                    label="교직원 번호"
                    value={profile.staffNumber}
                    numeric
                  />
                  <ProfileField label="소속" value={profile.department} />
                </>
              )}
            </dl>
          )}
        </CardContent>
        {participations === null ? null : (
          <CardContent className={sectionClassName}>
            <SubheadingTag className="text-small font-normal text-muted-foreground">
              참여 프로그램·팀
            </SubheadingTag>
            {participations.length === 0 ? (
              <p className="mt-2 text-muted-foreground">
                참여 프로그램이 없습니다.
              </p>
            ) : (
              <ul className="mt-1 divide-y divide-border/50">
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
            )}
          </CardContent>
        )}
      </Card>
    </section>
  );
}

export { UserProfileCard };
