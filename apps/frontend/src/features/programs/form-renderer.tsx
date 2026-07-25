import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type {
  ApplicationFormField,
  ApplicationFormTemplate,
  ProgramParticipation,
} from './types';

const PARTICIPATION_LABELS: Readonly<Record<ProgramParticipation, string>> = {
  individual: '개인형 신청',
  team: '팀형 신청',
};

export type FormRendererMode = 'preview' | 'edit';

export function FormRenderer({
  template,
  mode = 'preview',
  values = {},
  onChange,
}: {
  readonly template: ApplicationFormTemplate;
  readonly mode?: FormRendererMode;
  readonly values?: Readonly<Partial<Record<string, string>>>;
  readonly onChange?: (key: string, value: string) => void;
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
      <div className="space-y-3">
        {template.fields.map((field) => (
          <FormFieldControl
            key={field.key}
            field={field}
            mode={mode}
            value={values[field.key] ?? ''}
            onChange={onChange}
          />
        ))}
      </div>
    </section>
  );
}

function FormFieldControl({
  field,
  mode,
  value,
  onChange,
}: {
  readonly field: ApplicationFormField;
  readonly mode: FormRendererMode;
  readonly value: string;
  readonly onChange?: (key: string, value: string) => void;
}) {
  const readOnly = mode === 'preview' || field.type === 'auto';
  const inputId = `application-field-${field.key}`;
  const requiredMark = field.required ? ' *' : '';

  return (
    <Field>
      <FieldLabel htmlFor={inputId}>
        {field.label}
        {requiredMark}
      </FieldLabel>
      {field.type === 'textarea' ? (
        <textarea
          id={inputId}
          name={field.key}
          value={value}
          readOnly={readOnly}
          disabled={readOnly && mode === 'preview'}
          onChange={(event) => onChange?.(field.key, event.target.value)}
          className="min-h-24 w-full rounded-lg border border-input bg-transparent p-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
        />
      ) : (
        <Input
          id={inputId}
          name={field.key}
          type="text"
          value={value}
          readOnly={readOnly}
          disabled={readOnly && mode === 'preview'}
          onChange={(event) => onChange?.(field.key, event.target.value)}
        />
      )}
    </Field>
  );
}
