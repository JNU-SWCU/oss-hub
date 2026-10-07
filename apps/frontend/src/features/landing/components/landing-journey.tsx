'use client';

import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  buildCosmosGraph,
  clamp01,
  createCosmosQualityGovernor,
  createCosmosRenderer,
  layoutCosmosGraph,
  PANEL_RANGES,
  type CosmosGraph,
} from '@/features/landing/cosmos';
import { deriveLandingStats } from '../landing-stats';
import styles from './landing-journey.module.css';
import { useLandingGraph } from './use-landing-graph';

export interface LandingJourneyProps {
  readonly authErrorMessage?: string;
  readonly notice?: ReactNode;
  readonly primaryAction: ReactNode;

  readonly contentAnchor?: string;
}

const PANEL_COUNT = 5;
const FLOW_STEPS: readonly (readonly [string, string, string])[] = [
  ['STEP 1', '신청·팀 구성', '— 초대를 수락해 팀에 합류'],
  ['STEP 2', '저장소 연결', '— 승인되면 팀 저장소가 열림'],
  ['STEP 3', '제출·검토', '— 마일스톤 단위로 교직원이 검토'],
  ['STEP 4', '공개 아카이브', '— 연도별 아카이브에 남음'],
];

function applyProgramNames(graph: CosmosGraph, names: readonly string[]): void {
  if (names.length === 0) return;
  let cursor = 0;
  for (const node of graph.nodes) {
    if (node.kind !== 'p') continue;
    const name = names[cursor];
    if (name) node.name = name;
    cursor += 1;
  }
}

