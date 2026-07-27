import type { LucideIcon } from 'lucide-react';
import { Briefcase, CircleCheck, GraduationCap } from 'lucide-react';

interface RolePath {
  role: string;
  tagline: string;
  icon: LucideIcon;
  items: string[];
  /** 교직원처럼 별도 안내가 필요한 역할만 채운다 */
  footnote?: string;
}

const ROLE_PATHS: RolePath[] = [
  {
    role: '학생',
    tagline: '참여자로서 이런 걸 할 수 있어요',
    icon: GraduationCap,
    items: [
      '관심 있는 프로그램을 둘러보고 지원해요',
      '팀을 만들고 저장소를 자동으로 연결해요',
      '참여 이력을 나의 활동으로 남겨요',
    ],
  },
  {
    role: '교직원',
    tagline: '운영자로서 이런 걸 할 수 있어요',
    icon: Briefcase,
    items: [
      '프로그램을 개설하고 모집 정보를 관리해요',
      '지원자를 확인하고 심사를 진행해요',
      '마일스톤 제출을 검토하고 성과를 공개해요',
    ],
    footnote: '교직원 계정은 관리자 승인 후 사용할 수 있어요.',
  },
];

export function RolePathSection() {
  return (
    <section
      aria-labelledby="role-paths-heading"
      className="border-b border-border bg-muted"
    >
      <div className="mx-auto max-w-6xl px-8 py-20 lg:py-24">
        <h2
          id="role-paths-heading"
          className="text-3xl font-bold tracking-tight text-foreground"
        >
          역할에 따라 다르게 쓰는 OSS Hub
        </h2>
        <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-muted-foreground">
          학생과 교직원 모두 자신의 역할에 맞는 화면과 기능을 사용합니다.
        </p>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {ROLE_PATHS.map(({ role, tagline, icon: Icon, items, footnote }) => (
            <div
              key={role}
              className="flex flex-col gap-5 rounded-xl border border-border bg-card p-7"
            >
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <Icon className="size-5" aria-hidden />
                </span>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">
                    {role}
                  </h3>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {tagline}
                  </p>
                </div>
              </div>

              <ul className="flex list-none flex-col gap-2.5 p-0">
                {items.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2 text-sm leading-relaxed text-foreground"
                  >
                    <CircleCheck
                      className="mt-0.5 size-4 shrink-0 text-accent"
                      aria-hidden
                    />
                    {item}
                  </li>
                ))}
              </ul>

              {footnote ? (
                <p className="border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
                  {footnote}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
