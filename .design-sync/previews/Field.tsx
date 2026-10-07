import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Input,
} from 'frontend';

export function LabeledInput() {
  return (
    <Field>
      <FieldLabel htmlFor="program-name">프로그램명 *</FieldLabel>
      <Input id="program-name" defaultValue="오픈소스 기여 아카데미" />
    </Field>
  );
}

export function WithError() {
  return (
    <Field data-invalid="true">
      <FieldLabel htmlFor="program-organizer">주관기관 *</FieldLabel>
      <Input id="program-organizer" aria-invalid />
      <FieldError>주관기관을 입력해 주세요.</FieldError>
    </Field>
  );
}

export function ReadOnlyWithDescription() {
  return (
    <Field>
      <FieldLabel htmlFor="settings-student-id">학번</FieldLabel>
      <Input id="settings-student-id" defaultValue="123456" readOnly disabled />
      <FieldDescription>학번은 변경할 수 없습니다.</FieldDescription>
    </Field>
  );
}

export function Horizontal() {
  return (
    <Field orientation="horizontal">
      <input id="repository-provisioning" type="checkbox" defaultChecked />
      <FieldLabel htmlFor="repository-provisioning">
        저장소 프로비저닝 사용
      </FieldLabel>
    </Field>
  );
}

export function RadioSetInFieldSet() {
  return (
    <FieldSet>
      <FieldLegend>결과 선택</FieldLegend>
      <div className="grid gap-2">
        <FieldLabel>
          <Field orientation="horizontal">
            <input
              type="radio"
              name="review-decision"
              defaultChecked
              className="mt-0.5 size-4 accent-primary"
            />
            <span className="grid gap-0.5">
              <span>승인</span>
              <span className="text-sm font-normal text-muted-foreground">
                현재 revision을 승인합니다.
              </span>
            </span>
          </Field>
        </FieldLabel>
        <FieldLabel>
          <Field orientation="horizontal">
            <input
              type="radio"
              name="review-decision"
              className="mt-0.5 size-4 accent-primary"
            />
            <span className="grid gap-0.5">
              <span>보완 요청</span>
              <span className="text-sm font-normal text-muted-foreground">
                코멘트를 반영한 재제출을 허용합니다.
              </span>
            </span>
          </Field>
        </FieldLabel>
        <FieldLabel>
          <Field orientation="horizontal">
            <input
              type="radio"
              name="review-decision"
              className="mt-0.5 size-4 accent-primary"
            />
            <span className="grid gap-0.5">
              <span>최종 반려</span>
              <span className="text-sm font-normal text-muted-foreground">
                현재 제출을 최종 반려하고 재제출을 막습니다.
              </span>
            </span>
          </Field>
        </FieldLabel>
      </div>
    </FieldSet>
  );
}
