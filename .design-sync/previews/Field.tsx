// Field 프리뷰 — features/programs/program-edit-basic-form.tsx,
// features/profile/settings/components/settings-form.tsx,
// features/reviews/components/submission-review-view.tsx의 정본 렌더를 옮긴 것이다.
// Field는 FieldLabel/FieldDescription/FieldError/FieldSet/FieldLegend와 조합돼야만
// 의미가 있는 컴포넌트라, 각 export가 그 조합을 실제 폼 행 단위로 보여준다.
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Input,
} from 'frontend';

// program-edit-basic-form.tsx의 프로그램명 필드 — 기본 vertical 상태.
export function LabeledInput() {
  return (
    <Field>
      <FieldLabel htmlFor="program-name">프로그램명 *</FieldLabel>
      <Input id="program-name" defaultValue="오픈소스 기여 아카데미" />
    </Field>
  );
}

// program-creation-flow.ts의 검증 실패 메시지를 그대로 붙인 에러 상태.
export function WithError() {
  return (
    <Field data-invalid="true">
      <FieldLabel htmlFor="program-organizer">주관기관 *</FieldLabel>
      <Input id="program-organizer" aria-invalid />
      <FieldError>주관기관을 입력해 주세요.</FieldError>
    </Field>
  );
}

// settings-form.tsx의 학번 필드 — 읽기 전용 + 설명 텍스트.
export function ReadOnlyWithDescription() {
  return (
    <Field>
      <FieldLabel htmlFor="settings-student-id">학번</FieldLabel>
      <Input
        id="settings-student-id"
        defaultValue="202312345"
        readOnly
        disabled
      />
      <FieldDescription>학번은 변경할 수 없습니다.</FieldDescription>
    </Field>
  );
}

// program-edit-basic-form.tsx의 체크박스 필드 — orientation="horizontal".
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

// submission-review-view.tsx의 판정 라디오 그룹 — FieldSet+FieldLegend로 묶고
// 각 옵션을 FieldLabel > Field(horizontal)로 감싼다. 설명 문구가 길어 줄바꿈된다.
export function RadioSetInFieldSet() {
  return (
    <FieldSet>
      <FieldLegend>판정 선택</FieldLegend>
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
