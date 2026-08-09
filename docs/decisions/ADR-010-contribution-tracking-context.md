---
slug: ADR-010-contribution-tracking-context
date: 2026-08-09
author: GoBeromsu
status: Accepted
references:
  - ADR-003
  - ADR-006
  - ADR-009
refines:
  - ADR-006
  - ADR-009
---

# ADR-010: 기여 추적 컨텍스트 — 두 읽기 표면과 그 데이터원

## Status

Accepted

## Date

2026-08-09

## Context

플랫폼이 학생에게 보여줘야 하는 것은 둘이다.

1. **랭킹** — 이 학생이 **올해** 얼마나 활동했는가. 과거 연도도 선택해서 볼 수 있다
2. **프로그램** — 이 학생이 **자기 팀 저장소**에 얼마나 기여했는가

두 화면은 같은 사실을 다르게 접은 것이므로 오래 하나의 데이터원을 공유해 왔다. 그런데 운영에서 드러난 사실이 그 전제를 흔들었다.

**착수 시 가설은 "랭킹이 멈췄다"였다. 프로덕션 진단이 그것을 뒤집었다.**

스윕은 매시 정상이고 오류가 없으며 공개 API가 DB와 정확히 일치한다. 숫자가 잘 안 늘어 보인 것은 고장이 아니라 **커버리지 공백** 때문이었다 — 추적 저장소가 3개(조직 것만)이고 `EXTERNAL_PUBLIC`이 0개다. GitHub 원본과 대조하면 조직 저장소 중심 학생은 수치가 맞고, 밖에서 활동하는 학생은 일부만 포착된다.

다만 이 조사가 드러낸 구조적 사실은 그대로다 — **랭킹이 조직 저장소 sweep의 건강에 종속돼 있어 sweep이 멈추면 학생이 보는 화면이 같이 멈춘다.**

동시에 `ADR-009`가 이미 확정한 것이 있다. 학생이 신청 폼에서 `OWN`으로 연결한 조직 밖 저장소의 활동을 **프로그램 실적으로 센다.** 그리고 현재 수집은 조직 밖 공개 저장소 기여를 이미 랭킹에 섞고 있다(`collection-read.service.ts`의 `getPublicRankingMetrics` 주석: *"학생 개인 이력을 의도적으로 섞는다(org 밖 저장소도 포함)"*).

기존 수집 구조는 세 곳에 흩어져 있었다. GitHub App 클라이언트가 2벌(`repositories/github-app.client.ts` 205줄, `collection/collection-app.client.ts` 1030줄), 토큰 provider가 3벌, octokit을 만지는 모듈이 3곳(`auth`·`collection`·`repositories`)이다. rate limit 한도는 계정 단위인데 클라이언트가 둘이라 각자 자기 사용량만 알고, 페이싱 큐가 둘이면 페이싱이 성립하지 않는다.

## Decision

### 1. 두 화면의 데이터원을 가른다

```
① 랭킹     내 올해 활동      commit·PR ← contributionsCollection (GraphQL, 학생당 1콜)
                            release   ← ② 수집값을 얹는다. 없으면 0
② 프로그램  내 팀 repo 기여   Contribution (repositoryId, githubId, date) ← 조직 App sweep
```

**근거 넷.**

1. 랭킹 화면이 이미 *"OSS Hub에 연결된 **공개** GitHub 활동을 기준으로 집계합니다"*를 배포된 상태로 선언하고 있다. 공개 활동 기준은 새 정책이 아니라 이미 사용자에게 약속한 것이다
2. `contributionsCollection`이 정확히 "이 학생의 올해 활동"을 답하는 API다. 저장소를 훑지 않고 학생당 1콜로 끝난다
3. ①을 `contributionsCollection`으로 옮기면 sweep·lease·cursor·인벤토리·installation token에서 독립한다. **다만 아직 옮기지 않았다** — 현재 ①은 ②와 같은 `Contribution`을 읽으므로 수집이 멈추면 랭킹도 멈춘다. 이 근거는 목표이지 현재 성질이 아니다(Follow-ups)
4. 공개 랭킹에 조직 private 기여를 합산하면 저장소를 밝히지 않아도 *"이 사람이 비공개로 많이 했다"*가 드러난다. 공개 표면에서 빼는 쪽이 누출 경계와 화면 문구를 동시에 맞춘다

