/**
 * 관리자가 다른 사용자의 프로필(이름·학번·학과)을 대신 고치는 경로의 도메인 타입.
 *
 * 본인 경로(`domain/user-profile.ts`의 `PatchUserProfileInput`)와 다른 별도 타입을 쓰는
 * 이유는 규칙이 다르기 때문이다 — 본인 경로는 학번을 한 번 채우면 불변(USR_003)이지만
 * 관리자 경로는 그 규칙을 우회해 오탈자·전산 오류로 잘못 들어간 학번을 고칠 수 있어야
 * 한다. 그래도 학번 형식(`STUDENT_ID_PATTERN`)·학번을 채우려면 학과가 필요하다는 규칙
 * (USR_005)·`UserProfile.studentId` 유일성은 두 경로 모두 지킨다.
 */
export type AdminProfileFields = {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
};

/**
 * PATCH 본문 — 세 항목 모두 선택이고, 실린 항목만 바뀐다(부분 갱신). 본인 경로와 달리
 * `studentId`를 이미 값이 있는 상태에서 다른 값으로 보내도 막지 않는다(관리자 전용 우회).
 */
export type AdminProfileUpdateCommand = {
  readonly name?: string;
  readonly studentId?: string;
  readonly department?: string;
};

/**
 * 저장 후 최신 값 — CAS 필드를 두지 않는다(이 기능은 낙관적 잠금을 쓰지 않기로 결정했다,
 * 자유 텍스트 교정에 CAS는 마찰만 더한다). 화면은 이 응답으로 바로 최신 상태를 반영한다.
 *
 * 이 결정은 "이미 있는 값을 덮어써도 되는가"에 대한 것이고, 커맨드에 실린 필드만
 * UPDATE하는 부분 갱신(`admin-profile.repository.ts`의 `applyProfile`, lost-update
 * 방지)과는 별개다 — 부분 갱신은 CAS 없이도 적용된다.
 */
export type AdminProfileUpdateResult = AdminProfileFields & {
  readonly id: string;
};
