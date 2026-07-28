// Input 프리뷰 — features/programs/program-edit-basic-form.tsx,
// features/profile/settings/components/settings-form.tsx의 정본 렌더를 옮긴 것이다.
// .d.ts는 style/className/children만 잡히지만 실제 컴포넌트는
// React.ComponentProps<'input'>을 그대로 펼치므로(ui/input.tsx), type/placeholder/
// disabled/readOnly/aria-invalid 등 native input 속성을 이 repo의 실제 값으로 채운다.
import { Input } from 'frontend';

export function Default() {
  return <Input defaultValue="캡스톤 디자인 경진대회" />;
}

// settings-form.tsx의 "기타 학과" 직접 입력 필드.
export function Placeholder() {
  return <Input placeholder="학과 또는 전공을 입력해 주세요" />;
}

// program-edit-basic-form.tsx의 신청 기간 그리드 — datetime-local과 number.
export function Types() {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Input type="datetime-local" defaultValue="2026-09-01T00:00" />
      <Input type="number" min="1" defaultValue="4" />
    </div>
  );
}

// program-edit-basic-form.tsx의 주관기관 필드 — 검증 실패 상태.
export function Invalid() {
  return <Input aria-invalid defaultValue="" placeholder="주관기관" />;
}

// settings-form.tsx의 학번 필드 — 읽기 전용 + 비활성.
export function Disabled() {
  return <Input defaultValue="202312345" readOnly disabled />;
}

// 긴 값이 들어왔을 때 잘림/스크롤을 확인하는 케이스.
export function LongValue() {
  return (
    <Input defaultValue="2026학년도 2학기 소프트웨어중심대학 오픈소스 커뮤니티 기여 프로그램 참가자 모집" />
  );
}
