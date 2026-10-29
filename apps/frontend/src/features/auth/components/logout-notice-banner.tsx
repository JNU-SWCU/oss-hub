import {
  ACCOUNT_SWITCH_LINK_ID,
  LOGOUT_NOTICE_MESSAGE,
} from '../logout-notice';

export function LogoutNoticeBanner() {
  return (
    <>
      {LOGOUT_NOTICE_MESSAGE}{' '}
      <a
        href={`#${ACCOUNT_SWITCH_LINK_ID}`}
        className="font-semibold text-cosmos-copy underline underline-offset-2"
      >
        계정 전환 도움말
      </a>
    </>
  );
}
