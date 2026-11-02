# 가이드 본문 작성 지시서

집필 서브에이전트에게 그대로 넘기는 문서입니다. `<ROOT>`는 저장소(워크트리) 루트, `<G>`는 저장소 밖 작업 폴더입니다.

OSS Hub 사용자 가이드(`website/`, Astro Starlight)의 본문을 씁니다. 독자는 이 가이드만 보고 실제 서비스를 쓸 수 있어야 합니다. 요구는 "서비스 소개부터 사용 방법까지, 관리자 → 학생 → 교직원 순서로, 한국어로 자연스럽게, 최고 수준의 품질"입니다.

## 먼저 읽을 것

- `<G>/facts-<role>.md`, `<G>/manifest-<role>.md`
- `website/src/content/docs/<role>/index.mdx`, `website/src/components/`
- `skills/build-oss-hub-handbook/SKILL.md`와 `references/quality-checklist.md`
- **사실의 우선순위: 화면(매니페스트의 대조 결과) > 사실표 > 코드 > 추측.** 라벨은 화면에 나온 그대로 씁니다. 모르면 지어내지 말고 `apps/` 코드를 읽어 확인하거나 `<Verified status="needed" />`로 표시합니다. `apps/`는 읽기만 합니다.

## 구성 요소

```mdx
---
title: 팀 신청하기
description: 한 문장 요약
sidebar:
  order: 3
---
import { Steps } from '@astrojs/starlight/components';
import Shot from '~/components/Shot.astro';
import Success from '~/components/Success.astro';
import Recover from '~/components/Recover.astro';
import Verified from '~/components/Verified.astro';

<Steps>
1. `검색`을 누릅니다.
</Steps>
<Shot src="student/apply.webp" alt="…" caption="…" />
<Success>…</Success>
<Recover title="…">…</Recover>
참여 조건 <Verified status="done" />
```

- `Shot`의 `src`는 `website/src/assets/shots/` 기준이고 `alt`와 `caption`은 필수입니다. 없는 파일은 빌드가 실패합니다.
- `Verified`의 status는 `done`(확인 완료), `needed`(확인 필요), `policy`(정책 확인 필요)입니다.
- `Success`의 기본 제목은 "성공 신호", `Recover`의 기본 제목은 "막혔을 때"이며 `title`로 바꿀 수 있습니다.
- 사이드바는 `sidebar.order`로 만들어집니다. `index.mdx`(order 0, 개요)는 유지합니다.

## 페이지 구조

- 역할 개요(`index.mdx`): 이 역할이 무엇을 하는지, 5분 안에 시작하기, 작업별 목차.
- 작업마다 한 페이지. 제목은 독자가 하려는 일로 짓습니다("사용자 역할 바꾸기"). 메뉴 이름을 제목으로 삼지 않습니다.
- 각 페이지 순서: 이 화면이 무엇을 위한 곳인지 → 번호 단계와 이미지 → 성공 신호(`Success`) → 막혔을 때(`Recover`).
- 위험한 동작의 경고는 그 동작 직전에 둡니다. 자동으로 되는 일과 직접 해야 하는 일을 구분합니다. 빈 상태, 비활성 버튼, 오류에서 벗어나는 법을 설명합니다.
- 같은 내용을 여러 페이지에 반복하지 말고 링크합니다.

## 이미지

- 이미지를 직접 Read로 열어 본 뒤 씁니다. 매니페스트만 믿지 않습니다.
- 이미지의 빨간 번호 박스와 본문 단계 번호를 맞춥니다. 이미지에 ①②가 있으면 본문에서 "①", "②"로 가리키거나 단계 번호를 같게 합니다. 번호가 어긋나면 독자가 헷갈립니다.
- 이미지의 흐림 처리는 개인정보 보호용입니다. 개요에서 한 번만 짧게 알리고 매번 언급하지 않습니다.
- 안 쓰는 이미지가 있어도 괜찮습니다. 장식용으로 넣지 않습니다. 필요한데 없으면 최종 보고에 적습니다.

## 한국어

- 정중한 "-합니다"체. 번역투와 AI 투를 피합니다: "~를 통해", "~할 수 있습니다"의 남발, "다양한", "효과적으로", "간편하게", 빈 수식, 영어식 수동태, 쌍점 뒤 명사 나열, 의미 없는 대구.
- 문장은 짧게, 독자가 할 일부터. 예: "권한을 변경하기 위해서는 다음 절차를 수행해야 합니다" → "권한을 바꾸려면 아래 순서대로 하세요".
- 버튼과 메뉴 라벨은 백틱으로 화면 그대로 씁니다.
- 역할 이름은 `관리자`, `학생`, `교직원`으로 통일합니다.

## 금지

- 사람 이름, GitHub 아이디, 이메일, 학번, 비밀번호, 토큰, 시드 계정 이름을 본문, alt, caption에 쓰지 않습니다. 예시가 필요하면 이름 대신 역할로 지칭합니다.
- 개발 환경 주소(localhost), 시드, 합성 데이터, 캡처 방식을 언급하지 않습니다. 저장소 내부 파일 경로도 언급하지 않습니다.
- `apps/`, `scripts/` 수정 금지. 커밋과 푸시 금지. 자기 폴더 밖의 파일 수정 금지. 코드에 주석 추가 금지.
- 제품 결함을 본문에 "버그"로 쓰지 않습니다. 현재 동작을 사실대로 안내하고 우회 방법을 적고 결함은 최종 보고에 적습니다.

## 검증

```bash
cd <ROOT>/website && pnpm exec astro build --outDir <G>/build-<role>
```

통과해야 합니다. 다른 집필 에이전트가 동시에 돌리므로 캐시 충돌로 실패하면 잠시 뒤 다시 돌립니다. 이미지 위치나 번호가 본문과 어긋나는지 눈으로 읽어 확인합니다.

## 최종 보고 (짧게)

쓴 페이지 목록, 못 쓴 내용과 이유, `Verified needed/policy`로 남긴 항목, 제품 결함 후보(Area / Observed / Expected / Evidence).
