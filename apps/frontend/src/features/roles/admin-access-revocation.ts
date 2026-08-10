import type { AdminAccessRole } from './admin-access-api';
import {
  ROLE_LABEL,
  rankOfAdminAccessRole,
} from './admin-access-mutation-policy';

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
 * 확인 다이얼로그 설명 문구. 강등이면 "전환" 문구를, 그 외(첫 배정 포함
 * 승격)에는 "부여" 문구를 쓴다.
 *
 * #765: 강등 문구가 예전에는 "권한을 회수하고 전환합니다"였다. 그런데
 * STAFF→STUDENT·ADMIN→STUDENT처럼 `null`을 거치지 않는 직접 강등은 역할
 * 요청 이력에 `REVOKED` 행을 남기지 않는다(`admin-access-transition-table.ts`의
 * `directRequestEffect`는 STAFF→`null`일 때만 `REVOKED`를 반환한다) — 화면이
 * 시스템이 실제로 하지 않는 일("회수")을 자칭한 셈이다. 그래서 강등 문구에서
 * "회수" 어휘를 뺐다. null을 거치는 진짜 회수(REVOKED 이력 포함)는 여전히
 * 실제 기능이지만, 지금은 이 UI가 아니라 API 전용 경로다.
 */
export function adminAccessRoleChangeDialogDescription(
  current: AdminAccessRole | null,
  target: AdminAccessRole,
  githubLogin: string,
): string {
  if (isAdminAccessRoleDowngrade(current, target)) {
    const currentLabel = current ? ROLE_LABEL[current] : ROLE_LABEL.STUDENT;
    return `${githubLogin}님의 ${currentLabel} 역할을 ${ROLE_TARGET_PHRASE[target]} 전환합니다. ${currentLabel} 권한은 즉시 사라집니다.`;
  }
  return `${githubLogin}님에게 ${ROLE_LABEL[target]} 권한을 부여합니다.`;
}