**대안(단일 데이터원 유지)을 기각한 이유.** 그 장점(release 포함·조직 private 포함)은 아래 3·5로 대체 가능하지만, 단점(랭킹이 sweep 건강에 계속 종속·누출을 정책으로 공식화)은 대체 불가능하다.

### 2. 랭킹 필터는 사람 축이다

가입한 학생의 활동을 센다. 저장소 축(`Application` 연결 여부)으로 거르지 않는다.

저장소 축으로 fail-closed 하면 현재 랭킹이 통째로 사라진다 — 지금 수치의 지배적 원천이 `Application` 없는 조직 저장소(`oss-hub` 자신 포함)이기 때문이다(`collection-sync.service.ts`의 `#682` 경고 주석). 사람 축(`githubId ∈ User`)으로 거르면 제3자만 빠지고 가입 학생의 활동은 남는다.

프로그램 범위(`Application`·`Team` 연결)는 ② 화면에서만 적용한다.

### 3. 합계 정의는 commit + PR + release 3종이다

`D7`을 유지한다. 가중치는 없으므로 이름은 점수가 아니라 활동 횟수다.

`contributionsCollection`은 release를 세지 않는다 — GitHub의 기여 타입은 commit·issue·PR·PR review·저장소 생성 5종이고 release는 그중에 없다. 따라서 ①을 GraphQL로 옮길 때는 commit·PR만 그쪽에서 받고 **release는 ② 수집값을 얹되 없으면 0**으로 둔다.

**현재는 그 이전 단계다.** ①도 ②와 같은 `Contribution`을 읽으므로 세 값이 모두 sweep 에서 온다.

`issue`·`PR review`는 세지 않는다. 그 결과 **우리 숫자는 학생의 GitHub 프로필 그래프와 다를 수 있다** — GitHub은 issue·review를 세고 우리는 release를 센다. 화면 설명 문구가 이 차이를 밝힌다.

`D7b`가 요구한 `total` → `activityCount` 개명은 **채택하지 않는다.** 봉투 이름은 `total`로 둔다.

### 4. 수집 입자는 `(repositoryId, githubId, date)`다

② 데이터는 `Contribution` 한 장에 담는다. `@@id([repositoryId, githubId, date])`이며 칸은 `commitCount`·`pullRequestCount`·`releaseCount`다.

**읽는 쪽은 아직 둘로 갈려 있다.** 지표 조회 네 곳(`getRepositoryMetrics`·`getContributorMetrics`와 각 누적판)은 `Contribution`을 읽지만, 활동 **타임라인**(`findRepositoryActivity`)은 여전히 fact 테이블 관계를 직접 읽는다 — 타임라인은 날짜별 점 하나하나가 필요해서 집계 칸으로는 만들 수 없다. 두 경로가 같은 사실을 보되 입자가 다르다.

- 저장에 연도 개념이 없다. 읽을 때 `WHERE date` 범위로만 자르므로 **새해에 롤오버 작업이 없다.** 기존 `*YearAggregate`는 매년 1/1에 당해 연도 값을 0으로 안전하게 읽는 특수 처리를 요구했다
- **랭킹 숫자를 저장하지 않는다.** 미리 계산한 랭킹 테이블을 두면 갱신 누락으로 화면이 옛 숫자를 보인다
- 사람 식별자는 `githubId` 하나로 통일하고 NOT NULL이다. 저장소는 `githubRepositoryId`로 남겨 접두사가 사람/저장소를 구분한다
- **개별 식별자(`sha`·PR id·릴리스 id)는 보존하지 않는다.** 집계 수치만 남는다 — "무엇을 했는지"가 아니라 "얼마나 했는지"다. 목록 화면이 필요해지면 author-scoped GraphQL이 전체 이력을 1포인트에 주므로 소급 백필할 수 있다

### 5. 조직 안은 private까지, 조직 밖은 public만 수집한다

수집 규칙은 한 줄이다 — **가입한 학생이 조직 안팎에서 한 기여를 센다.**

- 조직 안: private·public 상관없이 추적
- 조직 밖: public만 추적
- 가입하지 않은 사람: 추적하지 않는다
- 누가 했는지 모르는 기록: 적재하지 않는다

