import type { AdminAccessRole } from './admin-access-api';
import { ROLE_LABEL, rankOfAdminAccessRole } from './admin-access-mutation-policy';

/**
 * 역할 세그먼트 컨트롤(직접 선택 방식, PR04G 재설계)이 확인 다이얼로그
 * 문구를 고를 때 쓰는 헬퍼. 예전에는 GRANT/REVOKE 두 액션이 각각 고정된
 * 문구를 가졌지만, 지금은 관리자가 세 역할 중 아무거나 직접 고르므로
 * "지금 역할보다 낮은 역할을 골랐는가"만으로 파괴적 문구 여부를 판단한다.
 */

const ROLE_TARGET_PHRASE: Record<AdminAccessRole, string> = {
  STUDENT: '학생으로',
  STAFF: '교직원으로',
  ADMIN: '관리자로',
};

/** `target`이 `current`보다 낮은 권한 등급이면 참(강등). 미지정(`null`)은 학생과 같은 등급이라 강등이 아니다. */
export function isAdminAccessRoleDowngrade(
  current: AdminAccessRole | null,
  target: AdminAccessRole,
): boolean {
  return rankOfAdminAccessRole(target) < rankOfAdminAccessRole(current);
}

/**
 * 확인 다이얼로그 설명 문구. 강등이면 "회수하고 전환" 문구를, 그 외(첫 배정
 * 포함 승격)에는 "부여" 문구를 쓴다.
 *
 * 참고: STAFF→STUDENT·ADMIN→STUDENT처럼 `null`을 거치지 않는 직접 강등은
 * 역할 요청 이력에 `REVOKED` 행을 남기지 않는다(`admin-access-transition-table.ts`의
 * `directRequestEffect`는 STAFF→`null`일 때만 `REVOKED`를 반환한다). 로그인 시
 * 역할 재시딩 가드(`auth.repository.ts`)는 `role === null`일 때만 동작하므로
 * 이 차이가 기능적 위험을 만들지는 않지만, 이력 화면에서 강등 이벤트 자체가
 * 보이지 않는다는 점은 알아 둘 만하다.
 */
export function adminAccessRoleChangeDialogDescription(
  current: AdminAccessRole | null,
  target: AdminAccessRole,
  githubLogin: string,
): string {
  if (isAdminAccessRoleDowngrade(current, target)) {
    const currentLabel = current ? ROLE_LABEL[current] : ROLE_LABEL.STUDENT;
    return `${githubLogin}님의 ${currentLabel} 권한을 회수하고 ${ROLE_TARGET_PHRASE[target]} 전환합니다.`;
  }
  return `${githubLogin}님에게 ${ROLE_LABEL[target]} 권한을 부여합니다.`;
}
