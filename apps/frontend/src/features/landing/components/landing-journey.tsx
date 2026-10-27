'use client';

import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  applyCosmosPrograms,
  attachCosmosInteraction,
  buildCosmosGraph,
  createCosmosQualityGovernor,
  createCosmosRenderer,
  layoutCosmosGraph,
  type CosmosFocus,
  type CosmosGraph,
  type CosmosProgram,
} from '@/features/landing/cosmos';
import { deriveLandingStats } from '../landing-stats';
import { isCosmosFocus, observeChapterFocus } from './landing-focus';
import styles from './landing-journey.module.css';
import { useRevealOnce } from './landing-reveal';
import { useLandingGraph } from './use-landing-graph';

export interface LandingJourneyProps {
  readonly authErrorMessage?: string;
  readonly notice?: ReactNode;
  readonly primaryAction: ReactNode;

  readonly contentAnchor?: string;
}

const ENTRANCE_MS = 1400;
const DESKTOP_FRAME_BUDGET_MS = 16.7;
const MOBILE_FRAME_BUDGET_MS = 33;
const DESKTOP_MIN_WIDTH = 1024;

let entrancePlayed = false;

const isPendingCount = (value: string): boolean => !/\d/.test(value);

const FLOW_STEPS: readonly (readonly [string, string, string])[] = [
  ['STEP 1', '팀 꾸리기', '초대를 수락해 함께 시작합니다'],
  ['STEP 2', '저장소 받기', '승인되면 팀 저장소가 열립니다'],
  ['STEP 3', '제출과 리뷰', '단계마다 교직원 피드백을 받습니다'],
  ['STEP 4', '공개 아카이브', '연도별 아카이브에 남습니다'],
];

