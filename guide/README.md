# OSS Hub 사용 가이드

GitHub Pages(`https://jnu-swcu.github.io/oss-hub/`)로 배포하는 Astro + Starlight 사이트입니다. 루트 pnpm 워크스페이스와 별개이며 자체 lockfile을 씁니다.

```sh
cd guide
pnpm install
pnpm dev       # 개발 서버
pnpm build     # dist/ 와 Pagefind 색인 생성
pnpm preview --port 4331
```

PR이면 `.github/workflows/guide-check.yml`이 빌드만 검증하고, `main`에 머지되면 `.github/workflows/guide-pages.yml`이 Pages에 배포합니다. 두 워크플로는 `guide/**` 변경에만 반응합니다.

## 문서 작성

역할별 문서는 `src/content/docs/{admin,student,staff}/*.mdx`에 두며 사이드바에 자동으로 나타납니다. 순서는 frontmatter의 `sidebar.order`로 정합니다. 마지막 확인일과 배포본은 `src/site.ts` 한 곳에서 고칩니다.

## 컴포넌트

```mdx
import { Steps } from '@astrojs/starlight/components';
import Shot from '~/components/Shot.astro';
import Success from '~/components/Success.astro';
import Recover from '~/components/Recover.astro';
import Verified from '~/components/Verified.astro';

<Steps>

1. 프로그램 카드를 선택합니다.
2. **신청하기**를 누릅니다.

</Steps>

<Shot src="student/apply.webp" alt="신청 정보 입력 화면" caption="신청 정보를 입력하는 화면" />

<Success>신청 상태가 **제출 완료**로 바뀝니다.</Success>

<Recover title="신청하기가 보이지 않을 때">신청 기간인지 확인합니다.</Recover>

참여 조건 <Verified status="done" />
```

- `Shot`: `src`는 `src/assets/shots/` 기준 경로(webp·png·jpg)이며 `alt`와 `caption`이 필수입니다. 파일이 없으면 빌드가 실패합니다. 클릭하면 확대됩니다.
- `Success`, `Recover`: 본문을 슬롯으로 받고 `title`로 제목을 바꿀 수 있습니다(기본 `성공 신호`, `막혔을 때`).
- `Verified`: `status`는 `done`(확인 완료), `needed`(확인 필요), `policy`(정책 확인 필요) 중 하나입니다.
- 랜딩 화면 이미지는 `src/assets/shots/landing/<hero|explore|apply|decide|submit>.webp`를 두면 자동으로 채워집니다.

## 한국어와 영어 가이드

- 한국어가 기본 언어이며 기존 `/oss-hub/`, `/oss-hub/start/`, `/oss-hub/{admin,student,staff}/` 주소를 유지합니다.
- 영어 문서는 `src/content/docs/en/`에 두며 `/oss-hub/en/`으로 서비스합니다. 한국어와 동일한 파일 구조를 유지합니다. 영어 랜딩은 Starlight의 기본 `splash` 템플릿을 사용하며 한국어 커스텀 홈페이지를 복제하지 않습니다.
- Starlight의 언어 선택기는 문서 언어를 전환합니다. 한국어 커스텀 홈페이지에는 별도 English 링크가 있습니다. 영어 본문과 랜딩의 내부 링크에는 `/oss-hub/en/`을 사용합니다. 번역한 제목의 앵커는 한국어 앵커와 다르므로 교차 문서 링크를 확인하세요.
- 사이드바의 명시적 항목은 `astro.config.ts`의 `translations.en`으로 번역합니다. 역할별 자동 생성 항목은 영어 파일의 `title`과 `sidebar.order`를 사용합니다. 제목은 `title.ko`와 `title.en`으로 설정합니다.
- 공통 컴포넌트는 공통 `components/locale.ts`에서 base를 포함한 `/en` 경로를 판별하여 영어 기본 제목, 검증 배지, 이미지 확대·닫기·모바일 힌트, 테마 전환 버튼, 확인일 푸터를 표시합니다. Starlight 밖의 한국어 홈페이지에서는 기존 한국어 기본값을 유지합니다. `title`을 직접 전달하면 해당 문서에서 번역해야 합니다.
- 제품 UI와 스크린샷은 한국어 그대로입니다. 영어 설명은 실제 한국어 라벨을 백틱으로 보존하고 영어 풀이를 붙입니다. 영어 문서는 제품의 영어 UI 지원을 의미하지 않습니다. 기존 스크린샷 파일을 공유하고 `alt`와 `caption`만 번역합니다.
- 번역만 할 때는 `src/site.ts`의 `lastChecked`, `releaseVersion`, `checkedCommit`을 갱신하지 않습니다. 문서 번역일과 제품 검증일은 다릅니다.

번역 변경 검수 시 두 언어의 홈페이지, 사이드바, 언어 전환, 검색, 이전·다음 페이지, 이미지 대화상자, 모바일 메뉴와 테마 전환을 확인합니다. 배포 전 기존 빌드 명령으로 두 언어 경로와 Pagefind 색인을 함께 검증합니다.
