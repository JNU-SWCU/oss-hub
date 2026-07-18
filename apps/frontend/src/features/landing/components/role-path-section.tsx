import type { LucideIcon } from "lucide-react";
import { Briefcase, CheckCircle2, GraduationCap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface RolePath {
  role: string;
  tagline: string;
  icon: LucideIcon;
  items: string[];
  enterFrom: string;
}

const ROLE_PATHS: RolePath[] = [
  {
    role: "학생",
    tagline: "참여자로서 이런 걸 할 수 있어요",
    icon: GraduationCap,
    items: [
      "관심 있는 프로그램을 둘러보고 지원해요",
      "지원 현황과 결과를 한눈에 확인해요",
      "참여 이력을 나의 활동으로 남겨요",
    ],
    enterFrom: "slide-in-from-left-6",
  },
  {
    role: "교직원",
    tagline: "운영자로서 이런 걸 할 수 있어요",
    icon: Briefcase,
    items: [
      "프로그램을 개설하고 모집 정보를 관리해요",
      "지원자를 확인하고 심사를 진행해요",
      "운영 현황과 결과를 정리해요",
    ],
    enterFrom: "slide-in-from-right-6",
  },
];

export function RolePathSection() {
  return (
    <section
      aria-labelledby="role-paths-heading"
      className="border-b border-border bg-muted/40"
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24 lg:px-8">
        <div className="max-w-2xl">
          <h2
            id="role-paths-heading"
            className="text-2xl font-bold tracking-tight text-foreground md:text-3xl"
          >
            역할에 따라 다르게 쓰는 OSS Hub
          </h2>
          <p className="mt-2 text-sm leading-normal text-muted-foreground md:text-base">
            학생과 교직원 모두 자신의 역할에 맞는 화면과 기능을 사용합니다.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2">
          {ROLE_PATHS.map(({ role, tagline, icon: Icon, items, enterFrom }) => (
            <Card
              key={role}
              className={cn(
                "animate-in fade-in fill-mode-both duration-700 motion-reduce:animate-none",
                enterFrom,
              )}
            >
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">
                      {role}
                    </h3>
                    <p className="text-sm text-muted-foreground">{tagline}</p>
                  </div>
                </div>

                <ul className="flex flex-col gap-2.5">
                  {items.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-2 text-sm leading-normal text-foreground"
                    >
                      <CheckCircle2
                        className="mt-0.5 size-4 shrink-0 text-accent"
                        aria-hidden="true"
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
