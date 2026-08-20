---
slug: ADR-010-contribution-tracking-context
date: 2026-08-09
author: GoBeromsu
status: Accepted
references:
  - ADR-003
  - ADR-006
  - ADR-009
  - ADR-011
refines:
  - ADR-006
  - ADR-009
---

# ADR-010: 기여 추적 컨텍스트 — 두 읽기 표면과 그 데이터원

## Status

Accepted

> **2026-08-12 amendment**: `#617` 단계 D에서 `Repository`가 `GithubRepository`로 통합되어, 이 문서에서 `Repository`를 별개 프로비저닝 테이블로 서술하는 부분(§6 등)은 현재 `GithubRepository`의 `applicationId`/`programId`/`teamId`/`publishedAt` 컬럼을 가리킨다. 결정 기록 보존을 위해 본문은 그대로 두고 이 노트만 추가한다.

> **2026-08-19 amendment — 두 축이 각자 획득을 갖는다.** 아래 §1~§4의 본문은 두 화면이 같은 `Contribution` 한 장을 나눠 읽던 시기의 기록이다. 그 서술을 지우지 않고, 지금 확정된 형태를 이 노트에 덧붙인다. 자세한 내용은 아래 **[2026-08-19 개정 노트](#2026-08-19-개정-노트--두-축-획득과-랭킹-5종-지표)** 절에 있다.

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

`?year=`가 없을 때 랭킹이 **올해**를 읽는 것도 이 절이다. 그 값이 영속 계층에 어떤 타입으로 도착하는지는 [ADR-011](ADR-011-query-filter-type-boundary.md)이 원본이다 — `"all"`과 `"2026"`을 같은 문자열로 SQL에 넣지 않는다. 교직원 학생 활성의 부재 기본(전체 기간)은 랭킹을 베끼지 않으며 ADR-011 Decision 5다.

### 2. 랭킹 필터는 사람 축이다

랭킹이 "누구의 활동을 세는가"(집계 축)와 "누구를 화면에 보여주는가"(표시 축)는 서로 다른 질문이며 이 절은 그 둘을 분리해 서술한다.

**집계 축 — 누구의 활동을 세는가.** 가입한 학생의 활동을 센다. 저장소 축(`Application` 연결 여부)으로 거르지 않는다.

저장소 축으로 fail-closed 하면 현재 랭킹이 통째로 사라진다 — 지금 수치의 지배적 원천이 `Application` 없는 조직 저장소(`oss-hub` 자신 포함)이기 때문이다(`collection-sync.service.ts`의 `#682` 경고 주석). 사람 축(`githubId ∈ User`)으로 거르면 제3자만 빠지고 가입 학생의 활동은 남는다.

**표시 축 — 누구를 화면에 보여주는가.** 가입자 전원을 보여준다. 기여가 0이어도 화면에서 빠지지 않고 0/0/0으로 표시된다(PM 결정, 2026-08-11) — 위 집계 축이 "합산 대상"을 정하는 것과 달리, 표시 축은 그 합산 결과가 0인 사람도 계속 화면에 남긴다는 별개의 결정이다.

**저장소 축 — 어떤 저장소의 활동을 세는가.** JNU-SWCU Org 저장소 전체를 가시성과 무관하게 집계 대상으로 삼는다(PM 결정, 2026-08-11). 조직 밖 개인 계정은 여전히 public 저장소만 집계한다(§5). private org 저장소의 활동이 공개 랭킹 숫자에 합산되는 것은 그 저장소 자체를 공개하는 것과 별개다 — 저장소 공개 전환은 계속 `ADR-006`·`docs/rules/security.md`가 정한 권한 있는 운영자의 명시적 publish 동작으로만 이뤄진다.

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

`OWN`(`EXTERNAL_PUBLIC`)은 이 기준을 그대로 쓸 수 없다 — 프로덕션에 신청이 0건이라 대조할 표본 학생이 없다. 표본이 생길 때까지는 **통제된 저장소 1개를 실제 프로덕션에서 관통시키는 것**이 대체 acceptance다: 편입 행의 `nameWithOwner`가 `owner/repo`이고 `defaultBranch`가 실제 값인지, external 스윕이 그 행에서 실패 없이 fact를 넣는지, 가입자 필터가 제3자를 걸러내는지, 랭킹의 올해·과거 연도·`dataAsOf`가 그 수집을 반영하는지를 본다. 검증 후에는 승인된 신청이 없는 저장소가 공개 랭킹에 남지 않도록 되돌린다.

2026-08-10에 이 대체 acceptance를 `v0.6.47`에서 실행했다. 편입 → external 스윕(fact 604건, 실패 0) → 가입자 필터(604 → `Contribution` 61행, 비가입자 0) → 랭킹(올해 총합 상승, 과거 연도 처음으로 값이 생김, `dataAsOf`가 새 `lastSuccessAt`과 일치) → 화면 렌더까지 통과했고, 프로덕션은 원상복구했다.

옛 DB 수치와 대조하지 않는다 — 규칙이 바뀌었으므로 비교 대상이 아니다. 대신 불변식 넷을 기계로 전수 검사한다.

1. `(repositoryId, githubId, date)` 중복 0
2. 모든 `githubId`가 가입자 집합에 속한다
3. 집계 합계가 fact 건수를 넘지 않는다
4. 음수 없음 — **재실행 멱등성의 대리 지표다.** 전량 재계산이 COUNT 로만 값을 만들므로 음수는 원리상 나올 수 없고, 나왔다면 증분 누적 경로가 되살아났다는 뜻이다. 같은 입력으로 두 번 돌려 같은 값이 나오는지는 실 Postgres 통합 스펙이 직접 본다 — 전수로 두 번 돌리는 비용이 크기 때문이다.

## 2026-08-19 개정 노트 — 두 축 획득과 랭킹 5종 지표

> 이 절은 **덧붙임**이다. 위 §1~§11의 어떤 문장도 지우지 않았다. 두 서술이 어긋나면 **이 절이 현재**이고 위쪽은 그렇게 결정했던 시점의 기록이다.

### A. 사람 축이 자기 획득을 갖는다 (§1 이행)

§1 근거 3이 목표로만 남겨 뒀던 것 — "①을 `contributionsCollection`으로 옮긴다" — 을 실제로 이행한다. 두 축은 이제 **각자 자기 획득 경로와 자기 테이블**을 갖는다.

```
① 랭킹     사람 축   GithubUserActivityHistory ← contributionsCollection + repositories(star), GraphQL, 학생당 연도당 cost=1
② 프로그램  저장소 축  Contribution              ← 조직·external 저장소 sweep(REST)
```

랭킹은 더 이상 저장소 sweep의 건강에 종속되지 않는다. org sweep이 멈춰도 사람 축 수치는 자기 sweep으로 갱신된다 — §1이 "현재 성질이 아니다"라고 적어 둔 바로 그 독립성이 이제 성질이 됐다.

**한 테이블로 합치지 않았다.** 두 축은 키가 달라 물리적으로 병합할 수 없고(저장소 축은 `repositoryId`를 요구한다), `Contribution`에는 issue·star·repo 칸이 없다. 사람 축 테이블의 형태·명명·FK 부재 근거는 [`docs/rules/data-modeling.md`](../rules/data-modeling.md)가 원본이며 여기서 되풀이하지 않는다.

### B. 사람 축 입자는 `(githubId, year)`다 (§4 병기)

§4가 정한 저장소 축 입자 `(repositoryId, githubId, date)`는 **그대로 유효하다** — ② 화면이 계속 그 입자를 읽는다. 사람 축은 별도로 `(githubId, year)` 한 행을 갖는다. 연도 축으로 행이 쌓이므로 과거 연도가 보존되고 새해에 롤오버 작업이 없다. §4의 나머지 원칙(랭킹 순위 미저장, 개별 식별자 미보존, 사람 식별자는 `githubId`)은 사람 축에도 같이 적용된다.

### C. 랭킹 지표는 5종이고 release는 ② 전속이다 (§3 D7 개정)

§3은 `D7`(commit + PR + release 3종)을 유지한다고 적었다. **이 노트가 그 부분을 개정한다.** 랭킹 지표는 다음 5종과 그 단순 합이다.

| 지표 | 출처 |
| --- | --- |
| `commitCount` | `contributionsCollection.totalCommitContributions` |
| `pullRequestCount` | `contributionsCollection.totalPullRequestContributions` |
| `issueCount` | `contributionsCollection.totalIssueContributions` |
| `repositoryCount` | `contributionsCollection.totalRepositoryContributions` |
| `starCount` | `repositories(ownerAffiliations: OWNER, privacy: PUBLIC)`의 stargazer 합 (**누적**) |

`release`는 **② 프로그램 화면 전속**이 된다. `contributionsCollection`이 release를 세지 않으므로 사람 축에는 release 칸이 없고, 저장소 축 수집이 유일한 출처로 남는다. §3이 예고한 "release는 ② 수집값을 얹되 없으면 0"은 채택하지 않았다 — 축을 넘겨 값을 얹으면 MECE 경계가 다시 흐려진다. 화면에서 release 수치가 사라지는 것은 의도된 변화다.

봉투 이름은 §3대로 `total`이며 가중치는 없다. `issue`를 세게 됐으므로 우리 숫자와 GitHub 프로필 그래프의 차이는 줄지만 여전히 같지 않다(기간·시간대·star 포함 여부) — 화면 문구가 그 차이를 계속 밝힌다.

**이 5종 구성은 관리자 요청에서 왔다** — release 개수 대신 star · 작업한 저장소 수 · issue 수로 세자는 요청이다. 제품·기획 결정의 원본은 [`AGENTS.md`](../../AGENTS.md) §2가 정한 대로 **Notion Decision Log**이며, 이 ADR은 그 결정을 여기서 다시 내리지 않고 기술적 귀결(테이블·획득 경로·축 경계)만 기록한다.

### D. 조작 가능성을 밝혀 둔다

`starCount`와 `repositoryCount`는 **본인이 값을 만들 수 있는 지표**다. 저장소는 얼마든지 만들 수 있고 star는 서로 눌러 줄 수 있다. commit·PR·issue도 완전히 안전하지는 않지만 이 둘은 비용이 특히 낮다.

그럼에도 넣는다 — 랭킹은 상금이 걸린 심사가 아니라 활동을 보여 주는 화면이고, 관리자가 원한 것이 "우리 저장소 밖 활동까지 보이게 하자"이기 때문이다. 대신 이 성질을 여기 적어 둔다: 나중에 이 숫자로 무언가를 판정하려 하면 그때는 가중치나 검증이 먼저 필요하다. star를 "누적"으로 표기하는 화면 문구도 같은 이유로 필수다.

### E. D15 문구 정정 — 폐기가 아니다

공개 랭킹의 표기 정책(`D15`)은 **유지된다.** 다만 표기 항목이 늘었으므로 문구를 "`githubLogin`과 `department`"로 정정한다. 실명은 여전히 공개 표면에 나가지 않으며, `department`는 공개 가능 정보로 판단한 owner 결정(2026-08-19)에 따라 비로그인 계층에도 포함된다. 학과는 `resolveCompatibleProfileDepartment` shim으로 읽고 `User.department`를 직접 select하지 않는다 — `UserProfile`만 가진 사용자가 전부 null로 비어 "0으로 위장"되는 것을 막기 위해서다.

공개 랭킹 repository가 실명을 읽지 않는다는 불변식은 그대로다.

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
- **완료(#730) — 프로그램 화면의 `OWN`(`EXTERNAL_PUBLIC`) 저장소 연결 증명.** 프로그램 화면은 신청에 연결된 저장소임을 `Repository` 행으로 DB에서 증명하고, 그 id에 한해서만 `EXTERNAL_PUBLIC` 지표를 허용한다. 따라서 학생의 무관한 개인 저장소를 조직 실적으로 섞지 않으면서 연결된 OWN 활동은 표시한다

- `Program.startAt` 신설 — ② 화면의 "프로그램 기간"을 `applicationStartAt` ~ `COALESCE(endAt, now())`로 잠정 정의했다. 정확한 활동 시작일 컬럼은 별건으로 다룬다
- 완료(2026-08-10) — 랭킹 완료 결과의 60초 인메모리 캐시와 공개 응답 cache header를 제거했다. 외부 저장소의 PUBLIC/PRESENT 회수가 다음 익명 요청부터 즉시 반영되고, 동시 요청만 single-flight로 합친다
- Phase 2 쓰기 전략 판단 — 관측 지표 한 달치
- 학생 개인의 대학생활 전체 기록 표면 — 조직 밖 수집 기반은 남기되 화면은 보류한다
- **랭킹 읽기의 연결 심층 방어.** 프로그램 화면과 달리 랭킹의 저장소 술어는 `visibility`·`presence`만 본다 — 신청 연결을 보지 않는다. 정상 경로에서는 프로비저닝 워커가 `Repository` 행을 함께 만들므로 연결이 보장되지만, 어떤 이유로든 연결 없는 `EXTERNAL_PUBLIC` 행이 생기면 공개 랭킹에 조용히 합산된다. 2026-08-10의 통제된 검증이 실제로 그 상태를 만들었고 랭킹이 그대로 셌다

## Changelog

- 2026-08-20: §1에 `?year=` 부재=올해는 이 절, 영속 타입 경계와 학생 활성 기본(부재=전체)은 [ADR-011](ADR-011-query-filter-type-boundary.md)임을 교차 기록했다.
- 2026-08-19: 두 축이 각자 획득을 갖게 된 형태를 개정 노트로 덧붙였다(기존 본문 삭제 없음). 사람 축은 `GithubUserActivityHistory`를 `contributionsCollection` + `repositories(star)` GraphQL 조회로 채우고 입자는 `(githubId, year)`이며, 랭킹 지표는 commit·PR·issue·repo·star 5종과 그 단순 합으로 바뀌었다 — `D7`의 3종 합계를 이 노트가 개정한다. `release`는 ② 프로그램 화면 전속이 됐다(사람 축이 release를 세지 않으므로 저장소 축이 유일 출처). 5종 구성의 제품 결정 원본은 관리자 요청을 받은 Notion Decision Log이며(`AGENTS.md` §2) 이 ADR은 기술적 귀결만 기록한다. `star`·`repository` 수가 본인 조작에 열려 있다는 성질을 명시했고, `D15`는 폐기가 아니라 "`githubLogin`과 `department`"로 문구를 정정했다. 테이블 형태·명명·FK 부재 근거는 `docs/rules/data-modeling.md`가 원본이라 여기서 중복 서술하지 않는다.
- 2026-08-11: §2 "랭킹 필터는 사람 축이다"가 집계 축만 다루고 표시(display) 포함 여부·집계 대상 저장소 범위를 다루지 않던 것을 바로잡아, 집계 축(기존 서술 유지)·표시 축(가입자 전원, 기여 0이어도 표시, PM 결정 2026-08-11 신규)·저장소 축(org 저장소 전체·가시성 무관, PM 결정 2026-08-11 신규) 세 축을 명시적으로 분리해 서술했다. 저장소 축 확장(private org 저장소 활동도 공개 랭킹 숫자에 합산)은 저장소 자체의 공개 여부(`ADR-006`·`docs/rules/security.md`가 정한 명시적 publish 동작)와는 별개임을 명시했다. 동의 문서(`apps/frontend/public/policies/`)를 `2026-08-11` 버전으로 재게시하고 `CONSENT_POLICY_VERSION`을 올려 이 표시·집계 범위 확장을 반영했다.
- 2026-08-10: 신규 fact writer의 `githubId ∈ User` 경계를 ORG/EXTERNAL source-neutral로 통일해 팀 미특정 조직 저장소에서도 미가입자·작성자 불명 신원을 적재하지 않게 했다. 가입자 집합은 D9대로 run/import 시작 때 한 번 고정하고 조회 실패는 첫 write 전에 전파한다. 팀원 목록·PR 백필 fingerprint도 같은 run snapshot으로 좁혀 도중 가입 계정의 과거 PR이 누락되지 않게 했고, cutover는 import·provider 검증·fact parity 전체에서 하나의 가입자 snapshot을 공유한다. 기존 레거시 행은 runtime에서 삭제하지 않고 별도 승인 데이터 마이그레이션으로 추적한다.
- 2026-08-10: #730의 신청 연결 DB 증명으로 프로그램 화면의 OWN 저장소 제외 충돌이 해결된 현재 상태를 반영했다.
- 2026-08-10: 외부 저장소 공개 회수를 지연시키던 랭킹·프로젝트·공개 프로필 cache를 제거하고, 동시 요청 single-flight만 유지했다.
- 2026-08-10: §11에 `OWN` 대체 acceptance(통제된 저장소 1개 관통)와 그 실행 결과를 기록하고, 랭킹 읽기의 연결 심층 방어 부재를 Follow-up으로 남겼다.
- 2026-08-09: 신규. 두 읽기 표면의 데이터원 분리, 사람 축 랭킹 필터, `(repositoryId, githubId, date)` 입자, port 3개 + 프로비저닝 별도, Domain-first + Layered 폴더, Prisma 네이티브 쓰기와 Phase 2 조건을 확정. `ADR-003` DEC-42의 Port 제약과 `ADR-006`·`ADR-009`의 수집·표시 경계를 개정한다.
