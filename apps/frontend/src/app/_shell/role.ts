/**
 * 회원 공통 홈 입구.
 *
 * 세션 쿠키 JWT에는 `sub`(githubId)만 있고 권한 클레임은 없다. 회원 유형과 접근
 * 권한은 DB가 들고 있고 `/auth/session`이 세션 주체로 조회해 내려준다. 프런트는 그
 * 값으로 `/dashboard` **본문만** 가르고, URL 입구는 하나다.
 *
 * 예전에는 역할을 인자로 받았지만 값과 무관하게 언제나 같은 경로를 돌려줬다 —
 * 배타적 역할이 사라진 지금 그 인자는 "역할별 경로가 있다"는 잘못된 여지만 남긴다.
 */
export function roleHomePath(): string {
  return '/dashboard';
}
