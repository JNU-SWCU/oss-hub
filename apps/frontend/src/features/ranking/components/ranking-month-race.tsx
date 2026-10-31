'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type {
  MonthRace,
  MonthRacer,
  PodiumBox,
  Rhythm,
} from './ranking-insights-model';
import styles from './ranking-insights.module.css';

const PODIUM_ORDER = [2, 1, 3] as const;
const PODIUM_BOX_CLASS: Record<number, string | undefined> = {
  1: styles.podiumBox1,
  2: styles.podiumBox2,
  3: styles.podiumBox3,
};
const PODIUM_COLUMN_CLASS: Record<number, string | undefined> = {
  1: styles.podiumColumn2,
  2: styles.podiumColumn1,
  3: styles.podiumColumn3,
};
const PODIUM_NAME_LIMIT = 1;
const PODIUM_LOGIN_TAIL = 4;
const CONFETTI = [
  { left: 6, delay: 0, tilt: -18 },
  { left: 14, delay: 120, tilt: 24 },
  { left: 23, delay: 60, tilt: -8 },
  { left: 31, delay: 220, tilt: 32 },
  { left: 39, delay: 30, tilt: -26 },
  { left: 47, delay: 160, tilt: 12 },
  { left: 55, delay: 90, tilt: -34 },
  { left: 63, delay: 240, tilt: 20 },
  { left: 71, delay: 50, tilt: -14 },
  { left: 79, delay: 180, tilt: 28 },
  { left: 87, delay: 110, tilt: -22 },
  { left: 94, delay: 200, tilt: 16 },
] as const;
const CONFETTI_INKS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];
const SPARKS = [
  { x: 4, y: 6 },
  { x: 30, y: 2 },
  { x: 56, y: 8 },
  { x: 16, y: 20 },
  { x: 44, y: 22 },
];
const CROWN_PATH = 'M2 11 L1 4 L5 7 L9 1 L13 7 L17 4 L16 11 Z';
const STAR_PATH =
  'M0 -5 L1.4 -1.6 L5 -1.3 L2.2 1 L3 4.6 L0 2.7 L-3 4.6 L-2.2 1 L-5 -1.3 L-1.4 -1.6 Z';
const RHYTHM_STEP = 26;
const RHYTHM_BAR = 14;
const RHYTHM_HEIGHT = 56;
const RHYTHM_BASE = 44;
const RHYTHM_TOP = 10;
const RUNNERS = [0, 1, 2, 3, 4] as const;
const RUNNER_STEP = 18;
const RUNNER_LIFT = 7;

function Crown({ className }: { readonly className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn(styles.crownDoodle, className)}
      width={18}
      height={12}
      viewBox="0 0 18 12"
      focusable="false"
    >
      <path d={CROWN_PATH} />
    </svg>
  );
}

function ClimbArrow() {
  return (
    <svg
      aria-hidden="true"
      className={styles.climbArrow}
      width={12}
      height={16}
      viewBox="0 0 12 16"
      focusable="false"
    >
      <path d="M6 15 L6 2" />
      <path d="M1.5 6.5 L6 1.5 L10.5 6.5" />
    </svg>
  );
}

function scoreText(racer: MonthRacer, estimated: boolean): string {
  return `+${String(racer.score)}${estimated ? '*' : ''}점`;
}

interface PodiumName {
  readonly head: string;
  readonly tail: string;
  readonly full: string;
}

function podiumName(box: PodiumBox): PodiumName {
  const mine = box.members.find((member) => member.isViewer);
  const lead = mine ?? box.members[0];
  if (lead === undefined) return { head: '', tail: '', full: '' };
  const shown = lead.isViewer ? `나 · @${lead.login}` : `@${lead.login}`;
  const rest = box.members.length - PODIUM_NAME_LIMIT;
  const others = rest > 0 ? ` 외 ${String(rest)}명` : '';
  const keep = Math.min(PODIUM_LOGIN_TAIL, lead.login.length);
  return {
    head: shown.slice(0, shown.length - keep),
    tail: `${shown.slice(shown.length - keep)}${others}`,
    full: `${shown}${others}`,
  };
}