export function LandingJourney({
  authErrorMessage,
  notice,
  primaryAction,
  contentAnchor = '#current-programs',
}: LandingJourneyProps) {
  const journeyRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panelRefs = useRef<(HTMLElement | null)[]>([]);
  const tickRefs = useRef<(HTMLElement | null)[]>([]);
  const hintRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<CosmosGraph | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const { graph: publicGraph, completeness } = useLandingGraph();

  const programNamesRef = useRef<readonly string[]>([]);
  const programNames = useMemo(
    () =>
      publicGraph.nodes
        .filter((node) => node.kind === 'program')
        .map((node) => node.label),
    [publicGraph],
  );

  const stats = useMemo(
    () => deriveLandingStats(publicGraph, completeness),
    [publicGraph, completeness],
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = (): void => setReducedMotion(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    programNamesRef.current = programNames;
    if (graphRef.current) applyProgramNames(graphRef.current, programNames);
  }, [programNames]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const journey = journeyRef.current;
    if (!canvas || !journey) return;

    if (!graphRef.current) {
      const graph = buildCosmosGraph();
      layoutCosmosGraph(graph);
      graphRef.current = graph;
    }
    const graph = graphRef.current;
    applyProgramNames(graph, programNamesRef.current);

    const renderer = createCosmosRenderer({
      canvas,
      graph,
      fontFamily:
        window.getComputedStyle(journey).fontFamily || 'system-ui, sans-serif',
    });
    const quality = createCosmosQualityGovernor();
    const panels = panelRefs.current;
    const ticks = tickRefs.current;
    const hint = hintRef.current;

    const updatePanels = (p: number): void => {
      for (let i = 0; i < PANEL_COUNT; i += 1) {
        const range = PANEL_RANGES[i];
        const panel = panels[i];
        if (!range || !panel) continue;
        const [a, b] = range;
        const fade = 0.05;
        let o: number;
        if (p < a - fade || p > b + fade) o = 0;
        else if (p < a) o = (p - (a - fade)) / fade;
        else if (p > b) o = 1 - (p - b) / fade;
        else o = 1;
        o = clamp01(o);
        panel.style.opacity = o.toFixed(3);
        panel.style.transform = `translateY(calc(-50% + ${((1 - o) * 22).toFixed(1)}px))`;
        const interactive = o > 0.6;
        panel.style.pointerEvents = interactive ? 'auto' : 'none';
        if (interactive) {
          panel.removeAttribute('aria-hidden');
          panel.removeAttribute('inert');
        } else {
          panel.setAttribute('aria-hidden', 'true');
          panel.setAttribute('inert', '');
        }
        const tick = ticks[i];
        if (tick) {
          tick.classList.toggle(styles.tickOn as string, o > 0.5);
          if (o > 0.5) tick.setAttribute('aria-current', 'step');
          else tick.removeAttribute('aria-current');
        }
      }
      if (hint) hint.style.opacity = clamp01(1 - p / 0.08).toFixed(3);
    };

    if (reducedMotion) {
      for (const panel of panels) {
        if (!panel) continue;
        panel.removeAttribute('aria-hidden');
        panel.removeAttribute('inert');
        panel.style.opacity = '';
        panel.style.transform = '';
        panel.style.pointerEvents = '';
      }
      const paint = (): void => renderer.render(0, 0, 1);
      paint();
      const resizeObserver = new ResizeObserver(paint);
      resizeObserver.observe(canvas);
      return () => {
        resizeObserver.disconnect();
        renderer.dispose();
      };
    }

    let targetP = 0;
    let currentP = 0;
    let frame: number | null = null;
    let visible = true;

    const readScroll = (): void => {
      const total = journey.offsetHeight - window.innerHeight;
      targetP =
        total > 0 ? clamp01(-journey.getBoundingClientRect().top / total) : 0;
    };

    const loop = (t: number): void => {
      frame = window.requestAnimationFrame(loop);
      currentP += (targetP - currentP) * 0.09;
      if (Math.abs(targetP - currentP) < 0.0002) currentP = targetP;
      const startedAt = performance.now();
      renderer.render(currentP, t, quality.qualityScale());
      quality.recordFrame(
        performance.now() - startedAt,
        canvas.clientWidth < 900 ? 33 : 16.7,
      );
      updatePanels(currentP);
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

    readScroll();
    updatePanels(0);
    start();

    const intersectionObserver = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      visible = entry.isIntersecting;
      syncActivity();
    });
    intersectionObserver.observe(journey);
    window.addEventListener('scroll', readScroll, { passive: true });
    window.addEventListener('resize', readScroll);
    document.addEventListener('visibilitychange', syncActivity);

    return () => {
      stop();
      intersectionObserver.disconnect();
      window.removeEventListener('scroll', readScroll);
      window.removeEventListener('resize', readScroll);
      document.removeEventListener('visibilitychange', syncActivity);
      renderer.dispose();
    };
  }, [reducedMotion]);

  const setPanelRef =
    (index: number) =>
    (element: HTMLElement | null): void => {
      panelRefs.current[index] = element;
    };
  const setTickRef =
    (index: number) =>
    (element: HTMLElement | null): void => {
      tickRefs.current[index] = element;
    };

  return (
    <div
      ref={journeyRef}
      id="landing-journey"
      data-motion={reducedMotion ? 'reduce' : 'full'}
      className={styles.journey}
    >
      <div className={styles.stage}>
        <canvas ref={canvasRef} className={styles.sky} aria-hidden="true" />
        <div className={styles.vignette} aria-hidden="true" />
        <div className={styles.scrim} aria-hidden="true" />

        <a className={styles.skip} href={contentAnchor}>
          로그인·프로그램 정보로 건너뛰기
        </a>

        <section
          ref={setPanelRef(0)}
          aria-labelledby="landing-hero-heading"
          className={styles.panel}
          data-panel="0"
        >
          <span className={styles.eyebrow}>전남대학교 SW중심대학사업단</span>
          <h1 id="landing-hero-heading">흩어진 정보를 한 곳으로</h1>
          <p>
            OSS Hub는 오픈소스 작업물을 한 번에 정리해줍니다. 교내 활동, 팀
            프로젝트, 대외 활동 등의 제출 및 검토를 간편하게 만들어줍니다.
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
        </section>

        <section
          ref={setPanelRef(1)}
          aria-labelledby="landing-program-heading"
          className={styles.panel}
          data-panel="1"
        >
          <span className={styles.eyebrow}>프로그램</span>
          <h2 id="landing-program-heading">
            모든 활동은
            <br />
            프로그램 단위로 묶입니다
          </h2>
          <p>
            경진대회·해커톤·기여 챌린지·스터디·세미나와 같은 프로그램들은 학생,
            저장소와 연결되어 관리됩니다.
          </p>
          <ul className={styles.stats}>
            <li>
              <div className={styles.statValue}>{stats.programs}</div>
              <div className={styles.statKey}>공개 프로그램</div>
            </li>
            <li>
              <div className={styles.statValue}>{stats.repositories}</div>
              <div className={styles.statKey}>공개 저장소</div>
            </li>
            <li>
              <div className={styles.statValue}>{stats.students}</div>
              <div className={styles.statKey}>공개 기여자</div>
            </li>
          </ul>
          <span className={styles.statNote}>{stats.note}</span>
        </section>

        <section
          ref={setPanelRef(2)}
          aria-labelledby="landing-flow-heading"
          className={styles.panel}
          data-panel="2"
        >
          <span className={styles.eyebrow}>흐름</span>
          <h2 id="landing-flow-heading">
            신청부터 공개까지,
            <br />
            하나의 흐름
          </h2>
          <p>
            OSS Hub는 GitHub을 대체하지 않습니다. 사업단 GitHub Org 위에 얹혀,
            흩어져 있던 운영 과정을 하나로 연결합니다.
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
          ref={setPanelRef(3)}
          aria-labelledby="landing-activity-heading"
          className={styles.panel}
          data-panel="3"
        >
          <span className={styles.eyebrow}>나의 활동</span>
          <h2 id="landing-activity-heading">
            참여 기록이
            <br />한 곳에 남습니다
          </h2>
          <p>
            참여한 프로그램, 팀, 저장소, 제출 기록을 대시보드에서 확인합니다.
            진행 중인 저장소는 팀과 교직원만 볼 수 있고, 공개는 검토 후 명시적
            승인을 거칩니다.
          </p>
        </section>

        <section
          ref={setPanelRef(4)}
          aria-labelledby="landing-entry-heading"
          className={styles.panel}
          data-panel="4"
        >
          <h2 id="landing-entry-heading">
            지금 OSS Hub에서
            <br />
            시작하세요
          </h2>
          <p>
            GitHub 계정으로 로그인하면 역할에 맞는 화면으로 바로 이동합니다.
          </p>
          <div className={styles.actions}>
            {primaryAction}
            <Link className={styles.ghost} href="/programs">
              프로그램 둘러보기
            </Link>
          </div>
        </section>

        <div className={styles.legend} aria-hidden="true">
          <span>
            <i
              style={{
                width: 8,
                height: 8,
                background: 'var(--cosmos-student)',
              }}
            />
            학생
          </span>
          <span>
            <i
              style={{
                width: 6,
                height: 6,
                background: 'var(--cosmos-repository)',
              }}
            />
            저장소
          </span>
          <span>
            <i
              style={{
                width: 10,
                height: 10,
                background: 'var(--cosmos-copy)',
                boxShadow: '0 0 8px rgba(255,255,255,.9)',
              }}
            />
            프로그램
          </span>
          <span className={styles.legendNote}>예시 구성</span>
        </div>

        <ol className={styles.progress} aria-label="소개 진행 상태">
          {Array.from({ length: PANEL_COUNT }, (_, index) => (
            <li key={index}>
              <span ref={setTickRef(index)} className={styles.tick}>
                <span className="sr-only">{`${index + 1}단계`}</span>
              </span>
            </li>
          ))}
        </ol>

        <div ref={hintRef} className={styles.hint} aria-hidden="true">
          SCROLL
        </div>
      </div>
    </div>
  );
}