조직 private 기여는 계속 수집하고 ② 프로그램 화면에서 보인다. **공개 랭킹에만 들어가지 않는다.** `ADR-009` §3("외부 활동을 프로그램 실적으로 센다")은 유지되며, 이 ADR은 그 표시 경계를 공개/인증 표면으로 나눌 뿐이다.

`Repository.source`(`ORG_PROVISIONED` | `EXTERNAL_PUBLIC`) 구분은 스키마에 유지한다. 다만 **랭킹 필터로 쓰지 않는다**(위 2).

### 6. 저장소를 만들거나 연결하는 순간이 곧 추적 시작이다

수집 대상 행(`GithubRepository`)에 큐 칸(`nextRunAt` 기본 `now()`·`lastSuccessAt`·`failureCount`)이 붙는다. 행이 생기는 순간 차례가 지난 상태이므로 별도 편입 단계도 조건절도 없다 — **행의 존재가 곧 멤버십이다.**

**다만 그 행을 만드는 것은 아직 프로비저닝이 아니다.** 프로비저닝은 `Repository`를, 수집은 `GithubRepository`를 쓰며 두 모델이 별개다. `GithubRepository` 행은 sweep의 인벤토리 관측(`recordRepositoryObservation`)에서만 생긴다. 그래서 `NEW` 생성이나 `OWN` 연결 직후가 아니라 **다음 인벤토리 관측에서** 수집이 시작된다. 조직 저장소는 매 sweep이 재발견하므로 지연이 한 주기지만, 조직 밖 저장소는 인벤토리에 잡히지 않아 수동 등록 전까지 영영 들어오지 않는다 — 이것이 현재 `EXTERNAL_PUBLIC`이 0개인 이유이며 자동 discovery가 필요한 이유다.

### 7. `github/`가 밖으로 여는 기여 추적 port는 3개다

기여 집계 / 공개 자격 / 건강. 질문의 종류도, 변하는 주기도, 보는 사람도 셋이다.

**프로비저닝 port(`REPOSITORIES_READ_PORT`)는 별도 등재한다.** 답하는 질문이 "내 저장소 준비됐나"이고 신청 직후 몇 분 동안만 바뀌며 학생 본인만 본다 — 기여 추적 셋과 다른 종류다. `ADR-003` DEC-42의 "새 Port를 만들지 않는다"는 이 ADR로 개정된다.

port는 entity가 아니라 결과 타입을 돌려준다. `nextRunAt`·`failureCount`가 밖으로 새지 않는다.

### 8. 폴더는 Domain-first + Layered다

최상위는 업무 도메인이고 그 안에 `controller/ service/ repository/ domain/ dto/` 계층을 둔다. 의존은 `Controller → Service → Repository → Prisma` 단방향이다.

리뷰에서 확인하는 것은 넷이다.

```
Controller가 Prisma를 직접 부르는가?      → X
Controller에 비즈니스 로직이 있는가?      → X
Service에 Prisma query가 직접 들어가는가? → X
Repository가 비즈니스 의사결정을 하는가?  → X
```

**빈 폴더를 강제하지 않는다.** 규칙은 "존재하는 폴더는 허용된 이름만"이며 필요해질 때 세분화한다. `entities/`·`aggregates/`·`value-objects/`·`ports/`·`adapters/`를 처음부터 만들지 않는다.

이번 적용 범위는 `github`·`ranking`·`programs` 세 도메인이다. 나머지는 규약 문서화로 유도한다.

### 9. 쓰기는 전량 재계산이며 집합 SQL 한 문으로 접는다

수집은 **전량 재계산**이다. 증분 누적은 force-push·PR 삭제 뒤 영구히 부풀고 자가교정이 없다.

Phase 1은 **이번 배치가 건드린 칸만** 비우고(`deleteMany`) 집합 SQL 한 문으로 다시 채운다
(`INSERT … SELECT … GROUP BY … ON CONFLICT DO UPDATE`). 저장소 전체를 비우지 않는 이유는
한 배치가 만지는 범위가 그보다 훨씬 좁고, 전체를 비우면 그 사이 읽기가 빈 값을 본다.

**셀 단위 루프를 쓰지 않는다.** 입자가 날짜라 한 배치가 건드리는 칸이 (활동일 × 기여자)로
늘어나는데 재계산은 checkpoint 트랜잭션 안에서 돈다. 칸마다 질의를 하면 Prisma interactive
트랜잭션 기본 5초를 넘겨 fact 적재까지 함께 롤백되고, 활동이 많은 저장소가 매 사이클 같은
자리에서 영구 실패한다.

