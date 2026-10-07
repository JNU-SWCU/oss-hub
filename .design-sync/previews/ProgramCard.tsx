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
