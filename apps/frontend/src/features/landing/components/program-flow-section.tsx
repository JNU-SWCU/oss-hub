interface FlowStep {
  readonly step: string;
  readonly title: string;
  readonly description: string;
}

const FLOW_STEPS: readonly FlowStep[] = [
  {
    step: '01',
    title: '신청',
    description: '프로그램 조건을 확인한 뒤 지원합니다.',
  },
  {
    step: '02',
    title: '팀 구성',
    description: '팀을 만들거나 참여 코드로 합류합니다.',
  },
  {
    step: '03',
    title: '저장소 연결',
    description: '승인된 팀의 GitHub 저장소를 연결합니다.',
  },
  {
    step: '04',
    title: '제출',
    description: '요구사항에 맞춰 제출합니다.',
  },
] as const;

export function ProgramFlowSection() {
  return (
    <section
      aria-labelledby="program-flow-heading"
      className="border-b border-border bg-background"
    >
      <div className="mx-auto max-w-6xl px-6 py-16 sm:px-8 lg:py-20">
        <p className="text-sm font-semibold text-primary">참여 절차</p>
        <h2
          id="program-flow-heading"
          className="mt-2 break-keep text-3xl font-bold tracking-tight text-foreground"
        >
          참여는 이렇게 진행됩니다
        </h2>
        <p className="mt-3 max-w-2xl break-keep text-sm leading-relaxed text-muted-foreground">
          프로그램 참여부터 기록까지 한 흐름으로 연결됩니다. 현재 상태와 다음 할
          일은 대시보드에서 확인합니다.
        </p>

        <ol className="mt-10 grid list-none gap-0 border-y border-border p-0 sm:grid-cols-2 lg:grid-cols-4">
          {FLOW_STEPS.map(({ step, title, description }, index) => (
            <li
              key={step}
              className={`relative px-1 py-6 sm:px-6 ${
                index === 1
                  ? 'border-t border-border sm:border-t-0 sm:border-l'
                  : index === 2
                    ? 'border-t border-border lg:border-t-0 lg:border-l'
                    : index === 3
                      ? 'border-t border-border sm:border-l lg:border-t-0'
                      : ''
              }`}
            >
              <span className="font-mono text-sm font-semibold text-primary">
                {step}
              </span>
              <h3 className="mt-5 break-keep text-lg font-semibold text-foreground">
                {title}
              </h3>
              <p className="mt-2 break-keep text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
