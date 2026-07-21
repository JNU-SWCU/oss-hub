import type {
  ApplicationFieldInputType,
  ApplicationFormTemplate,
  ProgramParticipation,
} from './types';

const INPUT_TYPE_LABELS: Readonly<Record<ApplicationFieldInputType, string>> = {
  text: '텍스트',
  url: 'URL',
  textarea: '긴 글',
};

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
      <ul className="space-y-2">
        {template.fields.map((field) => (
          <li
            key={field.key}
            className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
          >
            <span className="font-medium text-foreground">{field.label}</span>
            <span className="text-muted-foreground">
              {INPUT_TYPE_LABELS[field.inputType]} ·{' '}
              {field.required ? '필수' : '선택'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
