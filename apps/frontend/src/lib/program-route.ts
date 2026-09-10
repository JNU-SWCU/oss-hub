export function programDocumentsHref(
  programId: string,
  milestoneId?: string,
): string {
  const base = `/programs/${encodeURIComponent(programId)}/documents`;
  if (milestoneId === undefined) {
    return base;
  }
  return `${base}?milestoneId=${encodeURIComponent(milestoneId)}`;
}

/**
 * 프로그램 개요(상세 첫 화면). 참여 전에도 열리는 유일한 프로그램 화면이라, 참여자 전용
 * 화면에서 막힌 사람이 돌아갈 곳으로 쓴다(#1099).
 */
export function programOverviewHref(programId: string): string {
  return `/programs/${encodeURIComponent(programId)}`;
}

/**
 * 신청 화면. 모집이 닫혔거나 이미 낸 신청이 있어도 **그 화면이 이유를 설명하므로**
 * 조건을 여기서 미리 판정하지 않고 항상 이 경로를 준다.
 */
export function programApplyHref(programId: string): string {
  return `/programs/${encodeURIComponent(programId)}/apply`;
}

/**
 * 학생의 「우리 팀」 화면(#1269) — 이 프로그램에서 내가 속한 팀 하나를 보는 전용 경로다.
 *
 * 신청 화면(`programApplyHref`)과 **다른 주소**다. 팀 이야기를 신청 폼 안에 숨기지 않고
 * 좌측 패널에서 바로 열리는 자기 자리로 둔다. 참여 팀 목록(`programHref(id, '/teams')`)과도
 * 다르다 — 그쪽은 프로그램 전체 팀 디렉터리(공개 성격)고, 이쪽은 내 팀 하나다.
 *
 * 팀이 없는 학생에게도 같은 주소를 준다. 「팀이 있는지」를 신청 상태로 미리 추측해
 * 링크를 감추지 않고, 화면이 서버 응답(`getMyTeam`)으로 팀 없음 상태를 직접 말한다.
 */
export function programMyTeamHref(programId: string): string {
  return `/programs/${encodeURIComponent(programId)}/my-team`;
}

export function programNewHref(): string {
  return '/programs/new';
}

export function programEditHref(programId: string): string {
  return `/programs/${encodeURIComponent(programId)}/edit`;
}

export function programApplicantsHref(programId: string): string {
  return `/programs/${encodeURIComponent(programId)}/applicants`;
}

export function programApplicationDetailHref(
  programId: string,
  applicationId: string,
): string {
  return `/programs/${encodeURIComponent(programId)}/applications/${encodeURIComponent(applicationId)}`;
}

export function programSubmissionReviewHref(
  programId: string,
  submissionId: string,
): string {
  return `/programs/${encodeURIComponent(programId)}/submissions/${encodeURIComponent(submissionId)}/review`;
}

/** 교직원 서류 수합 표 — 마일스톤 하나의 팀×서류 현황. 좌측 패널이 아니라 문맥 링크로만 들어간다. */
export function programMilestoneDocumentsHref(
  programId: string,
  milestoneId: string,
): string {
  return `/programs/${encodeURIComponent(programId)}/milestones/${encodeURIComponent(milestoneId)}/documents`;
}

/**
 * 교직원 전용 팀 상세(#874) — 참여 팀 목록의 팀명에서 들어가는 문맥 경로다.
 * 좌측 패널 메뉴에는 넣지 않는다(위 `programMilestoneDocumentsHref`와 같은 원칙).
 */
export function programTeamDetailHref(
  programId: string,
  teamId: string,
): string {
  return `/programs/${encodeURIComponent(programId)}/teams/${encodeURIComponent(teamId)}`;
}
