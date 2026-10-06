import { Input, Label } from 'frontend';

export function Default() {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="label-program-name">프로그램명 *</Label>
      <Input id="label-program-name" defaultValue="캡스톤 디자인 경진대회" />
    </div>
  );
}

export function WithCheckbox() {
  return (
    <div className="flex items-center gap-2">
      <input id="label-provisioning" type="checkbox" defaultChecked />
      <Label htmlFor="label-provisioning">저장소 프로비저닝 사용</Label>
    </div>
  );
}

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

export function AsChild() {
  return (
    <Label asChild>
      <span>학과 선택 안내</span>
    </Label>
  );
}
