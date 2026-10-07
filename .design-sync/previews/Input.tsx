import { Input } from 'frontend';

export function Default() {
  return <Input defaultValue="캡스톤 디자인 경진대회" />;
}

export function Placeholder() {
  return <Input placeholder="학과 또는 전공을 입력해 주세요" />;
}

export function Types() {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Input type="datetime-local" defaultValue="2026-09-01T00:00" />
      <Input type="number" min="1" defaultValue="4" />
    </div>
  );
}

export function Invalid() {
  return <Input aria-invalid defaultValue="" placeholder="주관기관" />;
}

export function Disabled() {
  return <Input defaultValue="123456" readOnly disabled />;
}

export function LongValue() {
  return (
    <Input defaultValue="2026학년도 2학기 소프트웨어중심대학 오픈소스 커뮤니티 기여 프로그램 참가자 모집" />
  );
}
