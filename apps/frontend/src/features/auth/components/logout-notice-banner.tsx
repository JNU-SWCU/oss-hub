import Link from 'next/link';
import { LOGOUT_NOTICE_MESSAGE } from '../logout-notice';
import { SIGNUP_ENTRY } from '../signup-entry-link';
export function LogoutNoticeBanner() {
  return (
    <>
      {LOGOUT_NOTICE_MESSAGE}{' '}
      <Link
        href={`${SIGNUP_ENTRY.href}#account-help`}
        className="font-semibold text-cosmos-copy underline underline-offset-2"
      >
        계정 전환 도움말
      </Link>
    </>
  );
}
