---
slug: ADR-008-api-response-field-ownership
date: 2026-08-01
author: GoBeromsu
status: Accepted
references:
  - ADR-004-REST-API-규격
  - ADR-007-explicit-fallback-contract
refines: []
---

# ADR-008: API 응답 필드 소유 경계(Backend Judgment vs Frontend Static Copy)

## Status

Accepted

## Date

2026-08-01

## Context

랭킹 API에서 컴파일타임 한국어 상수 문장이 백엔드 응답 DTO 필드로 실려 나간 사례가 있었다. `RANKING_NOTICE`라는, 입력이나 상태와 무관하게 항상 같은 안내 문구가 `apps/backend/src/ranking/domain/ranking.ts`에 정의되어 `RankingPageResponseDto`(`apps/backend/src/ranking/dto/ranking-response.dto.ts`)의 `notice` 필드로 응답에 실렸고, 프런트엔드 `parseRankingPage`(`apps/frontend/src/features/ranking/api.ts`의 `parseRankingPage`)는 그 값을 `hasExactKeys` 필수 키 목록에 포함해 파싱 검증까지 했다.

백엔드는 이 문자열에 대해 아무 판정도 하지 않았다 — 입력이나 상태가 무엇이든 항상 동일한 문장을 그대로 내려보냈을 뿐이다. 그런데도 이 값이 API 응답 계약의 일부가 되면서, 문구를 바꾸려면 백엔드와 프런트엔드 파서를 함께 고쳐야 하는 불필요한 결합이 생겼다. 이 문제는 이번 작업에서 백엔드·프런트엔드 양쪽 계약에서 `notice` 필드를 제거해 해소했다 — 현재 `RankingPageResponseDto`에는 `notice` 필드가 없고(`period`, `items`, `page`, `pageSize`, `total`만 있다), `parseRankingPage`의 `hasExactKeys` 목록도 동일한 다섯 개 키로 좁혀졌으며, `apps/frontend/src/features/ranking/api.test.ts`는 `notice` 필드를 포함한 응답을 "계약 밖 필드"로 간주해 거부하는 테스트를 명시적으로 추가했다.

이 결정은 이 사례에서 드러난 재발 방지 원칙을 ADR로 고정한다. ADR-004(REST API 규격)는 응답의 형태(camelCase, envelope 없는 순수 DTO, ProblemDetail)를 고정했지만 "어떤 값을 응답 필드로 실어야 하는가"는 규정하지 않았고, ADR-007(명시적 fallback 계약)은 fallback·degradation의 표시 규칙을 다루지만 이 사례처럼 애초에 판정이 필요 없는 정적 문구가 계약에 섞여 들어오는 문제는 다루지 않는다. 이 결정은 그 공백을 메운다.

## Decision

> 프런트엔드는 정적인 것을 소유하고, 상태 판단은 백엔드가 한다. 백엔드 응답에는 백엔드만 알 수 있는 판정·상태값만 싣는다. 입력·상태와 무관하게 항상 같은 정적 표시 문구는 백엔드가 판정하는 것이 아니므로 응답 계약에 넣지 않는다. 백엔드가 굳이 내려보낼 이유가 없는 값은 내려보내지 않는다.

판별 기준은 다음 질문 하나로 정리한다.

> **이 값이 입력이나 상태에 따라 달라지는가?** 아니오 → 프런트엔드 상수여야 한다.

| 구분 | 판별 | 예시 |
| --- | --- | --- |
| 백엔드 소유(응답에 실어야 함) | 입력·상태에 따라 달라지는 판정 결과 | enum, boolean, 사유 코드, 수치, 날짜, 권한/가시성 판정 |
| 프런트엔드 소유(응답에 실으면 안 됨) | 값이 항상 동일한 표시 문구·라벨·안내 문장 — 백엔드가 계산하지 않는 것 | 컴파일타임 상수 안내 문구, 고정 라벨 텍스트 |

새 응답 필드를 설계할 때는 이 질문을 먼저 적용한다. 답이 "아니오"이면 그 값은 프런트엔드 상수로 두고 API 계약에 추가하지 않는다.

## 알려진 미해결 편차

