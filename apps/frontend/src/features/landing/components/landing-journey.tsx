'use client';

import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  readonly primaryAction?: ReactNode;

  readonly contentAnchor?: string;
}

const ENTRANCE_MS = 1400;
const DESKTOP_FRAME_BUDGET_MS = 16.7;
const MOBILE_FRAME_BUDGET_MS = 33;
const DESKTOP_MIN_WIDTH = 1024;

let entrancePlayed = false;

const FLOW_STEPS: readonly (readonly [string, string, string])[] = [
  ['STEP 1', '신청·팀 구성', '초대를 수락해 팀에 합류'],
  ['STEP 2', '저장소 연결', '승인되면 팀 저장소가 열림'],
  ['STEP 3', '제출·검토', '마일스톤 단위로 교직원이 검토'],
  ['STEP 4', '공개 아카이브', '연도별 아카이브에 남음'],
];

export function LandingJourney({
  authErrorMessage,
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
  const { graph: publicGraph, completeness, programs } = useLandingGraph();

  const programsRef = useRef<readonly CosmosProgram[]>([]);

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
              <h1 id="landing-hero-heading">흩어진 정보를 하나로</h1>
              <p>
                OSS Hub는 오픈소스 활동을 모아 역량으로 쌓아줍니다. 교내 활동,
                팀 프로젝트, 대외 활동 등의 제출 및 검토를 간편하게
                만들어줍니다.
              </p>
              {authErrorMessage ? (
                <Alert className="mt-6 max-w-xl border-hero-danger/40 bg-hero-danger/10 text-hero-danger">
                  <CircleAlert aria-hidden="true" />
                  <AlertDescription className="text-hero-danger">
                    {authErrorMessage}
                  </AlertDescription>
                </Alert>
              ) : null}
              {primaryAction ? (
                <div className={styles.actions}>
                  {primaryAction}
                  <Link className={styles.link} href="/programs">
                    프로그램 둘러보기
                  </Link>
                </div>
              ) : null}
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
              모든 활동은 프로그램{'\u00a0'}단위로 묶입니다
            </h2>
            <p>
              경진대회·해커톤·기여 챌린지·스터디·세미나와 같은 프로그램들은
              학생, 저장소와 연결되어 관리됩니다.
            </p>
            {stats.items.length > 0 ? (
              <ul className={styles.stats}>
                {stats.items.map(({ key, value }) => (
                  <li key={key}>
                    <div className={styles.statValue}>{value}</div>
                    <div className={styles.statKey}>{key}</div>
                  </li>
                ))}
              </ul>
            ) : null}
            {stats.note ? (
              <span className={styles.statNote}>{stats.note}</span>
            ) : null}
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
            <h2 id="landing-flow-heading">신청부터 공개까지, 하나의 흐름</h2>
            <p>익숙한 GitHub 위에서 신청, 협업, 검토가 끊김 없이 이어집니다.</p>
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
            <h2 id="landing-activity-heading">참여 기록이 모두 남습니다</h2>
            <p>
              참여한 프로그램, 팀, 저장소, 제출 기록을 대시보드에서 확인합니다.
              진행 중인 저장소는 팀과 교직원만 볼 수 있고, 공개는 검토 후 명시적
              승인을 거칩니다.
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
