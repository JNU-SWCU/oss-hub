# 사이트 골격 (처음부터 만들 때)

`website/`가 이미 있으면 이 문서는 읽기만 하고 넘어갑니다. 아래는 현재 파일에서 읽은 사실입니다.

## 스택

- Astro 7.4.4, `@astrojs/starlight` 0.42.8, `sharp` 0.35.5. 패키지 이름 `oss-hub-guide`, pnpm 11.0.0, Node 24 이상.
- 루트 워크스페이스와 독립입니다. `website/pnpm-workspace.yaml`은 `packages: []`이고 `allowBuilds`에 `esbuild`, `sharp`를 둡니다. 자체 `pnpm-lock.yaml`을 가집니다.
- 스크립트: `pnpm dev`, `pnpm build`(`dist/`와 Pagefind 검색 색인 생성), `pnpm preview --port 4331`.

## 설정 (`website/astro.config.ts`)

- `site: 'https://jnu-swcu.github.io'`, `base: '/oss-hub'`.
- Starlight 제목 `OSS Hub 사용 가이드`, 기본 로케일 `ko`(root), GitHub 링크 `https://github.com/JNU-SWCU/oss-hub`.
- 글꼴: Pretendard Variable 동적 서브셋을 jsDelivr `<link>`(preconnect `cdn.jsdelivr.net`, `orioncactus/pretendard@v1.3.9`)로 불러옵니다. 대체 글꼴에 Noto Sans KR을 둡니다.
- `customCss`: `~/styles/tokens.css`, `~/styles/docs.css`. Footer 컴포넌트는 `./src/components/Footer.astro`로 덮어씁니다.
- 사이드바 순서: 서비스 소개(`intro`), 시작하기(`start`), 관리자(`admin` 자동 생성), 학생(`student`), 교직원(`staff`), 자주 묻는 질문(`faq`).

## 파일 배치

```
website/
  astro.config.ts
  src/site.ts                 lastChecked, releaseVersion, serviceUrl
  src/content.config.ts
  src/content/i18n/ko.json
  src/content/docs/{intro,start,faq}.mdx
  src/content/docs/{admin,student,staff}/index.mdx 와 작업별 mdx
  src/pages/index.astro       랜딩(src/assets/shots/landing/*.webp 사용)
  src/components/{Shot,Success,Recover,Verified,Footer,SiteNote}.astro
  src/styles/{tokens,docs}.css
  src/assets/shots/<role>/<name>.webp
  public/favicon.svg
```

랜딩의 이미지 틀은 비율을 강제하지 않습니다. `aspect-ratio`와 `object-fit: cover`를 함께 쓰면 제대로 찍은 세로 이미지도 소리 없이 잘립니다. 이미지는 `width: 100%; height: auto`로 두고, 고정 비율은 이미지가 없을 때의 빈 틀에만 씁니다.

`src/site.ts`는 `lastChecked`(마지막으로 화면을 확인한 날짜), `releaseVersion`(대조한 제품 버전), `serviceUrl`(`https://jnu-oss-hub.com`)을 가집니다. 화면을 다시 확인할 때마다 앞의 둘을 고칩니다.

## 컴포넌트 계약

| 컴포넌트 | 속성 | 동작 |
|---|---|---|
| `Shot` | `src`, `alt`, `caption` 모두 필수 | `/src/assets/shots/**/*.{webp,png,jpg}`를 glob으로 찾습니다. 파일이 없으면 `Shot: src/assets/shots/<src> 파일이 없습니다.`로 빌드가 실패합니다. 클릭하면 확대 대화상자가 열립니다. 너비 640/960/1440으로 만듭니다 |
| `Success` | 기본 제목 `성공 신호` | 성공했을 때 화면에 보이는 것 |
| `Recover` | `title`(기본 `막혔을 때`) | 막혔을 때의 대처 |
| `Verified` | `status`: `done`, `needed`, `policy` | 각각 `확인 완료`, `확인 필요`, `정책 확인 필요` 배지 |
| `Steps` | Starlight 내장 | 번호 단계 |

`Shot`은 없는 파일을 빌드에서 막는 것이 핵심입니다. 이 덕분에 이미지 없이 본문만 올라가는 일을 CI가 걸러 줍니다.

## 콘텐츠 규칙

- frontmatter: `title`, `description`, `sidebar.order`. 역할 폴더의 `index.mdx`는 order 0.
- MDX 가져오기: `Steps`는 `@astrojs/starlight/components`에서, 나머지는 `~/components/<Name>.astro`에서 가져옵니다.
- 현재 페이지 목록(변경될 수 있으니 `ls website/src/content/docs/*/`로 다시 확인): 관리자(지원자, 감사 로그, 역할 변경, 비활성화, 프로그램 삭제, 사용자 찾기, 첫 진입, 인사이트, 내 설정, 시스템 상태), 학생(활동, 신청, 게시판, 프로그램 찾기, 초대, 내 팀, 저장소, 재제출, 설정, 가입, 제출), 교직원(프로그램 만들기, 대시보드, 프로그램 고치기, 첫 진입).

## 처음부터 만드는 순서

1. 위 스택과 설정으로 골격을 만들고 `pnpm install`, `pnpm build`가 통하는지 봅니다.
2. 컴포넌트 다섯 개와 스타일을 만듭니다.
3. 빈 `index.mdx` 세 개와 `intro`, `start`, `faq`를 만들어 사이드바 순서를 확인합니다.
4. `.github/workflows/website-pages.yml`과 `website-check.yml`을 만듭니다(내용은 `release-and-automation.md`).
5. 저장소 설정에서 Pages 소스를 GitHub Actions로 둡니다.
6. 캡처와 집필로 넘어갑니다(`orchestration.md`).