이 원칙을 오늘 저장소 전체에 소급 적용하지는 않는다. 조사 결과 랭킹 사례와 같은 패턴(정적 문구가 판정 없이 응답 필드로 실리는 경우)은 백엔드 전체에서 추가로 발견되지 않았다. 다만 이 경계와 맞닿아 판단이 필요했던 두 건이 있어 아래에 기록한다.

### 1. `ProblemDetail.detail` — 의도적 예외

`apps/backend/src/programs/program-error-code.enum.ts`를 비롯한 도메인별 `*-error-code.enum.ts`는 각 오류 코드(`ProgramErrorCode` 등)마다 고정된 한국어 메시지를 `PROGRAM_ERROR_CODES`와 같은 맵에 선언한다. `apps/backend/src/common/problem-detail.filter.ts`의 `ProblemDetailFilter.toProblemDetail`(`ProblemDetailFilter.catch`가 호출)이 `detail: exception.errorCode.message`로 이 메시지를 그대로 응답에 싣고, 프런트엔드는 `apps/frontend/src/features/roles/admin-access-mutation-policy.ts`의 `adminAccessMutationErrorMessage`에서 `error.problem.detail`을 전역적으로 그대로 렌더한다. 같은 파일 주석(해당 함수 바로 위)에는 백엔드 `ProblemDetail.detail`을 authoritative 카피로 쓴다고 명시돼 있다.

이것은 랭킹 사례와 다르다. 개별 메시지 문자열 하나하나는 고정값이지만, **어떤 오류 코드가 발생했는가** 자체가 요청·상태에 따라 달라지는 판정 결과다. 즉 "코드에 따라 분기하는 유한 집합"이며 순수 정적 상수가 아니다. 또한 RFC 7807 `detail` 필드의 관례("사람이 읽을 수 있는 설명")에도 부합한다. 랭킹의 `notice`처럼 모든 응답에 무조건 동일하게 붙는 문구가 아니라 오류 코드에 종속된 값이므로, 이 결정의 위반 사례로 단정하지 않는다. 수정 파급이 전역적이므로(모든 도메인 오류 메시지와 프런트엔드 전역 렌더링 경로에 영향) 현행을 유지하고 이 ADR에는 의도적 예외로만 기록한다.

### 2. D-day 라벨 로직 중복 — 미해결 편차, 방향 미정

`apps/frontend/src/features/submissions/submission-checklist.ts`의 `milestoneDeadline` 함수는 `apps/backend/src/programs/program-deadline.ts`의 `programDeadline` 함수가 정의한 D-day 라벨 생성 규칙(Asia/Seoul 달력일 차이 계산, `마감 지남`/`오늘 마감`/`D-n` 라벨)을 프런트엔드에서 독립적으로 재구현했다 — `submission-checklist.ts`의 `milestoneDeadline` 바로 위 주석에도 "규칙은 backend program-deadline.ts와 동일"이라고 명시돼 있다. 체크리스트 API가 `dueAt`만 내려주고 라벨은 내려주지 않아 생긴 중복이다.

이 사례는 위 원칙과 반대 방향이다 — 백엔드가 이미 같은 판정 로직(`programDeadline`)을 갖고 있는데 그 결과를 응답에 싣지 않고 프런트엔드가 같은 로직을 다시 만들었다. D-day 여부·라벨은 `dueAt`과 현재 시각이라는 입력에 따라 달라지는 판정이므로 위 판별 기준으로는 "백엔드 소유" 쪽에 가깝지만, 타임존 규칙이 바뀌면 두 구현 중 한쪽만 고쳐질 위험이 있다는 점만 확인했을 뿐 해소 방향은 정하지 않는다. 가능한 해소 방향은 (a) 체크리스트 API 응답에 라벨/D-day를 추가해 백엔드로 판정을 일원화하거나, (b) 세 경로(체크리스트, 프로그램 상세, 마일스톤 행) 모두 프런트엔드에서 공통 유틸로 라벨을 생성하도록 정리하는 것 두 가지이며, 이번 결정에서는 어느 쪽도 선택하지 않는다.

