'use client';

import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  buildCosmosGraph,
  createCosmosQualityGovernor,
  createCosmosRenderer,
  layoutCosmosGraph,
  type CosmosGraph,
} from '@/features/landing/cosmos';
import { deriveLandingStats } from '../landing-stats';
import styles from './landing-journey.module.css';
import { useRevealOnce } from './landing-reveal';
import { useLandingGraph } from './use-landing-graph';

export interface LandingJourneyProps {
  readonly authErrorMessage?: string;
  readonly notice?: ReactNode;
  readonly primaryAction: ReactNode;

  readonly contentAnchor?: string;
}

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
  const heroRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const graphRef = useRef<CosmosGraph | null>(null);
  const revealRef = useRevealOnce();
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
    programNamesRef.current = programNames;
    if (graphRef.current) applyProgramNames(graphRef.current, programNames);
  }, [programNames]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const hero = heroRef.current;
    if (!canvas || !hero) return;

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
        window.getComputedStyle(hero).fontFamily || 'system-ui, sans-serif',
    });
    const quality = createCosmosQualityGovernor();

    let frame: number | null = null;
    let visible = true;

    const loop = (t: number): void => {
      frame = window.requestAnimationFrame(loop);
      const startedAt = performance.now();
      renderer.render(0, t, quality.qualityScale());
      quality.recordFrame(
        performance.now() - startedAt,
        canvas.clientWidth < 900 ? 33 : 16.7,
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

    const intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) visible = entry.isIntersecting;
      syncActivity();
    });
    intersectionObserver.observe(hero);
    document.addEventListener('visibilitychange', syncActivity);

    return () => {
      stop();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', syncActivity);
      renderer.dispose();
    };
  }, []);

  return (
    <div id="landing-journey" className={styles.journey}>
      <section
        ref={heroRef}
        id="landing-hero"
        aria-labelledby="landing-hero-heading"
        className={styles.hero}
      >
        <canvas ref={canvasRef} className={styles.sky} aria-hidden="true" />
        <div className={styles.vignette} aria-hidden="true" />
        <div className={styles.scrim} aria-hidden="true" />

        <a className={styles.skip} href={contentAnchor}>
          프로그램 정보로 건너뛰기
        </a>

        <div className={styles.heroCopy}>
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
        </div>

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
      </section>

      <section
        ref={revealRef}
        aria-labelledby="landing-program-heading"
        className={styles.story}
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
        ref={revealRef}
        aria-labelledby="landing-flow-heading"
        className={styles.story}
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
        ref={revealRef}
        aria-labelledby="landing-activity-heading"
        className={styles.story}
      >
        <span className={styles.eyebrow}>나의 활동</span>
        <h2 id="landing-activity-heading">
          참여 기록이
          <br />한 곳에 남습니다
        </h2>
        <p>
          참여한 프로그램, 팀, 저장소, 제출 기록을 대시보드에서 확인합니다. 진행
          중인 저장소는 팀과 교직원만 볼 수 있고, 공개는 검토 후 명시적 승인을
          거칩니다.
        </p>
      </section>
    </div>
  );
}
