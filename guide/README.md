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
