import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  GitPullRequest,
  Presentation,
  Rocket,
  Trophy,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface ProgramType {
  title: string;
  description: string;
  icon: LucideIcon;
}

const PROGRAM_TYPES: ProgramType[] = [
  {
    title: "경진대회",
    description: "아이디어와 결과물로 실력을 겨루는 프로그램입니다.",
    icon: Trophy,
  },
  {
    title: "해커톤",
    description: "짧은 기간 몰입해 프로토타입을 만드는 프로그램입니다.",
    icon: Rocket,
  },
  {
    title: "오픈소스 기여 챌린지",
    description: "실제 오픈소스 프로젝트에 기여하며 경험을 쌓는 프로그램입니다.",
    icon: GitPullRequest,
  },
  {
    title: "스터디",
    description: "정해진 주제를 함께 배우고 나누는 정기 모임입니다.",
    icon: BookOpen,
  },
  {
    title: "세미나·워크숍",
    description: "발표와 실습으로 지식과 경험을 나누는 자리입니다.",
    icon: Presentation,
  },
];

export function ProgramTypeSection() {
  return (
    <section
      id="program-types"
      aria-labelledby="program-types-heading"
      className="scroll-mt-16 border-b border-border bg-background"
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24 lg:px-8">
        <div className="max-w-2xl">
          <h2
            id="program-types-heading"
            className="text-2xl font-bold tracking-tight text-foreground md:text-3xl"
          >
            함께 열 수 있는 프로그램 유형
          </h2>
          <p className="mt-2 text-sm leading-normal text-muted-foreground md:text-base">
            경진대회와 해커톤을 중심으로, 다양한 방식의 오픈소스 활동을
            지원합니다.
          </p>
        </div>

        <ul className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROGRAM_TYPES.map(({ title, description, icon: Icon }, index) => (
            <li
              key={title}
              className="animate-in fade-in slide-in-from-bottom-4 fill-mode-both duration-700 motion-reduce:animate-none"
              style={{ animationDelay: `${index * 80}ms` }}
            >
              <Card className="h-full transition-all duration-300 hover:-translate-y-1 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0">
                <CardContent className="flex h-full flex-col gap-3">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <h3 className="text-base font-semibold text-foreground">
                    {title}
                  </h3>
                  <p className="text-sm leading-normal text-muted-foreground">
                    {description}
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
