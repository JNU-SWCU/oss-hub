'use client';

import Link from 'next/link';
import { ArrowRight, CalendarDays } from 'lucide-react';
import { useEffect, useState } from 'react';
import { loadLandingPrograms } from '../api';
import type { LandingProgram } from '../landing-overview';

type ProgramLoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | {
      readonly kind: 'ready';
      readonly programs: readonly LandingProgram[];
    };

function deadlineLabel(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(value));
}

export function CurrentProgramSectionView({
  state,
}: {
  readonly state: ProgramLoadState;
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
          {/* 문장 속 링크가 아니라 섹션 머리에 홀로 선 이동 버튼이다. 글자 높이
              그대로 두면 20px이라 손가락으로 겨냥하기 어렵다 — 생김새는 그대로 두고
              세로 여백만 얹어 조작 높이(44px) 기준을 맞춘다. */}
          <Link
            href="/programs"
            className="inline-flex min-h-control items-center gap-1.5 text-sm font-semibold text-primary underline underline-offset-4 hover:text-primary/75"
          >
            전체 프로그램
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>

        {state.kind === 'loading' ? (
          <div
            className="mt-10 divide-y divide-border border-y border-border"
            aria-busy="true"
          >
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="grid gap-3 py-5 sm:grid-cols-[1fr_auto]"
              >
                <span className="h-5 w-3/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                <span className="h-5 w-28 animate-pulse rounded bg-muted motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        ) : null}

        {state.kind === 'error' ? (
          <div className="mt-10 break-keep border-y border-border py-8 text-sm text-muted-foreground">
            모집 정보를 불러오지 못했습니다.{' '}
            <Link
              href="/programs"
              className="font-semibold text-primary underline"
            >
              프로그램 목록에서 확인하기
            </Link>
          </div>
        ) : null}

        {state.kind === 'ready' && state.programs.length === 0 ? (
          <div className="mt-10 break-keep border-y border-border py-8 text-sm text-muted-foreground">
            현재 공개 모집 중인 프로그램이 없습니다. 새 모집은 프로그램 목록에
            반영됩니다.
          </div>
        ) : null}

        {state.kind === 'ready' && state.programs.length > 0 ? (
          <ul className="mt-10 divide-y divide-border border-y border-border">
            {state.programs.map((program) => (
              <li key={program.id}>
                <Link
                  href={`/programs/${encodeURIComponent(program.id)}`}
                  className="group grid gap-4 py-5 transition-colors motion-reduce:transition-none hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary sm:grid-cols-[1fr_auto] sm:items-center sm:px-3"
                >
                  <div>
                    <h3 className="break-keep text-lg font-semibold text-foreground group-hover:text-primary">
                      {program.name}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {program.organizer}
                    </p>
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

/**
 * 공개 API 결과만 그린다. 실패 시 예시·stub 카드로 채우지 않는다.
 * 로컬 목록이 필요하면 부팅 시 `pnpm db:seed`로 DB를 채운다.
 */
export function CurrentProgramSection() {
  const [state, setState] = useState<ProgramLoadState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    void loadLandingPrograms()
      .then((programs) => {
        if (active) setState({ kind: 'ready', programs });
      })
      .catch((error: unknown) => {
        if (error instanceof Error) {
          if (!active) return;
          setState({ kind: 'error' });
          return;
        }
        throw error;
      });
    return () => {
      active = false;
    };
  }, []);

  return <CurrentProgramSectionView state={state} />;
}
