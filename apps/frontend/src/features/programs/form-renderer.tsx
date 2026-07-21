import type { ApplicationFormTemplate, ProgramParticipation } from './types';

const PARTICIPATION_LABELS: Readonly<Record<ProgramParticipation, string>> = {
  individual: '개인형 신청',
  team: '팀형 신청',
};

export function FormRenderer({
  template,
}: {
  readonly template: ApplicationFormTemplate;
}) {
  return (
    <section
      aria-label={`${template.name} 템플릿 미리보기`}
      className="space-y-3"
    >
      <div>
        <p className="font-medium text-foreground">{template.name}</p>
        <p className="text-sm text-muted-foreground">
          {template.key} v{template.version} ·{' '}
          {PARTICIPATION_LABELS[template.participation]}
        </p>
      </div>
      <p className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
        세부 신청 항목은 원본 양식 확정 후 제공됩니다.
      </p>
    </section>
  );
}
