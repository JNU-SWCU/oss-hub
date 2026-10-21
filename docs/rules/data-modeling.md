# 데이터 모델 규칙 (백엔드)

이 문서는 `schema.prisma`에 테이블을 추가할 때, 모델·필드 이름을 정할 때, 공개 집계용 projection을 설계할 때 적용한다.
아래 규칙은 모두 이 저장소의 실제 스키마에서 확인된 사례에서 나왔다.

## 1. 모델의 실제 읽기·쓰기와 트랜잭션 소유자를 확인한다

모델 이름만으로 개념이나 writer를 판단하지 않는다. `GithubRepository`는 원격 identity/관측과 신청 연결을 함께 보존한다. provisioning, inventory, OWN 연결, 공개 전환, purge가 서로 다른 필드와 변경 사실을 소유한다. 테이블당 파일 하나를 강제하지 않고 각 변경의 권한·CAS·lock·audit/outbox 원자성을 기록한다.

조사는 delegate 이름뿐 아니라 transaction/db 별칭, nested mutation, raw SQL, migration, CLI와 외부 reader까지 포함한다. `rg` 검색은 출발점이며 검색 결과 0건은 운영 데이터 0건이나 제거 허가를 뜻하지 않는다. 정본·projection·호환 사본을 구분하고 삭제 전에는 운영 행·외부 consumer·보존 의무를 확인한다.

[45개 모델 소유·관계 목록](../backend-model-ownership.md)은 기준 commit의 grain·키·관계·writer/reader·보존·공개 경계를 고정한다. 코드 리팩터와 물리 스키마 변경은 별도 검증 단위다.

## 2. 행의 단위와 관계를 먼저 정한다

GitHub 활동 수집에서 사용하는 관계 축은 다음과 같다. 프로그램·팀·신청·문서까지 이 세 축에 끼워 넣지 않는다.

| 축 | 답하는 질문 |
| --- | --- |
| `repository ↔ user ↔ date` | 어느 저장소에서 누가 어느 날 기여했는가 |
| `user ↔ year` | 그 사람이 한 해 동안 GitHub에서 얼마나 활동했는가 |
| `repository ↔ observation/event` | 저장소의 어떤 상태를 관측하거나 변경했는가 |

`Contribution(repositoryId, githubId, date)`과 `GithubUserActivityHistory(githubId, year)`는 모집단·키·원천이 다르다. 가짜 repository id를 만들어 합치지 않는다. 사람 축 writer는 ACTIVE 가입자를 순회하며 당해 연도 관측값을 upsert하고, 지난 연도 행은 유지한다. 연도별 행이 있다는 사실은 매 관측마다 불변 사건을 append한다는 뜻이 아니다.

프로그램 소속, 준비 단계 참여, 확정 팀원, 신청 회차, 제출 상태 헤더와 불변 검토 사건도 각각 다른 grain과 수명을 가진다. JSON 답변·메시지 payload·감사 metadata는 버전 있는 문서 계약을 먼저 확인하고, JSON이라는 이유만으로 EAV나 개별 테이블로 분해하지 않는다.

## 3. 공개 경계는 명시적 query와 응답 allowlist가 지킨다

외부 GitHub id와 내부 User FK의 선택은 데이터의 출처·소속·삭제·보존 의미로 판단한다. `GithubUserActivityHistory`는 외부 githubId와 githubLogin을 보존하지만 현재 person sweep의 대상은 ACTIVE 가입자다. FK가 없다는 사실만으로 private JOIN이 불가능해지거나 미가입자 랭킹을 보장하지 않는다.

공개 query는 승인된 repository의 명시적 `select`와 response allowlist를 사용한다. public/STUDENT 응답과 ACTIVE STAFF/ADMIN 응답의 필드 차이, private/nonexistent 동일 오류, 현재 권한 조회 시점을 유지한다. 이름·학과 등 private 필드를 먼저 전부 읽고 나중에 지우는 방식으로 바꾸지 않는다.

표시값을 복사하는 경우 원본, 갱신 주기, 부분 갱신 시 drift 처리, 계정 비활성화·연결 해제 뒤 보존 의미를 명시한다. nullable legacy alias를 새 데이터와 같은 사실이라고 추정해 채우지 않는다.

## 4. 이름은 grain과 가변성을 표현한다

- 현재 상태를 덮어쓰는 snapshot, 불변 event, 관측 fact, 조회 projection을 구분한다. 시간 필드나 연도 키만으로 `History`를 강제하거나 `Snapshot`·`Fact`를 금지하지 않는다.
- 이름은 도메인에서 사용하는 말을 쓰고 불필요하게 축약하지 않는다. 외부 출처가 중요하면 `Github*`로 밝힌다.
- 영속 계층은 `*Repository`를 유지한다. 모델 이름과 클래스 접미사를 바꾸기보다 각 쓰기·읽기 책임을 분명히 한다.
- GitHub 경로는 `nameWithOwner`로 표현한다. 사람 이름인 `name`과 혼동하지 않는다.

논리 이름만 고치면 되는 경우 Prisma `@map`/`@@map`으로 물리 이름을 보존할 수 있다. 물리 rename·column 제거·FK 추가는 generated client, raw SQL, 제약/인덱스, 외부 consumer를 조사한 별도 migration으로 다룬다. 기존 migration을 다시 쓰지 않는다.

스키마 후보는 현행 유지안과 변경안을 비교하고 expand → 근거 있는 backfill → reader/writer 전환 → 동등성 검증 → contract 순서, 잠금 비용, 버전 공존, 중단점, 백업/rollback을 기록한다. 운영 null 출처나 과거 사건 대응이 불명확하면 보존하고, 실제 DB 검사·migration·배포는 승인된 별도 범위에서 수행한다.

## 5. 외부 API 전제는 문서 기억이 아니라 실측으로 확정한다

GitHub API 동작을 기억으로 단정하지 않는다. 새 쿼리를 설계에 넣기 전에 최소한 응답 status·에러 타입·rate limit cost를 한 번 호출해 확인하고, 그 결과를 설계 문서에 남긴다.

실제로 뒤집힌 전제: `contributionsCollection(from, to)`의 1년 창 제한은 권고가 아니라 하드 `VALIDATION` 에러이며, 초과 시 쿼리 자체가 거부된다. "명문 규정이 아니다"라고 적힌 설계 전제가 첫 호출에서 무너졌다.

증거는 public-safe 형태로만 남긴다 — 토큰, 실명, private 저장소 식별자를 붙여넣지 않는다(`docs/rules/security.md`).

---

이 문서는 [AGENTS.md Code Conventions](../../AGENTS.md#code-conventions--common-patterns)(DB 마이그레이션 직렬 규칙)와 [AGENTS.md Architecture & Data Flow](../../AGENTS.md#architecture--data-flow)(공개 query와 응답 allowlist 경계)를 확장하며, [ADR-003](../decisions/ADR-003-backend-architecture.md)(백엔드 아키텍처)을 따른다.
스키마 변경 PR의 범위·분해 기준은 [`pr-scope.md`](pr-scope.md)가 원본이다.
