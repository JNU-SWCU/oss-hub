// ProgramCard 프리뷰 — 조합은 apps/frontend/src/components/cards.test.tsx의
// 정본 렌더를 옮긴 것이다(문구·variant 그대로). CardGrid + StatusBadge와 함께
// 쓰이는 것이 이 repo의 실제 사용법이므로 단독 카드만 보여주지 않는다.
import { Button, CardGrid, ProgramCard, StatusBadge } from 'frontend';

export function Default() {
  return (
    <ProgramCard
      title="캡스톤 디자인 경진대회"
      category="캡스톤/산학"
      period="2026.03 - 2026.06"
      status={<StatusBadge variant="recruiting">모집중</StatusBadge>}
      footer={
        <Button variant="outline" size="sm">
          상세 보기
        </Button>
      }
    />
  );
}

// cards.test.tsx의 그리드 렌더 — 모집중/마감 카드가 나란히 놓이는 목록 화면 모습.
export function InCardGrid() {
  return (
    <CardGrid>
      <ProgramCard
        title="캡스톤 디자인 경진대회"
        category="캡스톤/산학"
        period="2026.03 - 2026.06"
        status={<StatusBadge variant="recruiting">모집중</StatusBadge>}
        footer={
          <Button variant="outline" size="sm">
            상세 보기
          </Button>
        }
      />
      <ProgramCard
        title="SW 해커톤"
        category="경진대회/해커톤"
        period="2026.05"
        status={<StatusBadge variant="closed">마감</StatusBadge>}
        footer={
          <Button variant="outline" size="sm">
            상세 보기
          </Button>
        }
      />
    </CardGrid>
  );
}

// 상태 축 전개 — StatusBadge의 5개 variant가 카드 위에서 어떻게 읽히는지.
export function StatusAxis() {
  return (
    <CardGrid>
      <ProgramCard
        title="오픈소스 컨트리뷰션 아카데미"
        category="교육/멘토링"
        period="2026.07 - 2026.08"
        status={<StatusBadge variant="recruiting">모집중</StatusBadge>}
      />
      <ProgramCard
        title="교내 오픈소스 세미나"
        category="세미나"
        period="2026.04"
        status={<StatusBadge variant="closed">마감</StatusBadge>}
      />
      <ProgramCard
        title="학생 주도 프로젝트 지원"
        category="자율 프로젝트"
        period="2026.09 - 2026.12"
        status={<StatusBadge variant="pending">대기</StatusBadge>}
      />
      <ProgramCard
        title="산학 연계 인턴십"
        category="캡스톤/산학"
        period="2026.06 - 2026.08"
        status={<StatusBadge variant="approved">승인</StatusBadge>}
      />
      <ProgramCard
        title="교외 연합 해커톤"
        category="경진대회/해커톤"
        period="2026.10"
        status={<StatusBadge variant="rejected">반려</StatusBadge>}
      />
    </CardGrid>
  );
}

// 텍스트 과다 케이스 — 긴 한글 제목·카테고리가 줄바꿈될 때 타이포와 줄 간격을 본다.
export function LongText() {
  return (
    <CardGrid>
      <ProgramCard
        title="2026학년도 2학기 소프트웨어중심대학 오픈소스 커뮤니티 기여 프로그램 참가자 모집"
        category="교육/멘토링 · 오픈소스 기여 · 학점 연계"
        period="2026.09.01 - 2026.12.19 (16주, 매주 수요일 오후 6시 정기 모임 포함)"
        status={<StatusBadge variant="recruiting">모집중</StatusBadge>}
        footer={
          <Button variant="outline" size="sm">
            모집 공고 상세 보기
          </Button>
        }
      />
      <ProgramCard
        title="제목만 있는 카드"
        status={<StatusBadge variant="pending">대기</StatusBadge>}
      />
    </CardGrid>
  );
}
