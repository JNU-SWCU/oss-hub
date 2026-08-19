# 데이터 모델 규칙 (백엔드)

이 문서는 `schema.prisma`에 테이블을 추가할 때, 모델·필드 이름을 정할 때, 공개 집계용 projection을 설계할 때 적용한다.
아래 규칙은 모두 이 저장소의 실제 스키마에서 확인된 사례에서 나왔다.

## 1. 새 테이블을 만들기 전에 같은 개념의 기존 테이블 writer/reader를 먼저 읽는다

모델 이름이 그 모델의 개념을 보장하지 않는다. `GithubRepository`는 저장소 엔티티이면서 동시에 신청 1건당 프로비저닝 기록이기도 하다 — `applicationId @unique`(nullable, `#617` 단계 D에서 흡수)가 그 정체를 드러낸다. 유일한 writer는 `apps/backend/src/github/repository/repository-provision-state.repository.ts` 하나다.

절차: 모델 이름이 아니라 실제 접근 지점을 센다.

```bash
grep -rn "prisma\.<모델명 camelCase>\." apps/backend/src --include='*.ts'
```

- writer 0건 → 죽은 테이블이다. 새 테이블을 얹기 전에 제거 여부를 먼저 판단한다.
- writer 1곳 → 그 파일이 이 테이블의 개념 정의다. 스키마 주석보다 그 코드를 믿는다.

이 확인을 건너뛰면 같은 저장소가 두 테이블에 중복 저장되고, 어느 쪽이 진실인지 판정할 수 없게 된다.

## 2. 모델링 축은 엔티티가 아니라 관계다

이 도메인의 축은 둘이다.

| 축 | 답하는 질문 |
| --- | --- |
| `user ↔ repository` | 누가 어느 저장소에 얼마나 기여했는가 |
| `user ↔ yearly activity history` | 그 사람이 한 해 동안 GitHub에서 얼마나 활동했는가 |
| `repository ↔ history` | 그 저장소가 시점별로 어떤 상태였는가 |

새 테이블은 셋 중 한 축에 배치할 수 있어야 한다. 어느 축에도 속하지 않는 테이블은 죽는다 — 이 저장소에서 실제로 셋이 그렇게 됐다. `OrgRepositoryInventory`·`OrgRepositoryActivityEvent`는 production writer가 0건이었고, `RepositoryOwnerProjection`은 reader가 한 곳뿐인데 그 모듈을 쓰는 곳이 없었다. 셋 다 "저장소 그 자체"를 독립 엔티티로 붙잡으려다 아무 질문에도 답하지 못하게 되어 제거됐다.

반대로 축이 다르면 합치지 않는다. 이력을 갖는 관계와 시점 사실은 키가 다르다 — 억지로 한 테이블에 넣으면 한쪽 행에서 PK 컬럼이 NULL이 되어야 하는데 PostgreSQL은 이를 허용하지 않는다.

`user ↔ repository`와 `user ↔ yearly activity history`가 정확히 그 관계다. 앞의 축은 `Contribution(repositoryId, githubId, date)`이 담고 "우리 저장소에서 무엇이 일어났는가"(② 팀 기여도·프로그램 지표)에 답한다. 뒤의 축은 `GithubUserActivityHistory(githubId, year)`가 담고 저장소를 거치지 않은 채 "그 사람이 올 한 해 얼마나 활동했는가"(랭킹)에 답한다. 뒤의 축에는 `repositoryId`가 존재하지 않으므로 두 축을 한 테이블에 합칠 수 없고, 가짜 `repositoryId`를 만들어 억지로 넣지도 않는다.

`GithubUserActivityHistory`의 grain은 그 writer가 정의한다(§1) — 사람 축 수집 서비스가 가입(ACTIVE) 사용자를 순회하며 `(githubId, year)` 한 행을 관측할 때마다 전량 재계산으로 upsert한다. 당해 연도 행은 관측마다 덮어쓰고 지난 연도 행은 그대로 남으므로 연도 축을 따라 행이 쌓이며, 그래서 이름이 `History`로 끝난다(§4). `User` FK는 걸지 않고 `githubId` 값으로 키를 잡아 `githubLogin`까지만 비정규화한다(§3) — 실명·학과는 담지 않고 조회 시점에 join한다.

## 3. projection 행은 내부 FK 없이 독립적으로 완결시킨다

공개 집계·공개 응답용 테이블은 내부 `User`를 FK로 참조하지 않는다. GitHub 숫자 id로 키를 잡고 표시값(`githubLogin`, `nameWithOwner`)을 비정규화해 행 하나만으로 표시가 끝나게 한다 — `GithubUserActivityHistory`가 이 패턴이다. `githubId`로 키를 잡고 `githubLogin`까지만 비정규화하며 실명·학과는 담지 않고 조회 시점에 join한다.

이유는 둘이다.

- 내부 FK를 넣으면 아직 가입하지 않은 기여자가 조용히 집계에서 사라진다. 지금 랭킹에 보이는 사람이 사라지는 사용자 가시 회귀다.
- 공개 응답이 private 원본과 join할 구조적 여지 자체가 없어진다(루트 AGENTS.md §4). 규율이 아니라 스키마가 경계를 강제한다.

