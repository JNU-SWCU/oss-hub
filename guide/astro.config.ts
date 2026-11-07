import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://jnu-swcu.github.io',
  base: '/oss-hub',
  integrations: [
    starlight({
      title: { ko: 'OSS Hub 사용 가이드', en: 'OSS Hub User Guide' },
      description:
        '전남대학교 오픈소스 SW 개발 사업단 프로그램을 위한 OSS Hub의 역할별 사용 안내입니다.',
      defaultLocale: 'root',
      locales: {
        root: { label: '한국어', lang: 'ko' },
        en: { label: 'English', lang: 'en' },
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/JNU-SWCU/oss-hub',
        },
      ],
      head: [
        { tag: 'link', attrs: { rel: 'preconnect', href: 'https://cdn.jsdelivr.net', crossorigin: '' } },
        {
          tag: 'link',
          attrs: {
            rel: 'stylesheet',
            crossorigin: '',
            href: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css',
          },
        },
      ],
      customCss: ['~/styles/tokens.css', '~/styles/docs.css'],
      logo: { src: './src/assets/logo.svg' },
      components: {
        Footer: './src/components/Footer.astro',
        ThemeSelect: './src/components/ThemeToggle.astro',
        LanguageSelect: './src/components/LanguageSelect.astro',
        Header: './src/components/Header.astro',
        SiteTitle: './src/components/SiteTitle.astro',
      },
      sidebar: [
        { label: '서비스 소개', translations: { en: 'Introduction' }, slug: 'intro' },
        { label: '시작하기', translations: { en: 'Getting started' }, slug: 'start' },
        { label: '관리자', translations: { en: 'Administrators' }, collapsed: true, items: [{ autogenerate: { directory: 'admin' } }] },
        { label: '학생', translations: { en: 'Students' }, collapsed: true, items: [{ autogenerate: { directory: 'student' } }] },
        { label: '교직원', translations: { en: 'Staff' }, collapsed: true, items: [{ autogenerate: { directory: 'staff' } }] },
        { label: '자주 묻는 질문', translations: { en: 'Frequently asked questions' }, slug: 'faq' },
      ],
    }),
  ],
});
