import type { LucideIcon } from 'lucide-react';
import { Activity, Layers, ShieldCheck } from 'lucide-react';

interface FlowStep {
  step: string;
  title: string;
  description: string;
}

// 신청 → 저장소 생성 → 제출·검토 → 공개, GitHub Org 위에 얹힌 운영 흐름
const FLOW_STEPS: FlowStep[] = [
  {
    step: 'STEP 1',
    title: '신청·팀 구성',
    description:
      '프로그램에 지원하고, 팀장이 팀을 만들면 참여코드로 팀원이 합류해요.',
  },
  {
    step: 'STEP 2',
    title: '저장소 자동 생성',
    description:
      '신청이 승인되면 팀 저장소가 자동으로 만들어지고 팀원이 초대돼요.',
  },
  {
    step: 'STEP 3',
    title: '제출·검토',
    description:
      '마일스톤 단위로 제출하고, 교직원이 검토·승인·보완 요청을 진행해요.',
  },
  {
    step: 'STEP 4',
    title: '공개 아카이브',
    description: '검토가 끝난 성과는 공개로 전환되어 연도별 아카이브에 남아요.',
  },
];

interface FlowFeature {
  title: string;
  description: string;
  icon: LucideIcon;
}

const FLOW_FEATURES: FlowFeature[] = [
  {
    title: '활동이 실시간으로 보여요',
    description:
      '커밋, PR, 스타가 GitHub에서 대시보드로 실시간 연결됩니다. 행사 중에도 팀의 활동이 바로 보여요.',
    icon: Activity,
  },
  {
    title: '이력이 자산으로 쌓여요',
    description:
      '참여한 프로그램, 팀, 저장소, 제출 기록이 나의 활동 이력으로 누적되어 언제든 확인할 수 있어요.',
    icon: Layers,
  },
  {
    title: '동의한 범위만 공개돼요',
    description:
      '진행 중 저장소는 팀과 교직원만 볼 수 있고, 공개는 검토 후 명시적 승인을 거쳐야 이뤄집니다.',
    icon: ShieldCheck,
  },
];

export function ProgramFlowSection() {
  return (
    <section className="border-b border-border bg-background">
      <div className="mx-auto max-w-6xl px-8 py-20 lg:py-24">
        <h2 className="text-3xl font-bold tracking-tight text-foreground">
          신청부터 공개까지, 하나의 흐름
        </h2>
        <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          OSS Hub는 GitHub를 대체하지 않아요. 사업단 GitHub Org 위에 얹혀,
          흩어져 있던 운영 과정을 하나로 연결합니다.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FLOW_STEPS.map(({ step, title, description }) => (
            <div
              key={step}
              className="flex flex-col gap-3 border-t-2 border-primary pt-5"
            >
              <span className="text-xs font-bold tracking-[0.06em] text-primary">
                {step}
              </span>
              <h3 className="text-base font-semibold text-foreground">
                {title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FLOW_FEATURES.map(({ title, description, icon: Icon }) => (
            <div
              key={title}
              className="flex flex-col gap-2.5 rounded-xl border border-border bg-muted p-6"
            >
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary/8 text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="text-base font-semibold text-foreground">
                {title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
