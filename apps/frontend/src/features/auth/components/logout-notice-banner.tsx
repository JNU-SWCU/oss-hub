import Link from 'next/link';
import { LOGOUT_COMPLETE_PATH, LOGOUT_NOTICE_MESSAGE } from '../logout-notice';

/**
 * 랜딩이 `?loggedOut=1`을 달고 열렸을 때 얹는 한 줄 안내.
 *
 * 로그아웃 착지는 이제 전용 화면(`/logout`)이라 이 표식은 옛 링크·뒤로가기로만
 * 되살아난다. 그래도 그 자리에서 사용자는 여전히 "다른 계정으로 로그인하려면
 * 무엇이 더 필요한가"를 물으므로, 답을 여기서 다시 늘어놓지 않고 그 답을 가진
 * 화면 하나로 보낸다.
 *
 * 예전에는 이 링크가 곧장 `github.com/logout`으로 나갔다. GitHub은 로그아웃 뒤
 * 우리에게 돌려보내 주지 않으므로 사용자는 남의 사이트에 남겨졌다 — 왕복을 설계해
 * 둔 자리는 제품에 한 곳(`/logout`)이면 된다.
 */
export function LogoutNoticeBanner() {
  return (
    <>
      {LOGOUT_NOTICE_MESSAGE}{' '}
      <Link
        href={LOGOUT_COMPLETE_PATH}
        className="font-semibold text-cosmos-copy underline underline-offset-2"
      >
        계정 전환 방법 보기
      </Link>
    </>
  );
}
