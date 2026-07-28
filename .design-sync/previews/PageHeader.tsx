// PageHeader 프리뷰 — archive-detail-view.tsx / program-list-page.tsx의
// 실제 화면 헤더를 그대로 옮긴 것.
import { Button, PageHeader } from 'frontend';

// archive-detail-view.tsx DetailContent — title/description + 우측 액션 버튼.
export function WithActions() {
  return (
    <PageHeader
      title="오픈소스 컨트리뷰션 아카데미"
      description="교육/멘토링 · 2026.07 - 2026.08"
      actions={<Button>GitHub 열기</Button>}
    />
  );
}

// program-list-page.tsx — title/description만, 액션 슬롯 없이.
export function Simple() {
  return (
    <PageHeader title="프로그램" description="참여할 프로그램을 찾아보세요." />
  );
}

// 텍스트 과다 케이스 — 긴 제목·설명이 줄바꿈될 때 타이포와 액션 정렬을 본다.
export function LongTitle() {
  return (
    <PageHeader
      title="2026학년도 2학기 소프트웨어중심대학 오픈소스 커뮤니티 기여 프로그램 참가자 모집"
      description="교육/멘토링 · 오픈소스 기여 · 학점 연계 — 신청 기간: 2026.09.01 - 2026.12.19 (16주, 매주 수요일 오후 6시 정기 모임 포함)"
      actions={<Button variant="outline">모집 공고 상세 보기</Button>}
    />
  );
}
