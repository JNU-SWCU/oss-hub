// Button 프리뷰 — variant/size 축을 .d.ts의 실제 유니온 그대로 전개한다.
// 문구는 이 repo의 화면에서 쓰는 것(로그인·상세 보기·신청)을 쓴다.
import { Button } from 'frontend';

// [&_svg] 규칙과 icon size를 확인하려면 실제 svg가 필요하다.
function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="default">프로그램 신청</Button>
      <Button variant="secondary">임시 저장</Button>
      <Button variant="outline">상세 보기</Button>
      <Button variant="ghost">취소</Button>
      <Button variant="destructive">신청 취소</Button>
      <Button variant="link">공고 원문 열기</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="xs">xs</Button>
      <Button size="sm">sm</Button>
      <Button size="default">default</Button>
      <Button size="lg">lg</Button>
    </div>
  );
}

export function IconSizes() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="icon-xs" aria-label="추가">
        <PlusIcon />
      </Button>
      <Button size="icon-sm" aria-label="추가">
        <PlusIcon />
      </Button>
      <Button size="icon" aria-label="추가">
        <PlusIcon />
      </Button>
      <Button size="icon-lg" aria-label="추가">
        <PlusIcon />
      </Button>
      <Button variant="outline">
        <PlusIcon />
        프로그램 등록
      </Button>
    </div>
  );
}

export function Disabled() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled>모집 마감</Button>
      <Button variant="outline" disabled>
        상세 보기
      </Button>
      <Button variant="destructive" disabled>
        신청 취소
      </Button>
    </div>
  );
}
