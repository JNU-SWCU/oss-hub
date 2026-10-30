'use client';

import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { CosmosProgram } from '../cosmos';
import type { LandingStatsDisplay } from '../landing-stats';
import { CosmosPoster } from './cosmos-poster';
import styles from './landing-journey.module.css';
import { useRevealOnce } from './landing-reveal';
import { useCosmosCanvas } from './use-cosmos-canvas';

export interface LandingJourneyProps {
  readonly authErrorMessage?: string;
  readonly primaryAction?: ReactNode;
  readonly starPrograms: readonly CosmosProgram[];
  readonly stats: LandingStatsDisplay;
  readonly contentAnchor?: string;
}

const FLOW_STEPS: readonly (readonly [string, string, string])[] = [
  ['STEP 1', '신청·팀 구성', '초대를 수락해 팀에 합류'],
  ['STEP 2', '저장소 연결', '승인되면 팀 저장소가 열림'],
  ['STEP 3', '제출·검토', '마일스톤 단위로 교직원이 검토'],
  ['STEP 4', '공개 프로젝트', '승인되면 누구나 볼 수 있음'],
];

export function LandingJourney({
  authErrorMessage,
  primaryAction,
  starPrograms,
  stats,
  contentAnchor = '#current-programs',
}: LandingJourneyProps) {
  const { journeyRef, skyRef, canvasRef, focus } =
    useCosmosCanvas(starPrograms);
  const revealRef = useRevealOnce();
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
            <div className={styles.flow} data-focus="flow">
              <h3 id="landing-flow-heading" className={styles.flowHeading}>
                신청부터 공개까지, 하나의 흐름
              </h3>
              <ol
                className={styles.steps}
                aria-labelledby="landing-flow-heading"
              >
                {FLOW_STEPS.map(([no, title, description]) => (
                  <li key={no} className={styles.step}>
                    <span className={styles.stepNo}>{no}</span>
                    <span className={styles.stepTitle}>{title}</span>
                    <span className={styles.stepDesc}>{description}</span>
                  </li>
                ))}
              </ol>
            </div>
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
                02
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
          <div className={styles.skyStage}>
            <CosmosPoster programs={starPrograms} />
            <canvas ref={canvasRef} className={styles.sky} />
          </div>
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
