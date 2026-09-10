/**
 * 같은 URL에 이미 떠 있는 「우리 팀」 화면(#1269)에게 "이 프로그램의 내 팀 소속이 방금
 * 바뀌었다"고 알리는 브라우저 이벤트다. `router.refresh()`는 같은 경로에서 클라이언트
 * 이펙트를 다시 실행하지 않으므로, 수락 직후 화면을 갱신하려면 이 알림이 필요하다.
 *
 * 이것은 알림일 뿐 캐시나 전역 상태 저장소가 아니다. 데이터는 각 화면이 자기 API로
 * 다시 읽는다.
 */
export const TEAM_MEMBERSHIP_CHANGED_EVENT = 'oss-hub:team-membership-changed';

/** 수신 화면은 자기 프로그램과 `programId`가 같을 때에만 다시 읽는다. */
export interface TeamMembershipChangedDetail {
  readonly programId: string;
}

/**
 * 팀 소속이 실제로 바뀐 뒤에만 부른다(성공한 수락 등). 서버 렌더에서 불려도 안전하도록
 * `window` 접근은 이 함수 안에서만 한다.
 */
export function notifyTeamMembershipChanged(programId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<TeamMembershipChangedDetail>(
      TEAM_MEMBERSHIP_CHANGED_EVENT,
      { detail: { programId } },
    ),
  );
}
