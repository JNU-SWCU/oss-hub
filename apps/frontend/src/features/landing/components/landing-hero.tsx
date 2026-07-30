import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { HeroGraph } from './hero-graph';
import { HERO_NODE_COLORS } from './hero-node-colors';

interface LandingHeroProps {
  authErrorMessage?: string;
  /**
   * 실패가 아닌 안내(예: 로그아웃 완료). `role="status"`로 렌더해 오류와 구분한다 —
   * 스크린 리더에서 둘이 같은 긴급도로 읽히면 실제 오류의 신호가 희석된다.
   */
  notice?: ReactNode;
  primaryAction: ReactNode;
}

interface LegendItem {
  label: string;
  color: string;
  size: string;
  /** 장식용 발광 그림자만 예외적으로 항목별 리터럴을 허용한다 */
  glow?: string;
}

const LEGEND_ITEMS: LegendItem[] = [
  { label: '학생', color: HERO_NODE_COLORS.student, size: 'size-2' },
  { label: '저장소', color: HERO_NODE_COLORS.repository, size: 'size-1.5' },
  {
    label: '프로그램',
    color: HERO_NODE_COLORS.program,
    size: 'size-2.5',
    glow: 'shadow-[0_0_8px_rgba(255,255,255,0.9)]',
  },
];

export function LandingHero({
  authErrorMessage,
  notice,
  primaryAction,
}: LandingHeroProps) {
  return (
    <section
      aria-labelledby="landing-hero-heading"
      className="relative isolate overflow-hidden bg-linear-to-b from-hero-from via-hero-via to-hero-to text-hero-foreground"
    >
      <HeroGraph />

      <div className="relative z-10 mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-24 sm:px-6 lg:px-8 lg:py-28">
        <span className="rounded-full border border-hero-border bg-hero-muted/10 px-3.5 py-1.5 text-xs font-semibold tracking-[0.08em] text-hero-muted">
          JNU OSS PLATFORM
        </span>

        <h1
          id="landing-hero-heading"
          className="max-w-3xl text-4xl font-extrabold leading-[1.15] tracking-tight sm:text-5xl"
        >
          학생과 저장소, 프로그램이
          <br />
          별처럼 이어지는 곳
        </h1>

        <p className="max-w-2xl text-lg leading-relaxed text-hero-muted">
          OSS Hub는 전남대학교 SW중심대학사업단의 오픈소스 활동을 하나의
          그래프로 연결합니다. 프로그램에 참여하고, 기여하고, 나의 별자리를
          만들어 보세요.
        </p>

        {authErrorMessage ? (
          <Alert className="max-w-2xl border-hero-danger/40 bg-hero-danger/10 text-hero-danger">
            <CircleAlert aria-hidden="true" />
            <AlertDescription className="text-hero-danger">
              {authErrorMessage}
            </AlertDescription>
          </Alert>
        ) : null}

        {notice ? (
          <div
            role="status"
            className="max-w-2xl rounded-lg border border-hero-border bg-hero-muted/10 px-4 py-3 text-sm leading-relaxed text-hero-muted"
          >
            {notice}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-5 pt-2">
          {primaryAction}
          <a
            href="#program-types"
            className="text-sm font-medium text-hero-foreground/85 underline underline-offset-4 hover:text-hero-foreground"
          >
            프로그램 유형 살펴보기
          </a>
        </div>
      </div>

      {/* 범례 — 캔버스 위 점 색상이 무엇을 뜻하는지 알려주는 보조 표시, 좁은 화면에서는 숨김.
          점 색은 hero-node-colors.ts의 HERO_NODE_COLORS를 그대로 참조한다 — 캔버스 색이 바뀌면
          범례도 같이 바뀌어야 하므로 리터럴을 여기 별도로 두지 않는다. */}
      <div className="absolute right-8 bottom-6 z-10 hidden items-center gap-4 rounded-full border border-hero-border bg-hero-from/55 px-3.5 py-2 text-xs text-hero-muted md:flex">
        {LEGEND_ITEMS.map(({ label, color, size, glow }) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <span
              className={`${size} rounded-full${glow ? ` ${glow}` : ''}`}
              style={{ backgroundColor: color }}
            />
            {label}
          </span>
        ))}
      </div>
    </section>
  );
}
