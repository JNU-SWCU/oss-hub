export const languagePreferenceKey = 'oss-hub-guide-language';

export function preferredLanguage(saved, languages, language) {
  if (saved === 'ko' || saved === 'en') return saved;
  for (const candidate of [...(languages ?? []), language]) {
    const code = candidate?.toLowerCase().split('-')[0];
    if (code === 'ko' || code === 'en') return code;
  }
  return 'en';
}

export function languagePath(pathname, language, base) {
  const root = base.replace(/\/$/, '');
  const relative = pathname.slice(root.length).replace(/^\//, '').replace(/^(en|ko)(\/|$)/, '');
  if (!relative) return `${root}/${language}/`;
  return `${root}/${language === 'en' ? 'en/' : ''}${relative}`;
}

export function rootDestination(url, saved, languages, language, base) {
  const root = base.replace(/\/$/, '');
  if (url.pathname !== root && url.pathname !== `${root}/`) return null;
  if (preferredLanguage(saved, languages, language) === 'ko') return null;
  return `${root}/en/${url.search}${url.hash}`;
}
