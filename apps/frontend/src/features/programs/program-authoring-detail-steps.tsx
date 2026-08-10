import {
  Blocks,
  BriefcaseBusiness,
  Boxes,
  Globe2,
  GraduationCap,
  HeartHandshake,
  Trophy,
} from 'lucide-react';
import { FormSection } from '@/components/form-section';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import {
  messageFor,
  ProgramAuthoringTextField,
} from './program-authoring-fields';
import type {
  ProgramAuthoringAction,
  ProgramAuthoringState,
} from './program-authoring-model';
import type { ProgramAuthoringIssue } from './program-authoring-validation';
import { PROGRAM_TEMPLATE_DEFINITIONS } from './program-templates';

const CATEGORY_ICONS = {
  BASIC: Boxes,
  SW_VALUE_SPREAD: HeartHandshake,
  OSS_CONTEST: Trophy,
  CAPSTONE: GraduationCap,
  SW_CONVERGENCE: Blocks,
  GLOBAL_MAKERTHON: Globe2,
  CORPORATE_INTERNSHIP: BriefcaseBusiness,
} as const;

type StepProps = {
  readonly state: ProgramAuthoringState;
  readonly issues: readonly ProgramAuthoringIssue[];
  readonly dispatch: (action: ProgramAuthoringAction) => void;
};

export function ProgramAuthoringTypeStep({ state, dispatch }: StepProps) {
  return (
    <FormSection
      title="프로그램 유형"
      description="운영 목적과 가장 가까운 유형을 고르세요. 유형은 신청 양식의 기준이 됩니다."
    >
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup">
        {PROGRAM_TEMPLATE_DEFINITIONS.map((definition) => {
          const Icon = CATEGORY_ICONS[definition.category];
          return (
            <label
              key={definition.category}
              className="grid min-h-control cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-card border border-border p-card has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
            >
              <input
                className="sr-only"
                type="radio"
                name="program-category"
                value={definition.category}
                checked={state.category === definition.category}
                onChange={() =>
                  dispatch({
                    type: 'set_category',
                    category: definition.category,
                  })
                }
              />
              <Icon aria-hidden="true" className="text-primary" />
              <span className="grid gap-1">
                <span className="font-semibold">{definition.label}</span>
                <span className="text-small text-muted-foreground">
                  {definition.template.name}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </FormSection>
  );
}

export function ProgramAuthoringBasicStep({
  state,
  issues,
  dispatch,
}: StepProps) {
  return (
    <FormSection
      title="기본 정보"
      description="프로그램 목록과 상세 화면에 표시할 정보를 입력하세요."
    >
      <ProgramAuthoringTextField
        id="authoring-name"
        label="프로그램명 *"
        value={state.name}
        error={messageFor(issues, 'name')}
        onChange={(value) =>
          dispatch({ type: 'set_program_field', field: 'name', value })
        }
      />
      <ProgramAuthoringTextField
        id="authoring-organizer"
        label="주관기관/학과 *"
        value={state.organizer}
        error={messageFor(issues, 'organizer')}
        onChange={(value) =>
          dispatch({ type: 'set_program_field', field: 'organizer', value })
        }
      />
      <Field>
        <FieldLabel htmlFor="authoring-description">소개/설명 *</FieldLabel>
        <textarea
          id="authoring-description"
          className="min-h-32 rounded-control border border-input bg-transparent p-4 text-body outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          value={state.description}
          aria-invalid={Boolean(messageFor(issues, 'description'))}
          onChange={(event) =>
            dispatch({
              type: 'set_program_field',
              field: 'description',
              value: event.target.value,
            })
          }
        />
        <FieldError>{messageFor(issues, 'description')}</FieldError>
      </Field>
    </FormSection>
  );
}

export { messageFor } from './program-authoring-fields';
export { ProgramAuthoringScheduleStep } from './program-authoring-schedule-step';