단 비정규화는 **수집이 매번 전체를 덮어쓰는 테이블에만** 쓴다. 부분 갱신 테이블에 같은 패턴을 쓰면 drift를 막을 방법이 없다.

## 4. 이름은 데이터의 모양과 어긋나면 안 된다

- 시점별로 쌓이지 않고 키마다 한 행을 upsert한다면 `Snapshot`·`History`·`Event`를 쓰지 않는다.
- 반대로 **시간 축을 따라 행이 쌓이는 테이블은 `History`로 끝낸다.** 기존 행을 지우지 않고 축(로그인 시각·연도·발생 시점)이 전진할수록 행 수가 늘어난다면, 그 축이 이름에 드러나야 한다 — `LoginHistory`가 이 패턴이다. `Fact`·`Record`·`Aggregate`는 "행이 언제 늘어나는가"에 답하지 못하므로 신규 모델에 쓰지 않는다.
- 축약하지 않는다 — `Repo`가 아니라 `Repository`.
- **모델명은 도메인어를 그대로 쓴다.** 이 도메인의 `repository`는 GitHub 저장소를 뜻하므로 모델명이 `Repository`로 끝나도 된다 — 학생·운영자가 화면에서 쓰는 단어를 모델이 버리지 않는다.
- **영속 계층 클래스 이름은 프레임워크 관례를 따른다.** NestJS/DDD에서 `*Repository`는 표준 이름이므로 그대로 쓴다. 모델명과 겹쳐 보이는 문제는 DAO 접미사를 바꿔서가 아니라 **모델 이름을 정확하게** 해서 푼다 — 예전 `model Repository`가 "GitHub 저장소 일반"이 아니라 신청 1건당 1행인 프로비저닝 기록이었을 때 이 규칙이 그 정체를 드러내는 이름을 요구했다. 결국 `#617` 단계 D에서 그 프로비저닝 필드(`applicationId`/`programId`/`teamId`/`publishedAt`)를 `GithubRepository`로 흡수해 모델을 하나로 합쳤다 — 두 개념이 실제로는 같은 행(신청이 프로비저닝한 저장소 = 수집 대상 저장소)을 가리켰기 때문이다. 외부 서비스에서 온 데이터를 담는 모델은 출처를 접두사로 밝힌다(`Github*`) — 기존 `GithubRawObservation`·`GithubWebhookObservation`과 같은 관례.
- 저장소 경로 필드는 `nameWithOwner`다(GitHub GraphQL 필드명 그대로). `fullName`은 실명을 담는 `User.name`과 충돌해 사람 이름으로 읽힌다.
- 도메인에서 실제로 쓰지 않는 말(법률·프로그래밍 은어)을 모델명에 쓰지 않는다. 학생·운영자가 화면에서 쓰는 단어를 쓴다.

판정 기준: **모델명만 읽고 "이 테이블에 행이 언제, 몇 개 생기는가"에 답할 수 없으면 이름이 틀린 것이다.**

기존 모델도 이 규칙을 따르도록 개명한다. 다만 개명은 동작 변경과 섞이므로 **개명만 담는 별도 PR**로 다루고(`pr-scope.md:9`), 마이그레이션은 직렬로 넣는다(루트 AGENTS.md §3).

지우기로 결정된 테이블은 개명 대상에서 제외한다 — 개명하지 않고 지운다. `Canonical*` 8개(todo 14 전환으로 authority 상실)가 그 선례다 — ADR-006이 정한 보존 기간(1개 릴리스)을 넘기고 전 테이블 0행을 실측한 뒤 `20260820000000_drop_canonical_generation_tables`가 단일 FK 클러스터를 통째로 드롭해 **제거가 완료됐다**. 아직 남은 건 `PublicShowcase*`(writer 0건, Issue #463)이다.

## 5. 외부 API 전제는 문서 기억이 아니라 실측으로 확정한다

GitHub API 동작을 기억으로 단정하지 않는다. 새 쿼리를 설계에 넣기 전에 최소한 응답 status·에러 타입·rate limit cost를 한 번 호출해 확인하고, 그 결과를 설계 문서에 남긴다.

실제로 뒤집힌 전제: `contributionsCollection(from, to)`의 1년 창 제한은 권고가 아니라 하드 `VALIDATION` 에러이며, 초과 시 쿼리 자체가 거부된다. "명문 규정이 아니다"라고 적힌 설계 전제가 첫 호출에서 무너졌다.

증거는 public-safe 형태로만 남긴다 — 토큰, 실명, private 저장소 식별자를 붙여넣지 않는다(`docs/rules/security.md`).

---

이 문서는 루트 AGENTS.md §3(DB 마이그레이션 직렬 규칙)·§4(공개 endpoint와 private 테이블 join 금지)를 확장하며, [ADR-003](../decisions/ADR-003-backend-architecture.md)(백엔드 아키텍처)을 따른다.
스키마 변경 PR의 범위·분해 기준은 [`pr-scope.md`](pr-scope.md)가 원본이다.