function PodiumLogin({ box }: { readonly box: PodiumBox }) {
  const name = podiumName(box);
  return (
    <span data-podium-login="" className={styles.podiumLogin} title={name.full}>
      <span aria-hidden="true" className={styles.podiumLoginHead}>
        {name.head}
      </span>
      <span aria-hidden="true" className={styles.podiumLoginTail}>
        {name.tail}
      </span>
      <span className="sr-only">{name.full}</span>
    </span>
  );
}

function Confetti({ run }: { readonly run: number }) {
  return (
    <div key={run} aria-hidden="true" className={styles.confetti}>
      {CONFETTI.map((piece, index) => (
        <span
          key={`confetti-${String(index)}`}
          className={styles.confettiPiece}
          style={{
            left: `${String(piece.left)}%`,
            animationDelay: `${String(piece.delay)}ms`,
            backgroundColor: CONFETTI_INKS[index % CONFETTI_INKS.length],
            rotate: `${String(piece.tilt)}deg`,
          }}
        />
      ))}
      <svg
        className={styles.sparks}
        width={64}
        height={28}
        viewBox="0 0 64 28"
        focusable="false"
      >
        {SPARKS.map((spark, index) => (
          <path
            key={`spark-${String(index)}`}
            d={STAR_PATH}
            transform={`translate(${String(spark.x)}, ${String(spark.y)}) scale(0.8)`}
          />
        ))}
      </svg>
    </div>
  );
}

