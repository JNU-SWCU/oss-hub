export function isEnglishGuide(url: URL): boolean {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const prefix = `${base}/en`;
  return url.pathname === prefix || url.pathname.startsWith(`${prefix}/`);
}