**force-push 자가교정의 범위.** 재계산은 fact 테이블 COUNT 에서 값을 다시 만들므로,
fact 가 줄면 집계도 준다. 그러나 **fact 자체를 지우는 경로는 아직 없다** — 상류에서 사라진
커밋이 fact 에 남으면 그 값이 유지된다. fact 층 조정은 후속이다. 트랜잭션 경계는 유스케이스이며 **I/O는 트랜잭션 밖, 쓰기만 안**이다 — fetch가 실패하면 트랜잭션이 시작조차 하지 않으므로 기존 행이 그대로 남는다.

함께 관측 지표를 남긴다: `pg_stat_user_tables`의 `n_dead_tup`/`n_live_tup` 비율, `autovacuum_count`, 델타 발생 횟수.

**Phase 1이 이미 `$executeRaw`를 쓴다.** 원래는 Prisma 네이티브만으로 가려 했다 — raw SQL은 타입 안전성을 잃고 어휘를 둘로 만든다. 그런데 입자가 날짜가 되면서 한 배치가 건드리는 칸이 (활동일 × 기여자)로 늘었고, 그 재계산이 checkpoint 트랜잭션 안에서 돈다. 칸마다 질의하면 5초를 넘겨 fact 적재까지 함께 롤백된다. **성능 최적화가 아니라 정확성 문제라서 raw SQL을 썼다.**

**Phase 2는 여전히 조건부다.** 관측이 dead tuple 누적을 보이면 `WHERE IS DISTINCT FROM` 조건을 붙여 실제 변경된 행만 쓰게 하고, 델타 빈도가 충분히 높으면 변경 이력 테이블로 승격한다. 지금은 증거가 없어 만들지 않는다.

### 10. 갱신은 매시 1회이고 화면이 갱신 시각을 말한다

webhook 기반 실시간을 만들지 않는다(`ADR-006` 이벤트 최소주의 유지). 대신 **두 화면 모두 마지막 갱신 시각을 표시한다.** 이번 사고의 본질이 "멈췄는데 아무도 몰랐다"였으므로, 다시 멈추면 화면이 먼저 말해야 한다.

### 11. 검증은 화면 기준이다

"학생이 자기 화면을 보고 맞다고 하는가"가 판정이다. 표본 학생 3~5명의 두 화면을 열어 그 사람 GitHub 원본과 대조한다. 기간 제한은 없다.

옛 DB 수치와 대조하지 않는다 — 규칙이 바뀌었으므로 비교 대상이 아니다. 대신 불변식 넷을 기계로 전수 검사한다.

1. `(repositoryId, githubId, date)` 중복 0
2. 모든 `githubId`가 가입자 집합에 속한다
3. 집계 합계가 fact 건수를 넘지 않는다
4. 음수 없음 — **재실행 멱등성의 대리 지표다.** 전량 재계산이 COUNT 로만 값을 만들므로 음수는 원리상 나올 수 없고, 나왔다면 증분 누적 경로가 되살아났다는 뜻이다. 같은 입력으로 두 번 돌려 같은 값이 나오는지는 실 Postgres 통합 스펙이 직접 본다 — 전수로 두 번 돌리는 비용이 크기 때문이다.

## Consequences

- **private 비중이 큰 학생은 랭킹 수치가 지금보다 낮아진다.** private 자체는 ② 화면에서 보이고 플랫폼은 계속 수집한다. 전환 전후 순위 변동을 배포 전에 측정하고 표본 학생에게 고지한다. 공개 PR 본문에는 집계 판정만 남기고 학생별 원시 수치는 남기지 않는다
- **우리 숫자와 GitHub 프로필 그래프가 다르다.** 기여 타입(우리는 release, GitHub은 issue·review)·기간(연도 vs rolling 365일)·시간대가 각각 어긋난다. 화면 문구가 이 차이를 밝힌다
- 개별 식별자가 사라지므로 "무엇을 기여했는지" 목록 화면은 불가능해진다. 필요해지면 소급 백필로 되살릴 수 있다
- 연도 목록은 현재 `Contribution.date`에서 계산한다. ①을 `contributionsCollection`으로 옮기면 GitHub의 `contributionYears`가 그 목록을 직접 주므로 계산이 사라진다
- `contributionsCollection`의 저장소별 분해는 상한이 있으나(기본 25) ①은 `total*`을 쓰므로 무관하다
- 조직 밖 저장소는 sweep이 재발견하지 않는다 — 그 행을 지우면 영구 소실이며 수동 재등록만이 복구다. 데이터 초기화를 하지 않고 `확장 → 재수집 → 읽기 전환 → 드롭` 순서로 간다