function Podium({
  race,
  run,
}: {
  readonly race: MonthRace;
  readonly run: number;
}) {
  const champion = race.podium.find((box) => box.rank === 1) ?? null;
  const celebrate =
    champion !== null && champion.members.some((member) => member.isViewer);
  return (
    <div className={styles.podiumWrap}>
      {celebrate ? <Confetti run={run} /> : null}
      <ol className={styles.podium}>
        {PODIUM_ORDER.map((rank) => {
          const box = race.podium.find((entry) => entry.rank === rank) ?? null;
          const leader = box?.members[0];
          if (box === null || leader === undefined) {
            return (
              <li
                key={`podium-empty-${String(rank)}`}
                aria-hidden="true"
                className={cn(
                  styles.podiumSlot,
                  PODIUM_COLUMN_CLASS[rank],
                  styles.podiumSlotEmpty,
                )}
              >
                <p className={styles.podiumTag}>
                  <span className={styles.podiumEmptyNote}>비어 있음</span>
                </p>
                <div className={cn(styles.podiumBox, PODIUM_BOX_CLASS[rank])}>
                  <span className={styles.podiumRank}>
                    {`${String(rank)}위`}
                  </span>
                </div>
              </li>
            );
          }
          const mine = box.members.some((member) => member.isViewer);
          return (
            <li
              key={`podium-${String(rank)}`}
              data-podium-rank={rank}
              {...(mine ? { 'data-podium-viewer': '' } : {})}
              className={cn(
                styles.podiumSlot,
                PODIUM_COLUMN_CLASS[rank],
                mine && styles.podiumSlotMine,
              )}
            >
              <p className={styles.podiumTag}>
                {rank === 1 ? <Crown /> : null}
                <PodiumLogin box={box} />
                <span className={styles.podiumScore}>
                  {scoreText(leader, race.estimated)}
                </span>
                {box.members.some((member) => member.isViewer) &&
                race.rhythm?.comeback === true ? (
                  <span data-comeback="" className={styles.sticker}>
                    컴백!
                  </span>
                ) : null}
              </p>
              <div className={cn(styles.podiumBox, PODIUM_BOX_CLASS[rank])}>
                <span className={styles.podiumRank}>{`${String(rank)}위`}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Standings({ race }: { readonly race: MonthRace }) {
  const top = race.racers[0]?.score ?? 0;
  return (
    <ol className={styles.standings}>
      {race.standings.map((entry, index) =>
        entry.kind === 'gap' ? (
          <li key={`gap-${String(index)}`} className={styles.gapChip}>
            {`… ${String(entry.count)}명 더`}
          </li>
        ) : (
          <li
            key={`row-${entry.racer.login}`}
            data-rank-row={entry.racer.rank}
            {...(entry.racer.isViewer ? { 'data-rank-row-viewer': '' } : {})}
            className={cn(
              styles.rankRow,
              entry.racer.isViewer && styles.rankRowMine,
            )}
          >
            <span className={styles.rowRank}>
              {`${String(entry.racer.rank)}위`}
            </span>
            <span className={styles.rowLogin}>
              {entry.racer.isViewer
                ? `나 · @${entry.racer.login}`
                : `@${entry.racer.login}`}
              {entry.racer.isDebut ? (
                <span className={styles.rowBadge}>신입</span>
              ) : null}
              {entry.racer.isViewer && race.rhythm?.comeback === true ? (
                <span data-comeback="" className={styles.sticker}>
                  컴백!
                </span>
              ) : null}
            </span>
            <span aria-hidden="true" className={styles.rowTrack}>
              <span
                className={styles.rowBar}
                style={{
                  width: `${String(top === 0 ? 0 : Math.round((entry.racer.score / top) * 100))}%`,
                }}
              />
            </span>
            <span className={styles.rowScore}>
              {scoreText(entry.racer, race.estimated)}
            </span>
          </li>
        ),
      )}
    </ol>
  );
}

function StartLine({ race }: { readonly race: MonthRace }) {
  return (
    <div data-startline="" className={styles.startline}>
      <svg
        aria-hidden="true"
        className={styles.startlineInk}
        width={RUNNERS.length * RUNNER_STEP + 24}
        height={48}
        viewBox={`0 0 ${String(RUNNERS.length * RUNNER_STEP + 24)} 48`}
        focusable="false"
      >
        <path className={styles.startlineRule} d="M10 4 L10 44" />
        {RUNNERS.map((index) => (
          <circle
            key={`runner-${String(index)}`}
            className={styles.runner}
            cx={22 + index * RUNNER_STEP}
            cy={24 + (index % 2 === 0 ? -RUNNER_LIFT : RUNNER_LIFT)}
            r={5}
            style={{ animationDelay: `${String(index * 160)}ms` }}
          />
        ))}
      </svg>
      <p className={styles.startlineCopy}>
        새 달 출발선입니다. 이번 달 첫 점수의 주인공은?
      </p>
      <p className={styles.panelNote}>
        {`출발 대기 ${String(race.racers.length)}명 · 매달 1일 0점에서 다시 출발`}
      </p>
    </div>
  );
}

function NudgeRow({ race }: { readonly race: MonthRace }) {
  const nudge = race.nudge;
  if (nudge === null) return null;
  if (nudge.kind === 'climb') {
    return (
      <p
        aria-live="polite"
        data-nudge={nudge.gap}
        className={cn(styles.nudge, styles.nudgeClimb)}
      >
        <ClimbArrow />
        {`${String(nudge.gap)}점 더 하면 한 칸 위 — @${nudge.next}와 ${String(nudge.gap)}점 차`}
      </p>
    );
  }
  if (nudge.kind === 'lead') {
    return (
      <p aria-live="polite" className={cn(styles.nudge, styles.nudgeLead)}>
        <Crown />
        {nudge.gap === null
          ? '선두! 아직 경쟁자가 없어요'
          : nudge.gap === 0
            ? '공동 선두! 2위와 같은 점수'
            : `선두! 2위와 ${String(nudge.gap)}점 차`}
      </p>
    );
  }
  return (
    <p aria-live="polite" className={cn(styles.nudge, styles.nudgeStart)}>
      {race.startline
        ? '1점이면 바로 출발 — 첫 점수의 주인공이 될 수 있어요'
        : `1점이면 바로 출발 — 지금 꼴찌 아님, 출발 전! (공동 ${String(nudge.rank)}위)`}
    </p>
  );
}

function RhythmRow({
  rhythm,
  run,
}: {
  readonly rhythm: Rhythm;
  readonly run: number;
}) {
  const width = rhythm.bars.length * RHYTHM_STEP + 8;
  const span = RHYTHM_BASE - RHYTHM_TOP;
  return (
    <div className={styles.rhythmWrap}>
      <p className={styles.sectionLabel}>
        내 활동 리듬
        {rhythm.personalBest ? (
          <span data-personal-best="" className={styles.sticker}>
            올해 최고 기록!
          </span>
        ) : null}
      </p>
      {rhythm.empty ? (
        <p className={styles.panelNote}>아직 기록이 없어요</p>
      ) : (
        <>
          <svg
            key={run}
            aria-hidden="true"
            className={cn(
              styles.rhythm,
              rhythm.personalBest && styles.rhythmBest,
            )}
            width={width}
            height={RHYTHM_HEIGHT}
            viewBox={`0 0 ${String(width)} ${String(RHYTHM_HEIGHT)}`}
            focusable="false"
          >
            <path
              className={styles.rhythmBase}
              d={`M4 ${String(RHYTHM_BASE)} H${String(width - 4)}`}
            />
            {rhythm.bars.map((bar) => {
              const left = 6 + bar.index * RHYTHM_STEP;
              const center = left + RHYTHM_BAR / 2;
              if (bar.value === null) {
                return (
                  <g key={`bar-${String(bar.index)}`}>
                    <circle
                      className={styles.rhythmPending}
                      cx={center}
                      cy={RHYTHM_BASE - 6}
                      r={1.6}
                    />
                    <text
                      className={styles.rhythmMonth}
                      x={center}
                      y={RHYTHM_HEIGHT - 2}
                      textAnchor="middle"
                    >
                      {bar.month.replace('월', '')}
                    </text>
                  </g>
                );
              }
              const height =
                rhythm.max === 0
                  ? 0
                  : Math.round((bar.value / rhythm.max) * span);
              return (
                <g
                  key={`bar-${String(bar.index)}`}
                  data-month-bar={bar.index}
                  {...(bar.isMax ? { 'data-month-bar-max': '' } : {})}
                >
                  {height === 0 ? (
                    <path
                      className={styles.rhythmZero}
                      d={`M${String(left)} ${String(RHYTHM_BASE)} h${String(RHYTHM_BAR)}`}
                    />
                  ) : (
                    <rect
                      className={cn(
                        styles.rhythmBar,
                        bar.isCurrent && styles.rhythmBarNow,
                      )}
                      x={left}
                      y={RHYTHM_BASE - height}
                      width={RHYTHM_BAR}
                      height={height}
                      rx={2}
                    />
                  )}
                  {bar.isMax ? (
                    <path
                      className={styles.rhythmStar}
                      d={STAR_PATH}
                      transform={`translate(${String(center)}, ${String(RHYTHM_BASE - height - 7)}) scale(0.7)`}
                    />
                  ) : null}
                  <text
                    className={styles.rhythmMonth}
                    x={center}
                    y={RHYTHM_HEIGHT - 2}
                    textAnchor="middle"
                  >
                    {bar.month.replace('월', '')}
                  </text>
                </g>
              );
            })}
          </svg>
          <p className={styles.panelNote}>
            {`가장 뜨거웠던 달: ${rhythm.maxMonth ?? '—'} (+${String(rhythm.max)}점)${rhythm.tiedMax ? ' (공동)' : ''}`}
          </p>
        </>
      )}
    </div>
  );
}

export function RankingMonthRace({
  race,
  active,
}: {
  readonly race: MonthRace;
  readonly active: boolean;
}) {
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (active) setRun((current) => current + 1);
  }, [active]);

  return (
    <div className={styles.panelBody}>
      <div className={styles.panelHeader}>
        <p className={styles.panelTitle}>
          <em className={styles.hl}>{race.month}</em> 레이스
        </p>
        <p className={styles.panelLede}>
          {`${race.day}일 기준 · 매달 1일 0점에서 다시 출발`}
        </p>
      </div>
      {race.startline ? (
        <StartLine race={race} />
      ) : (
        <>
          <Podium race={race} run={run} />
          <Standings race={race} />
        </>
      )}
      <NudgeRow race={race} />
      {race.rhythm === null ? null : (
        <RhythmRow rhythm={race.rhythm} run={run} />
      )}
      <p className={styles.panelNote}>
        {[
          `참가 ${String(race.racers.length)}명`,
          ...(race.zeroCount > 0
            ? [`출발 전 ${String(race.zeroCount)}명`]
            : []),
          ...(race.pendingCount > 0
            ? [`집계 전 ${String(race.pendingCount)}명`]
            : []),
        ].join(' · ')}
      </p>
      {race.debutShown ? (
        <p className={styles.panelNote}>
          중간 합류자의 첫 달 점수에는 합류 이전 올해 활동이 포함될 수 있어요.
        </p>
      ) : null}
      {race.estimated ? (
        <p data-star-estimated-note className={styles.panelNote}>
          * 표시된 달의 Star 수치는 추정값입니다.
        </p>
      ) : null}
      <p className="sr-only">{race.summary}</p>
    </div>
  );
}
