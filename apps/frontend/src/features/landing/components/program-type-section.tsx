import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  GitPullRequest,
  Presentation,
  Rocket,
  Trophy,
} from 'lucide-react';

interface ProgramType {
  title: string;
  description: string;
  icon: LucideIcon;
}

const PROGRAM_TYPES: ProgramType[] = [
  {
    title: '경진대회',
    description: '아이디어와 결과물로 실력을 겨루는 프로그램입니다.',
    icon: Trophy,
  },
  {
    title: '해커톤',
    description: '짧은 기간 몰입해 프로토타입을 만드는 프로그램입니다.',
    icon: Rocket,
  },
  {
    title: '오픈소스 기여 챌린지',
    description:
      '실제 오픈소스 프로젝트에 기여하며 경험을 쌓는 프로그램입니다.',
    icon: GitPullRequest,
  },
  {
    title: '스터디',
    description: '정해진 주제를 함께 배우고 나누는 정기 모임입니다.',
    icon: BookOpen,
  },
  {
    title: '세미나·워크숍',
    description: '발표와 실습으로 지식과 경험을 나누는 자리입니다.',
    icon: Presentation,
  },
];

export function ProgramTypeSection() {
  return (
    <section
      id="program-types"
      aria-labelledby="program-types-heading"
      className="border-b border-border bg-background"
    >
      <div className="mx-auto max-w-6xl px-8 py-20 lg:py-24">
        <h2
          id="program-types-heading"
          className="text-3xl font-bold tracking-tight text-foreground"
        >
          함께 열 수 있는 프로그램 유형
        </h2>
        <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-muted-foreground">
          경진대회와 해커톤을 중심으로, 다양한 방식의 오픈소스 활동을
          지원합니다.
        </p>

        <ul className="mt-10 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {PROGRAM_TYPES.map(({ title, description, icon: Icon }) => (
            <li
              key={title}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-6 transition-shadow hover:shadow-md"
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
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