export function LandingJourney({
  authErrorMessage,
  notice,
  primaryAction,
  contentAnchor = '#current-programs',
}: LandingJourneyProps) {
  const router = useRouter();
  const journeyRef = useRef<HTMLDivElement>(null);
  const skyRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const graphRef = useRef<CosmosGraph | null>(null);
  const focusRef = useRef<CosmosFocus>('hero');
  const [focus, setFocus] = useState<CosmosFocus>('hero');
  const revealRef = useRevealOnce();
  const { graph: publicGraph, completeness } = useLandingGraph();

  const programsRef = useRef<readonly CosmosProgram[]>([]);
  const programs = useMemo(
    () =>
      publicGraph.nodes
        .filter((node) => node.kind === 'program')
        .map((node): CosmosProgram => ({
          name: node.label,
          href: publicGraph.source === 'public' ? node.href : null,
        })),
    [publicGraph],
  );

  const stats = useMemo(
    () => deriveLandingStats(publicGraph, completeness),
    [publicGraph, completeness],
  );

  useEffect(() => {
    programsRef.current = programs;
    if (graphRef.current) applyCosmosPrograms(graphRef.current, programs);
  }, [programs]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const sky = skyRef.current;
    const journey = journeyRef.current;
    if (!canvas || !sky || !journey) return;

    if (!graphRef.current) {
      const graph = buildCosmosGraph();
      layoutCosmosGraph(graph);
      graphRef.current = graph;
    }
    const graph = graphRef.current;
    applyCosmosPrograms(graph, programsRef.current);

    const renderer = createCosmosRenderer({
      canvas,
      graph,
      fontFamily:
        window.getComputedStyle(journey).fontFamily || 'system-ui, sans-serif',
      entranceMs: entrancePlayed ? 0 : ENTRANCE_MS,
    });
    const quality = createCosmosQualityGovernor();
    const interaction = attachCosmosInteraction({
      canvas,
      pick: renderer.pick,
      canOpen: (index) => typeof graph.nodes[index]?.href === 'string',
      open: (index) => {
        const href = graph.nodes[index]?.href;
        if (href) router.push(href);
      },
    });

    let frame: number | null = null;
    let visible = true;

    const loop = (t: number): void => {
      frame = window.requestAnimationFrame(loop);
      entrancePlayed = true;
      const startedAt = performance.now();
      interaction.advance();
      renderer.render({
        ...interaction.orbit(),
        time: t,
        hovered: interaction.hovered(),
        qualityScale: quality.qualityScale(),
        focus: focusRef.current,
      });
      quality.recordFrame(
        performance.now() - startedAt,
        window.innerWidth < DESKTOP_MIN_WIDTH
          ? MOBILE_FRAME_BUDGET_MS
          : DESKTOP_FRAME_BUDGET_MS,
      );
    };

    const start = (): void => {
      if (frame === null) frame = window.requestAnimationFrame(loop);
    };
    const stop = (): void => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
    };
    const syncActivity = (): void => {
      if (visible && document.visibilityState === 'visible') start();
      else stop();
    };

    start();

    const visibilityObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) visible = entry.isIntersecting;
      syncActivity();
    });
    visibilityObserver.observe(sky);
    document.addEventListener('visibilitychange', syncActivity);

    const targets = new Map<Element, CosmosFocus>();
    for (const element of journey.querySelectorAll<HTMLElement>(
      'section[data-focus]',
    )) {
      const mode = element.dataset.focus;
      if (isCosmosFocus(mode)) targets.set(element, mode);
    }
    const stopFocus = observeChapterFocus(targets, (next) => {
      focusRef.current = next;
      setFocus(next);
    });

    return () => {
      stop();
      stopFocus();
      visibilityObserver.disconnect();
      document.removeEventListener('visibilitychange', syncActivity);
      interaction.dispose();
      renderer.dispose();
    };
  }, [router]);

  return (
    <div id="landing-journey" ref={journeyRef} className={styles.journey}>
      <a className={styles.skip} href={contentAnchor}>
        프로그램 정보로 건너뛰기
      </a>

      <div className={styles.grid}>
        <div className={styles.copy}>
          <section
            id="landing-hero"
            aria-labelledby="landing-hero-heading"
            className={styles.hero}
            data-focus="hero"
          >
            <div className={styles.heroCopy}>
              <span className={styles.eyebrow}>
                전남대학교 SW중심대학사업단
              </span>
              <h1 id="landing-hero-heading">오픈소스로 성장하는 곳</h1>
              <p>
                교내 프로그램에서 팀을 꾸리고, 실제 저장소에서 협업하고, 그
                기록을 공개 포트폴리오로 남기세요. GitHub 계정 하나면 시작할 수
                있습니다.
              </p>
              {authErrorMessage ? (
                <Alert className="mt-6 max-w-xl border-hero-danger/40 bg-hero-danger/10 text-hero-danger">
                  <CircleAlert aria-hidden="true" />
                  <AlertDescription className="text-hero-danger">
                    {authErrorMessage}
                  </AlertDescription>
                </Alert>
              ) : notice ? (
                <div
                  role="status"
                  className={cn(
                    'mt-6 max-w-xl rounded-lg border border-cosmos-border bg-cosmos-muted/10',
                    'px-4 py-3 text-sm leading-relaxed text-cosmos-muted',
                  )}
                >
                  {notice}
                </div>
              ) : null}
              <div className={styles.actions}>
                {primaryAction}
                <Link className={styles.link} href="/programs">
                  프로그램 둘러보기
                </Link>
              </div>
            </div>
          </section>

          <section
            ref={revealRef}
            aria-labelledby="landing-program-heading"
            className={styles.chapter}
            data-focus="programs"
          >
            <div className={styles.chapterHead}>
              <span className={styles.chapterNo} aria-hidden="true">
                01
              </span>
              <span className={styles.eyebrow}>프로그램</span>
            </div>
            <h2 id="landing-program-heading">
              해커톤도, 스터디도 하나의 별자리로
            </h2>
            <p>
              경진대회, 해커톤, 기여 챌린지, 스터디, 세미나. 참여한 모든 활동이
              학생과 저장소로 이어져 오픈소스 경험으로 쌓입니다.
            </p>
            <ul className={styles.stats}>
              {(
                [
                  [stats.programs, '공개 프로그램'],
                  [stats.repositories, '공개 저장소'],
                  [stats.students, '공개 기여자'],
                ] as const
              ).map(([value, key]) => (
                <li key={key}>
                  <div
                    className={styles.statValue}
                    data-pending={isPendingCount(value) ? 'true' : undefined}
                  >
                    {value}
                  </div>
                  <div className={styles.statKey}>{key}</div>
                </li>
              ))}
            </ul>
            <span className={styles.statNote}>{stats.note}</span>
          </section>

          <section
            ref={revealRef}
            aria-labelledby="landing-flow-heading"
            className={styles.chapter}
            data-focus="flow"
          >
            <div className={styles.chapterHead}>
              <span className={styles.chapterNo} aria-hidden="true">
                02
              </span>
              <span className={styles.eyebrow}>흐름</span>
            </div>
            <h2 id="landing-flow-heading">실제 오픈소스처럼 일합니다</h2>
            <p>
              익숙한 GitHub 위에서 팀을 꾸리고, 저장소에서 협업하고, 리뷰를
              받습니다.
            </p>
            <ol className={styles.steps}>
              {FLOW_STEPS.map(([no, title, description]) => (
                <li key={no} className={styles.step}>
                  <span className={styles.stepNo}>{no}</span>
                  <span className={styles.stepTitle}>{title}</span>
                  <span className={styles.stepDesc}>{description}</span>
                </li>
              ))}
            </ol>
          </section>

          <section
            ref={revealRef}
            aria-labelledby="landing-activity-heading"
            className={styles.chapter}
            data-focus="activity"
            data-tone="dawn"
          >
            <div className={styles.chapterHead}>
              <span className={styles.chapterNo} aria-hidden="true">
                03
              </span>
              <span className={styles.eyebrow}>나의 활동</span>
            </div>
            <h2 id="landing-activity-heading">내 기여가 포트폴리오가 됩니다</h2>
            <p>
              참여한 프로그램과 팀, 저장소, 제출 기록을 한 화면에서 봅니다. 진행
              중인 저장소는 팀과 교직원만 보고, 검토를 거쳐 승인된 것만
              공개됩니다.
            </p>
          </section>
        </div>

        <div
          ref={skyRef}
          className={styles.skyColumn}
          data-focus={focus}
          aria-hidden="true"
        >
          <canvas ref={canvasRef} className={styles.sky} />
          <div className={styles.corner}>
            <div className={styles.legend}>
              <span>
                <i className={styles.dotStudent} />
                학생
              </span>
              <span>
                <i className={styles.dotRepository} />
                저장소
              </span>
              <span>
                <i className={styles.dotProgram} />
                프로그램
              </span>
              <span className={styles.legendNote}>예시 구성</span>
            </div>
            <p className={styles.hint}>
              끌어서 돌리고, 확대해서 들여다보고, 점을 누르면 열립니다
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
