# Frontend 구현 규칙

## feature 단위 폴더

frontend 코드는 화면 또는 업무 기능을 기준으로 묶는다. 한 feature에 속한 컴포넌트, hooks, 상태, 타입, 테스트는 해당 feature 폴더 가까이에 둔다. 여러 feature가 공유하는 UI와 유틸리티만 공용 위치로 올린다.

```text
apps/frontend/
├── app/                       # 라우팅과 페이지 조합
├── features/
│   └── users/
│       ├── components/
│       ├── hooks/
│       ├── types.ts
│       └── api.ts
├── components/                 # 여러 feature가 공유하는 UI
└── lib/
    └── api-client.ts           # 유일한 HTTP 클라이언트
```

페이지는 feature를 조합하고, feature 내부 코드는 다른 feature의 내부 경로에 직접 의존하지 않는다. 공유가 필요하면 공용 계약을 명시적으로 추출한다.

## feature 내부 업무 경계

`programs/`는 `catalog`, `authoring`, `applications`, `teams`, `documents`, `staff-dashboard`가 각각 API·DTO·화면 모델을 소유한다.
루트 `program-contract.ts`는 실제 공유 개념만, `program-paths.ts`는 경로 생성과 route ID 해석만 소유한다.
`roles/onboarding`은 가입 선택과 본인의 접근 신청을, `roles/access-administration`은 사용자·접근 신청·독립 권한·관리자 프로필 관리를 소유한다.
회원 유형과 staff/admin 권한을 하나의 역할 타입으로 합치지 않는다.

업무 사이에서는 [명시된 진입 모듈](../../apps/frontend/eslint-rules/feature-ownership.mjs)을 사용한다.
이 목록은 실제로 공유되는 DTO·API·순수 정책·기존 UI 조합의 좁은 계약이며 전체 모듈 재수출 경로가 아니다.
새 소비자가 필요하면 그 모듈의 책임과 소비자를 확인한 뒤 진입점 목록을 갱신한다.
ESLint는 alias·relative·type-only·runtime·정적 dynamic import에 같은 내부 경계를 적용하고 test-owned 조합은 생산 간선과 구분한다.
내부 import 금지는 동일 endpoint 복제나 도메인 코드를 무조건 `lib`로 올리는 이유가 되지 않는다.

`*-screen.tsx`는 조회·변경·이동·원격 상태를 조정한다.
`*-content.tsx`와 `*-view.tsx`는 전달받은 props를 렌더링하며 표시용 로컬 상태를 가질 수 있다.
DTO와 endpoint 구현을 분리하고 순수 모델이 전송 모듈에서 타입을 가져오지 않게 한다.
응답 검증은 API 반환 전에 기존 파서를 연결하며 이동을 이유로 필수 필드·exact-key·deep validation 계약을 강화하지 않는다.

## 단일 API 클라이언트

HTTP 요청은 반드시 `lib/api-client.ts`를 통해 보낸다. API baseURL은 이 파일의 `/api/v1` 한 곳에서만 정의한다. feature의 `api.ts`는 endpoint별 함수와 DTO 변환만 정의하며 `fetch`, 별도 HTTP 인스턴스, `/api/v1` 문자열을 새로 만들지 않는다.

```ts
// lib/api-client.ts
const baseURL = '/api/v1';
```

서버 렌더링, 인증 헤더, 오류 변환이 필요해져도 baseURL과 전송 책임은 이 클라이언트에 추가한다. feature별로 우회 클라이언트를 만들지 않는다.

## 위반 탐지

리뷰에서 `apps/frontend`의 `fetch(`, `axios`, `ky`, `'/api/v1'`, `"/api/v1"` 사용을 확인한다. `lib/api-client.ts` 밖에서 발견되면 단일 클라이언트 규칙 위반으로 처리한다. lint 또는 정적 검사 도입 시 같은 범위를 검사 규칙으로 자동화한다.

## Affordance는 런타임 상태 추측으로 숨기지 않는다

UI affordance는 런타임 상태 추측으로 숨기지 않는다. 실패는 액션 시점에 ProblemDetail 에러로 표면화한다(ADR-007).

## 폼 액션 정렬

폼의 제출/취소 버튼 그룹은 우측 정렬(`justify-end`)한다. 다단계 폼에서 이전/다음처럼 이전 단계로 돌아가는 액션을 반대쪽에 떼어놓아야 하는 경우에만 `justify-between`을 쓴다. 다이얼로그/모달 푸터의 액션 그룹도 동일하게 `justify-end`다. 카드 항목의 인라인 액션(수락/거절, 수정/삭제 등 목록 행 단위 액션)은 폼 제출이 아니므로 이 규칙 대상이 아니다.