## Alternatives considered

**데이터를 밀고 재수집한다.** 조직 저장소는 매 sweep이 `listInstallationRepositories()`로 재발견하지만 조직 밖 저장소는 DB 행이 유일한 기록이라 영구 소실된다. 그리고 전량 재계산이 자가교정이므로 애초에 밀 필요가 없다.

**랭킹 필터를 `Application` 연결 여부로 건다.** 현재 랭킹 수치의 지배적 원천이 `Application` 없는 조직 저장소라 랭킹이 0이 된다. 갈라야 할 축은 "조직 안인가"도 "프로그램에 연결됐는가"도 아닌 **"가입한 학생인가"**였다.

**합계를 commit + PR + issue + review 4종으로 바꾼다.** GitHub의 기여 정의를 그대로 따르면 프로필과 숫자가 맞아떨어지지만, release를 세지 않게 되어 릴리스로 성과를 내는 팀의 기여가 사라진다. 3종 유지를 택했다.

**`Repository`·`programId` 공존 4단계로 전환한다.** 데이터 폐기가 불필요해지면서 전제가 사라졌다.

## Follow-ups

- **① 랭킹을 `contributionsCollection`으로 옮긴다.** 이것이 §1 근거 3의 실제 이행이며, 그 전까지 랭킹은 수집이 멈추면 같이 멈춘다. 프로덕션 실측으로 학생당 연도당 rate limit `cost=1`, 시간당 한도 5000 임을 확인했다 — 200명 매시 조회가 예산의 4%다
- **fact 층 force-push 조정.** 상류에서 사라진 커밋을 fact 에서 지우는 경로가 없다. 지금은 집계가 fact 를 따라가므로 fact 가 부풀면 집계도 부푼다
- **② 프로그램 화면의 `OWN`(`EXTERNAL_PUBLIC`) 저장소 제외 — 미해결 충돌.** `ADR-009` §3과 이 문서 §5는 조직 밖 활동을 프로그램 실적으로 세라고 하는데, `collection-read.service.ts`의 `ORG_PROVISIONED_REPOSITORY` 가드는 그것을 막는다. 그 가드에도 이유가 있다 — `repositoryIds` 배열에 학생의 무관한 개인 저장소가 섞이면 조직 실적으로 조용히 집계된다. **두 요구가 정면으로 충돌하며 이 문서는 아직 고르지 않았다.** 안전한 해법은 "신청에 연결된 저장소임"을 호출자가 증명하게 하는 것이고, 그 연결 확인 기구가 없는 상태에서 가드만 푸는 것은 위험하다. 이 충돌은 이번 변경보다 먼저 존재했고 현재 프로덕션에는 `OWN` 신청이 0건이라 경로가 비어 있다

- `Program.startAt` 신설 — ② 화면의 "프로그램 기간"을 `applicationStartAt` ~ `COALESCE(endAt, now())`로 잠정 정의했다. 정확한 활동 시작일 컬럼은 별건으로 다룬다
- 랭킹 60초 인메모리 캐시 제거 — 갱신 시각을 캐시 밖 값으로 정의해 상호작용을 끊었으므로 급하지 않다
- Phase 2 쓰기 전략 판단 — 관측 지표 한 달치
- 학생 개인의 대학생활 전체 기록 표면 — 조직 밖 수집 기반은 남기되 화면은 보류한다

## Changelog

- 2026-08-09: 신규. 두 읽기 표면의 데이터원 분리, 사람 축 랭킹 필터, `(repositoryId, githubId, date)` 입자, port 3개 + 프로비저닝 별도, Domain-first + Layered 폴더, Prisma 네이티브 쓰기와 Phase 2 조건을 확정. `ADR-003` DEC-42의 Port 제약과 `ADR-006`·`ADR-009`의 수집·표시 경계를 개정한다.
