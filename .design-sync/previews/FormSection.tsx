// FormSection 프리뷰 — components/form-section.test.tsx의 정본 렌더와
// features/programs/program-edit-basic-form.tsx, features/profile/settings/
// components/settings-form.tsx의 실제 화면 조합을 옮긴 것이다. FormSection은
// title(+description)을 FieldSet/FieldLegend/FieldGroup으로 감싸는 레이어라
// Field와 함께 조합해야 실제 사용법이 드러난다.
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FormSection,
  Input,
} from 'frontend';

// program-edit-basic-form.tsx의 "기본 정보" 섹션 — description 없이 필드만.
export function Default() {
  return (
    <FormSection title="기본 정보">
      <Field>
        <FieldLabel htmlFor="fs-program-name">프로그램명 *</FieldLabel>
        <Input id="fs-program-name" defaultValue="캡스톤 디자인 경진대회" />
      </Field>
      <Field>
        <FieldLabel htmlFor="fs-program-organizer">주관기관 *</FieldLabel>
        <Input
          id="fs-program-organizer"
          defaultValue="소프트웨어중심대학사업단"
        />
      </Field>
    </FormSection>
  );
}

// settings-form.tsx의 "프로필" 섹션 — description과 읽기 전용 필드가 함께 온다.
export function WithDescription() {
  return (
    <FormSection
      title="프로필"
      description="이름과 학과를 수정할 수 있습니다. 학번은 변경할 수 없습니다."
    >
      <Field>
        <FieldLabel htmlFor="fs-settings-name">이름</FieldLabel>
        <Input id="fs-settings-name" defaultValue="홍길동" />
      </Field>
      <Field>
        <FieldLabel htmlFor="fs-settings-student-id">학번</FieldLabel>
        <Input
          id="fs-settings-student-id"
          defaultValue="202312345"
          readOnly
          disabled
        />
        <FieldDescription>학번은 변경할 수 없습니다.</FieldDescription>
      </Field>
    </FormSection>
  );
}

// form-section.test.tsx의 "description 없이 렌더" 케이스 — 비고 필드 하나.
export function NoDescription() {
  return (
    <FormSection title="추가 정보">
      <Field>
        <FieldLabel htmlFor="fs-note">비고</FieldLabel>
        <Input id="fs-note" />
      </Field>
    </FormSection>
  );
}

// settings-form.tsx의 "알림 수신" 섹션 — description이 길게 줄바꿈되는 케이스,
// 필드 검증 에러도 함께 조합해 실제 폼 상태를 보여준다.
export function LongDescriptionWithError() {
  return (
    <FormSection
      title="알림 수신"
      description="마감 임박 알림 메일을 받을 이메일 주소와 수신 여부를 설정합니다. 알림은 마감 24시간 전과 마감 당일 오전 9시, 두 차례에 걸쳐 발송되며, 학교 이메일 주소를 사용하면 스팸함으로 분류될 가능성을 줄일 수 있습니다. 수신을 원하지 않으면 아래 체크박스를 해제해 주세요."
    >
      <Field data-invalid="true">
        <FieldLabel htmlFor="fs-notification-email">수신 이메일</FieldLabel>
        <Input
          id="fs-notification-email"
          aria-invalid
          defaultValue="student@"
        />
        <FieldError>이메일 형식이 올바르지 않습니다.</FieldError>
      </Field>
    </FormSection>
  );
}
