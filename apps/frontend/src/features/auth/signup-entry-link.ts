export const SIGNUP_ENTRY = {
  href: '/signup',
  label: '로그인',
  compactLabel: '로그인',
} as const;

export function shouldShowEntryLink(
  destinationHref: string,
  pathname: string,
): boolean {
  return destinationHref !== pathname;
}
