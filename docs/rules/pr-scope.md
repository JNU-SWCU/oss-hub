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
- 이 repo는 AGENTS.md §3 owner 표에서 기능별 owner 1인이 FE·BE 경로를 함께 소유한다. 따라서
  병렬화는 담당자가 다른 팀 간의 분할이 아니라, 한 owner가 자기 작업을 독립 소형 PR로 나누는
  형태다: 계약(스펙·타입) PR을 먼저 소형으로 병합한 뒤, FE PR과 BE PR을 서로 독립(순서 무관)으로
  연다. API 계약 변경은 [ADR-004](../decisions/ADR-004-REST-API-규격.md) 정합을 우선 확인한다.
- 여러 기능이 공유할 코드(유틸·타입·설정)는 기능 PR보다 먼저 독립 병합한다 — AGENTS.md §3
  공용 경로 규칙과 같은 원리다.
- 근거: [API contract-first](https://apisyouwonthate.com/blog/a-developers-guide-to-api-design-first/) ·
  [vertical slice architecture](https://deviq.com/architecture/vertical-slice-architecture/) ·
  [INVEST의 Independent](<https://en.wikipedia.org/wiki/INVEST_(mnemonic)>)

## 4. Stacked PR — 원칙은 직렬화, 예외만 얕게 스택

- 뒤 PR이 앞 PR 없이는 의미가 없는 순차 의존이어도 기본은 스택이 아니라 직렬화다: 앞 PR을
  병합한 뒤 다음 PR을 main에서 새로 연다.
- 근거: [ADR-005](../decisions/ADR-005-agent-driven-review-cycle.md)의 head SHA 재검증 규칙 때문에
  리베이스마다 하위 PR의 리뷰·검증이 무효화되고, 병합 시점은 승인 게이트로 작성자가 통제할 수
  없어 "base를 빨리 병합"을 전제로 삼을 수 없다.
- base 병합 지연을 감수하고도 미리 쌓을 가치가 있는 예외에서만 스택을 쓴다. 이때도 각 레이어는
  §2 크기 기준을 지키고 스택은 얕게 유지하며, 하위 PR은 Draft로 둔다.
- Graphite의 스택 운용은 일반적인 스택 관리 방식 참고로만 남긴다:
  [Graphite — Stacked PRs](https://graphite.com/blog/stacked-prs)

## 5. 충돌 표면 최소화

- PR이 건드리는 파일 수 자체를 줄이는 것이 병렬 병합의 가장 직접적인 수단이다.
- 파일 겹침이 예상되면 그 경로가 owner 전속인지 공용인지 먼저 판정하고 AGENTS.md §3을 따른다 —
  owner 전속 경로는 수정하지 않고 Issue·PR 코멘트로 제안하며, 공용 경로는 Issue로 선점한 뒤
  독립 소형 PR로 수정한다.
- 브랜치 수명은 짧게 유지한다.
- 근거: [trunk-based development — short-lived feature branches](https://trunkbaseddevelopment.com/short-lived-feature-branches/)

---

이 문서는 AGENTS.md §3(작성권·Draft PR·공용 경로)·§5(커밋 규칙)를 확장하며,
[ADR-004](../decisions/ADR-004-REST-API-규격.md)(API 계약 원본)와
[ADR-005](../decisions/ADR-005-agent-driven-review-cycle.md)(head 재검증·병합 게이트)를 따른다.
DB 마이그레이션 직렬 규칙(§3)은 이 문서보다 우선한다.
