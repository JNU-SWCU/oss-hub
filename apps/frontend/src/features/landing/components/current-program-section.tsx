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
      readonly source: 'public' | 'example';
    };

const LOCAL_PROGRAM_EXAMPLE = [
  {
    id: 'program-capstone',
    name: '캡스톤 2026',
    organizer: '전남대학교 SW중심대학사업단',
    category: 'CAPSTONE',
    applicationEndAt: '2026-08-10T23:59:59.000+09:00',
  },
  {
    id: 'program-oss-contest',
    name: 'OSS 경진대회',
    organizer: '전남대학교 SW중심대학사업단',
    category: 'OSS_CONTEST',
    applicationEndAt: '2026-08-08T23:59:59.000+09:00',
  },
] as const satisfies readonly LandingProgram[];

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function deadlineLabel(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(value));
}

export function resolveProgramLoadFailure({
  allowLocalExamples,
  hostname,
}: {
  readonly allowLocalExamples: boolean;
  readonly hostname: string;
}): ProgramLoadState {
  return allowLocalExamples && isLoopbackHostname(hostname)
    ? {
        kind: 'ready',
        programs: LOCAL_PROGRAM_EXAMPLE,
        source: 'example',
      }
    : { kind: 'error' };
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
            {state.kind === 'ready' && state.source === 'example' ? (
              <span className="mt-3 inline-flex rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                로컬 예시 데이터
              </span>
            ) : null}
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
                  href={`/programs/${program.id}`}
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

export function CurrentProgramSection({
  allowLocalExamples = false,
}: {
  readonly allowLocalExamples?: boolean;
}) {
  const [state, setState] = useState<ProgramLoadState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    void loadLandingPrograms()
      .then((programs) => {
        if (active) setState({ kind: 'ready', programs, source: 'public' });
      })
      .catch((error: unknown) => {
        if (error instanceof Error) {
          if (!active) return;
          setState(
            resolveProgramLoadFailure({
              allowLocalExamples,
              hostname: window.location.hostname,
            }),
          );
          return;
        }
        throw error;
      });
    return () => {
      active = false;
    };
  }, [allowLocalExamples]);

  return <CurrentProgramSectionView state={state} />;
}
