'use client';

import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
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
import type { LandingGraph } from '../landing-overview';
import styles from './landing-journey.module.css';
import { useLandingGraph } from './use-landing-graph';

export interface LandingJourneyProps {
  readonly authErrorMessage?: string;
  readonly notice?: ReactNode;
  readonly primaryAction: ReactNode;
  /** 여정이 끝나고 이어지는 일반 페이지 구간의 앵커 */
  readonly contentAnchor?: string;
}

const PANEL_COUNT = 5;
const FLOW_STEPS: readonly (readonly [string, string, string])[] = [
  ['STEP 1', '신청·팀 구성', '— 참여코드로 팀원이 합류'],
  ['STEP 2', '저장소 연결', '— 승인되면 팀 저장소가 열림'],
  ['STEP 3', '제출·검토', '— 마일스톤 단위로 교직원이 검토'],
  ['STEP 4', '공개 아카이브', '— 연도별 아카이브에 남음'],
];

interface GraphCounts {
  readonly programs: number;
  readonly repositories: number;
  readonly students: number;
}

/** 공개 집계가 아직 없을 때 0을 늘어놓지 않는다 — 없는 것은 없다고 표시한다 */
function formatCount(value: number): string {
  return value > 0 ? String(value) : '—';
}

function countByKind(graph: LandingGraph): GraphCounts {
  return {
    programs: graph.nodes.filter((node) => node.kind === 'program').length,
    repositories: graph.nodes.filter((node) => node.kind === 'repository')
      .length,
    students: graph.nodes.filter((node) => node.kind === 'student').length,
  };
}

/** 프로그램 항성의 이름만 공개 프로그램명으로 바꾼다 — 배치는 다시 잡지 않는다 */
function applyProgramNames(
  graph: CosmosGraph,
  names: readonly string[],
): void {
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
  contentAnchor = '#landing-entry',
}: LandingJourneyProps) {
  const journeyRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panelRefs = useRef<(HTMLElement | null)[]>([]);
  const tickRefs = useRef<(HTMLElement | null)[]>([]);
  const hintRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<CosmosGraph | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const { graph: publicGraph } = useLandingGraph();

  const programNamesRef = useRef<readonly string[]>([]);
  const programNames = useMemo(
    () =>
      publicGraph.nodes
        .filter((node) => node.kind === 'program')
        .map((node) => node.label),
    [publicGraph],
  );
  const counts = useMemo(() => countByKind(publicGraph), [publicGraph]);
  const hasCounts =
    counts.programs + counts.repositories + counts.students > 0;
  const statNote = !hasCounts
    ? '공개 집계 준비 중'
    : publicGraph.source === 'public'
      ? '공개 아카이브 기준'
      : '예시 데이터 기준';

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = (): void => setReducedMotion(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  // 공개 프로그램명이 도착하면 항성 라벨만 갈아 끼운다
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
      // 여정 모드에서 붙여 둔 aria-hidden·inert 를 반드시 걷어낸다. 축소 모드는
      // 다섯 장면을 문서 흐름에 모두 펼치는데, 속성이 남아 있으면 눈에는 보이지만
      // 스크린리더와 키보드에는 없는 화면이 된다. 사용자가 도중에 설정을 바꿔
      // 이 분기로 들어오는 경우가 실제로 있다.
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
        total > 0
          ? clamp01(-journey.getBoundingClientRect().top / total)
          : 0;
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
    // programNames 를 의존에 넣으면 공개 데이터가 늦게 도착할 때 renderer 가 다시
    // 만들어져 스크롤 도중 장면이 처음으로 튄다. 라벨 갱신은 위의 별도 effect 담당이다.
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
              className="mt-6 max-w-xl rounded-lg border border-cosmos-border bg-cosmos-muted/10 px-4 py-3 text-sm leading-relaxed text-cosmos-muted"
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
              <div className={styles.statValue}>
                {formatCount(counts.programs)}
              </div>
              <div className={styles.statKey}>공개 프로그램</div>
            </li>
            <li>
              <div className={styles.statValue}>
                {formatCount(counts.repositories)}
              </div>
              <div className={styles.statKey}>공개 저장소</div>
            </li>
            <li>
              <div className={styles.statValue}>
                {formatCount(counts.students)}
              </div>
              <div className={styles.statKey}>공개 기여자</div>
            </li>
          </ul>
          <span className={styles.statNote}>{statNote}</span>
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
            <br />
            한 곳에 남습니다
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
            <i style={{ width: 8, height: 8, background: '#9db9f0' }} />
            학생
          </span>
          <span>
            <i style={{ width: 6, height: 6, background: '#5cc687' }} />
            저장소
          </span>
          <span>
            <i
              style={{
                width: 10,
                height: 10,
                background: '#fff',
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
