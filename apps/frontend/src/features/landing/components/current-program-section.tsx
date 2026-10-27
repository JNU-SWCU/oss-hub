'use client';

import Link from 'next/link';
import { ProgramCover } from '@/components';
import { programCoverSource } from '@/components/program-cover-source';
import { programOverviewHref } from '@/lib/program-route';
import { cn } from '@/lib/utils';
import { ArrowRight, CalendarDays } from 'lucide-react';
import type { LandingProgram } from '../landing-overview';

function deadlineLabel(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(value));
}

export function CurrentProgramSection({
  programs,
}: {
  readonly programs: readonly LandingProgram[];
}) {
  return (
    <section
      id="current-programs"
      aria-labelledby="current-programs-heading"
      className="border-b border-border bg-background"
    >
      <div className="mx-auto max-w-6xl px-6 py-16 sm:px-8 lg:py-20">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-semibold text-primary">프로그램</p>
            <h2
              id="current-programs-heading"
              className="mt-2 break-keep text-3xl font-bold tracking-tight text-foreground"
            >
              현재 모집 중인 프로그램
            </h2>
            <p className="mt-3 max-w-2xl break-keep text-sm leading-relaxed text-muted-foreground">
              공개 모집의 신청 기간과 주관 기관을 표시합니다.
            </p>
          </div>

          <Link
            href="/programs"
            className={cn(
              'inline-flex min-h-control items-center gap-1.5 text-sm font-semibold',
              'text-primary underline underline-offset-4 hover:text-primary/75',
            )}
          >
            전체 프로그램
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>

        {programs.length === 0 ? (
          <div className="mt-10 break-keep border-y border-border py-8 text-sm text-muted-foreground">
            현재 공개 모집 중인 프로그램이 없습니다. 새 모집은 프로그램 목록에
            반영됩니다.
          </div>
        ) : null}

        {programs.length > 0 ? (
          <ul className="mt-10 divide-y divide-border border-y border-border">
            {programs.map((program) => (
              <li key={program.id}>
                <Link
                  href={programOverviewHref(program.id)}
                  className={cn(
                    'group grid gap-4 py-5 transition-colors',
                    'hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-4',
                    'focus-visible:outline-primary sm:grid-cols-[1fr_auto] sm:items-center sm:px-3',
                  )}
                >
                  <div className="flex min-w-0 items-center gap-4">
                    <ProgramCover
                      src={programCoverSource(program.coverImageUrl)}
                      size="thumbnail"
                    />
                    <div className="min-w-0">
                      <h3 className="break-keep text-lg font-semibold text-foreground group-hover:text-primary">
                        {program.name}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {program.organizer}
                      </p>
                    </div>
                  </div>
                  <p className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                    <CalendarDays
                      className="size-4 text-primary"
                      aria-hidden="true"
                    />
                    {deadlineLabel(program.applicationEndAt)} 마감
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
