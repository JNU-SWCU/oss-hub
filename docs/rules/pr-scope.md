# PR 범위·분해 기준

이 문서는 하나의 PR에 얼마나 많은 변경을 담을지, 언제 어떤 기준으로 쪼갤지 정한다.
AGENTS.md §5의 커밋 단위 규칙("및·그리고"가 들어가면 쪼갠다)을 PR 단위로 확장한 것이다.

## 1. 원칙 — PR = 하나의 논리적 변경

- 판정 휴리스틱: ① PR 제목에 '및·그리고'가 필요한가 ② 이 PR을 revert하면 정확히 하나의
  의미 단위가 사라지는가 ③ 리뷰어가 한 세션(약 60분)에 완독 가능한가.
- 리팩터링과 동작 변경을 같은 PR에 섞지 않는다.
- 근거: [Google eng-practices — Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html)

## 2. 크기 기준 — 게이트가 아닌 분해 검토 트리거

- 변경 200~400줄을 넘으면 분해를 먼저 검토한다. 줄 수만이 아니라 파일 수도 본다.
- 근거: [SmartBear — Best Practices for Peer Code Review](https://smartbear.com/learn/code-review/best-practices-for-peer-code-review/)
  (세션당 200~400줄에서 결함 탐지율 유지)

## 3. 분해 이음새 — 수직 슬라이스 우선

- 기본은 기능 단위 수직 슬라이스다. 레이어(FE/BE) 분할 자체를 목적으로 삼지 않는다.
- FE·BE를 병렬로 진행하려면: API contract(스펙·타입) PR을 먼저 소형으로 병합한 뒤,
  FE PR과 BE PR을 서로 독립(순서 무관)으로 연다. contract가 병합된 순간이 병렬화의 분기점이다.
- 여러 기능이 공유할 코드(유틸·타입·설정)는 기능 PR보다 먼저 독립 병합한다 — AGENTS.md §3
  공용 경로 규칙과 같은 원리다.
- 근거: [API contract-first](https://apisyouwonthate.com/blog/a-developers-guide-to-api-design-first/) ·
  [vertical slice architecture](https://deviq.com/architecture/vertical-slice-architecture/) ·
  [INVEST의 Independent](<https://en.wikipedia.org/wiki/INVEST_(mnemonic)>)

## 4. Stacked PR — 진짜 순차 의존일 때만, 얕게

- 뒤 PR이 앞 PR 없이는 의미가 없을 때만 스택을 쓴다. 순서를 강제하지 않는 관심사를 스택에
  쌓지 않는다.
- 각 레이어도 §2 크기 기준을 지키고, 스택은 얕게 유지하며 base PR을 빨리 병합해 리베이스
  전파 비용을 줄인다. 작업 중인 하위 PR은 Draft로 둔다.
- base가 변경되면 하위 브랜치를 즉시 리베이스한다.
- 근거: [Graphite — Stacked PRs](https://graphite.com/blog/stacked-prs)

## 5. 충돌 표면 최소화

- PR이 건드리는 파일 수 자체를 줄이는 것이 병렬 병합의 가장 직접적인 수단이다.
- 다른 사람과 같은 파일을 건드릴 것으로 예상되면 착수 전에 Issue로 알린다 — AGENTS.md §3
  공용 경로 선점의 일반화다.
- 브랜치 수명은 짧게 유지한다.
- 근거: [trunk-based development — short-lived feature branches](https://trunkbaseddevelopment.com/short-lived-feature-branches/)

---

이 문서는 AGENTS.md §3(작성권·Draft PR·공용 경로)·§5(커밋 규칙)를 확장하며 상충하지 않는다.
DB 마이그레이션 직렬 규칙(§3)은 이 문서보다 우선한다.
