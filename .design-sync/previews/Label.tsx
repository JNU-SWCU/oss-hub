// Label 프리뷰 — 이 repo에서 raw Label(ui/label.tsx)의 직접 사용처는 없다
// (전부 FieldLabel로 감싸 쓴다, apps/frontend/src/components/ui/field.tsx:7).
// FieldLabel이 그대로 넘기는 props(htmlFor/className/asChild)는 동일하므로
// FieldLabel 실사용에서 이미 검증된 문구(program-edit-basic-form.tsx,
// settings-form.tsx)를 원시 Label 페어링에 그대로 옮겨 쓴다.
import { Input, Label } from 'frontend';

// program-edit-basic-form.tsx의 프로그램명 라벨 문구를 raw Label+Input 페어로.
export function Default() {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="label-program-name">프로그램명 *</Label>
      <Input id="label-program-name" defaultValue="캡스톤 디자인 경진대회" />
    </div>
  );
}

// program-edit-basic-form.tsx의 체크박스+라벨 페어링.
export function WithCheckbox() {
  return (
    <div className="flex items-center gap-2">
      <input id="label-provisioning" type="checkbox" defaultChecked />
      <Label htmlFor="label-provisioning">저장소 프로비저닝 사용</Label>
    </div>
  );
}

// peer-disabled 스타일 확인 — 비활성 입력과 짝지었을 때 라벨도 옅어진다.
export function PeerDisabled() {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="label-student-id">학번</Label>
      <Input
        id="label-student-id"
        className="peer"
        defaultValue="123456"
        disabled
      />
    </div>
  );
}

// asChild로 커스텀 엘리먼트(span)를 라벨 스타일로 렌더하는 경우.
export function AsChild() {
  return (
    <Label asChild>
      <span>학과 선택 안내</span>
    </Label>
  );
}