이 두 건은 원칙 위반으로 단정하지 않는다 — 1번은 의도적 예외로 인정하고, 2번은 미해결 편차로 기록하되 해소 방향은 별도로 결정한다.

## Alternatives considered

### 백엔드 응답에 표시 문구를 포함해 프런트엔드 하드코딩을 줄인다

- Pros: 문구를 한 곳(백엔드)에서만 관리할 수 있고, 프런트엔드는 응답을 그대로 렌더링하면 된다.
- Cons: 값이 판정이 아니라 정적 문구일 때는 API 계약이 문구 하나를 바꾸는 데도 백엔드·프런트엔드 파서를 함께 고쳐야 하는 결합을 만든다. 랭킹 `notice` 사례처럼 프런트엔드의 exact-key 파싱 검증이 정적 문구 하나 때문에 깨지는 결과로 이어진다.
- **Rejected:** 정적 문구는 프런트엔드 상수로 두고, API 계약에는 판정이 필요한 값만 싣는다.

### 모든 표시 문자열을 예외 없이 프런트엔드로 옮긴다(오류 메시지 포함)

- Pros: 백엔드 응답 계약을 순수 데이터로만 완전히 좁힐 수 있다.
- Cons: `ProblemDetail.detail`처럼 어떤 오류 코드가 발생했는지 자체가 요청·상태에 따라 달라지는 판정의 결과인 값까지 강제로 프런트엔드 상수로 옮기면, 유한하지만 실제로는 상태 종속적인 정보를 억지로 정적 문자열 집합으로 흉내 내야 한다. 파급 범위도 전역적이다.
- **Rejected:** 판별 기준은 "값 자체가 고정이냐"가 아니라 "어떤 값이 나올지가 상태에 따라 달라지는가"다. 오류 코드별 메시지처럼 유한 집합 중 선택이 상태에 종속되면 백엔드 소유로 남긴다.

## Consequences

### Enables

- 새 응답 필드를 설계할 때 "입력·상태에 따라 달라지는가?"라는 단일 질문으로 백엔드·프런트엔드 소유를 즉시 판별할 수 있다.
- 정적 표시 문구를 바꿀 때 백엔드 배포와 프런트엔드 파서 갱신을 함께 하지 않아도 된다.
- 백엔드 응답 계약이 실제로 판정이 필요한 값으로만 좁혀져 계약의 의미가 명확해진다.

### Costs / trade-offs

- 기존에 백엔드가 값을 내려주던 습관에서, 새 필드를 추가할 때마다 "이 값이 정말 판정인가"를 먼저 검토하는 절차가 추가된다.
- `ProblemDetail.detail`과 D-day 라벨 중복처럼 원칙과 정확히 맞아떨어지지 않는 기존 사례가 있을 때, 이를 즉시 정리하지 않고 알려진 편차로 남겨두는 결정을 요구한다 — 판단을 미루는 비용이 발생한다.

### New constraints

- 새 API 응답 필드는 "입력이나 상태에 따라 달라지는가?"에 "아니오"로 답하면 추가하지 않는다. 그런 값은 프런트엔드 상수로 둔다.
- 오류 코드별 메시지처럼 유한 집합 중 선택이 상태에 종속되는 값은 이 원칙의 예외로 백엔드 소유를 유지할 수 있다 — 단 어떤 코드가 선택될지가 상태에 따라 달라진다는 근거가 있어야 한다.
- 같은 판정 로직을 프런트엔드와 백엔드가 각자 재구현하는 것을 새로 만들지 않는다. 기존 중복(D-day 라벨)은 이 ADR이 해소 방향을 정하지 않으므로 별도 결정 전까지 현행을 유지한다.

## Changelog

- 2026-08-01: initial decision — 랭킹 API `notice` 필드 제거 사례를 계기로 백엔드/프런트엔드 응답 필드 소유 경계 원칙을 확정했다. `ProblemDetail.detail`을 의도적 예외로, D-day 라벨 중복을 미해결 편차로 기록했다.

## References

- [ADR-004-REST-API-규격](ADR-004-REST-API-규격.md) — 응답 형태·오류 코드 계약
- [ADR-007-explicit-fallback-contract](ADR-007-explicit-fallback-contract.md) — fallback·degradation 표시 계약
